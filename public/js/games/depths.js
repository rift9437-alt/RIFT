/* =========================================================
   GAME 10: NEON DEPTHS (3D — raycasting FPS)
   =========================================================
   A first-person shooter drawn with a classic DDA raycaster: one ray per
   screen column for the walls, billboarded sprites for everything else, and a
   depth buffer so enemies correctly disappear behind corners. */
const DepthsGame = (function(){
  const canvas = document.getElementById('depths-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const MAP_W = 21, MAP_H = 21;
  const COL_STEP = 2;                 // rays are 2px wide — plenty at this size
  const FOV_PLANE = 0.68;             // ~68° field of view
  const MOVE_SPEED = 2.9;
  const TURN_SPEED = 2.5;
  const MAG_SIZE = 12;
  const MAX_HP = 100;

  const WALL_COLORS = ['#000000', '#2b3f7a', '#6b2b5e', '#1f5f5a'];

  const DIFFS = {
    easy:   { label:'EASY',   hp:0.8, dmg:0.7, speed:0.85, count:0 },
    medium: { label:'MEDIUM', hp:1.0, dmg:1.0, speed:1.0,  count:1 },
    hard:   { label:'HARD',   hp:1.35,dmg:1.4, speed:1.2,  count:3 }
  };
  let difficulty = 'medium';

  const ENEMY_TYPES = {
    drone:    { hp:4,  speed:1.5, dmg:9,  radius:0.32, color:'#ff4d6d', score:1, ranged:false },
    wraith:   { hp:3,  speed:2.3, dmg:7,  radius:0.28, color:'#c9a6ff', score:1, ranged:false },
    sentinel: { hp:9,  speed:0.9, dmg:12, radius:0.38, color:'#ffc857', score:2, ranged:true }
  };

  let rafId = null, running = false, paused = false;
  let map, seen, px, py, dir, planeScale, hp, ammo, reloading, reloadTimer;
  let enemies, bolts, pickups, wave, kills, waveKills, fireCooldown, bob, hurtFlash;
  let muzzle, shake, lastTime, popTimer, zbuf;

  function setDifficulty(d){
    difficulty = d;
    ['easy','medium','hard'].forEach(k=>{
      document.getElementById('depths-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  /* ---- maze generation: randomised DFS, then punch holes for open fights ---- */
  function genMap(){
    const g = [];
    for(let y=0;y<MAP_H;y++) g.push(new Array(MAP_W).fill(1));

    const stack = [[1,1]];
    g[1][1] = 0;
    while(stack.length){
      const [x,y] = stack[stack.length-1];
      const dirs = [[2,0],[-2,0],[0,2],[0,-2]];
      for(let i=dirs.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        [dirs[i],dirs[j]] = [dirs[j],dirs[i]];
      }
      let moved = false;
      for(const [dx,dy] of dirs){
        const nx = x+dx, ny = y+dy;
        if(nx>0 && ny>0 && nx<MAP_W-1 && ny<MAP_H-1 && g[ny][nx] === 1){
          g[y+dy/2][x+dx/2] = 0;
          g[ny][nx] = 0;
          stack.push([nx,ny]);
          moved = true;
          break;
        }
      }
      if(!moved) stack.pop();
    }

    // A pure maze is claustrophobic to fight in — open it up.
    for(let i=0;i<Math.floor(MAP_W*MAP_H*0.10);i++){
      const x = 1 + Math.floor(Math.random()*(MAP_W-2));
      const y = 1 + Math.floor(Math.random()*(MAP_H-2));
      g[y][x] = 0;
    }
    // Central arena so there's always somewhere to back-pedal into.
    const cx = Math.floor(MAP_W/2), cy = Math.floor(MAP_H/2);
    for(let y=cy-2;y<=cy+2;y++) for(let x=cx-2;x<=cx+2;x++) g[y][x] = 0;

    for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
      if(g[y][x] === 1) g[y][x] = 1 + Math.floor(Math.random()*3);
    }
    return g;
  }

  function isWall(x, y){
    const mx = Math.floor(x), my = Math.floor(y);
    if(mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) return true;
    return map[my][mx] > 0;
  }

  function openCells(){
    const out = [];
    for(let y=1;y<MAP_H-1;y++) for(let x=1;x<MAP_W-1;x++){
      if(map[y][x] === 0) out.push([x+0.5, y+0.5]);
    }
    return out;
  }

  function lineOfSight(ax, ay, bx, by){
    const dx = bx-ax, dy = by-ay;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist * 6);
    for(let i=1;i<steps;i++){
      const t = i/steps;
      if(isWall(ax + dx*t, ay + dy*t)) return false;
    }
    return true;
  }

  function buildWave(){
    map = genMap();
    seen = [];
    for(let y=0;y<MAP_H;y++) seen.push(new Array(MAP_W).fill(false));

    const cells = openCells();
    const cx = MAP_W/2, cy = MAP_H/2;
    px = cx; py = cy; dir = Math.random()*Math.PI*2;

    enemies = [];
    bolts = [];
    pickups = [];
    waveKills = 0;

    const cfg = DIFFS[difficulty];
    const count = Math.min(16, 3 + wave*2 + cfg.count);
    const far = cells.filter(c=>Math.hypot(c[0]-px, c[1]-py) > 5);
    const pool = far.length > count ? far : cells;

    for(let i=0;i<count;i++){
      const spot = pool[Math.floor(Math.random()*pool.length)];
      let type = 'drone';
      const roll = Math.random();
      if(wave >= 2 && roll < 0.28) type = 'sentinel';
      else if(roll < 0.55) type = 'wraith';
      const base = ENEMY_TYPES[type];
      enemies.push({
        type,
        x: spot[0], y: spot[1],
        hp: Math.ceil(base.hp * cfg.hp * (1 + wave*0.11)),
        maxHp: Math.ceil(base.hp * cfg.hp * (1 + wave*0.11)),
        speed: base.speed * cfg.speed * (1 + wave*0.04),
        cooldown: 0,
        hurt: 0,
        wanderAngle: Math.random()*Math.PI*2
      });
    }

    for(let i=0;i<3;i++){
      const spot = cells[Math.floor(Math.random()*cells.length)];
      pickups.push({ x:spot[0], y:spot[1], kind: i === 0 ? 'health' : 'ammo' });
    }
  }

  function freshState(){
    wave = 1;
    kills = 0;
    hp = MAX_HP;
    ammo = MAG_SIZE;
    reloading = false;
    reloadTimer = 0;
    fireCooldown = 0;
    bob = 0;
    hurtFlash = 0;
    muzzle = 0;
    shake = 0;
    planeScale = FOV_PLANE;
    zbuf = new Float32Array(Math.ceil(W/COL_STEP));
    buildWave();
    updateHud();
  }

  function updateHud(){
    document.getElementById('depths-wave').textContent = wave;
    document.getElementById('depths-hp-fill').style.width = Math.max(0, (hp/MAX_HP)*100) + '%';
    document.getElementById('depths-ammo').textContent = reloading ? '…' : ammo;
    document.getElementById('depths-kills').textContent = kills;
    document.getElementById('depths-remaining').textContent = enemies.length;
  }

  function pop(text){
    const el = document.getElementById('depths-pop');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(popTimer);
    popTimer = setTimeout(()=>el.classList.add('hidden'), 1100);
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    setDifficulty(difficulty);
    document.getElementById('depths-setup').classList.remove('hidden');
    document.getElementById('depths-play').classList.add('hidden');
    document.getElementById('depths-result').classList.add('hidden');
    document.getElementById('depths-pop').classList.add('hidden');
    hideCompanions();
  }

  function start(){
    document.getElementById('depths-setup').classList.add('hidden');
    document.getElementById('depths-result').classList.add('hidden');
    document.getElementById('depths-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    showZipCompanion('idle');
    Sfx.play('alarm');
    lastTime = performance.now();
    loop();
  }

  function stop(){
    running = false;
    paused = false;
    if(rafId) cancelAnimationFrame(rafId);
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; lastTime = performance.now(); }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  function onKeyPress(name){
    if(name === 'r') startReload();
  }

  function startReload(){
    if(reloading || ammo === MAG_SIZE) return;
    reloading = true;
    reloadTimer = 0.85;
    Sfx.play('click');
  }

  function tryMove(nx, ny){
    const pad = 0.22;
    if(!isWall(nx + Math.sign(nx-px)*pad, py)) px = nx;
    if(!isWall(px, ny + Math.sign(ny-py)*pad)) py = ny;
  }

  function fire(){
    if(reloading || fireCooldown > 0) return;
    if(ammo <= 0){ startReload(); return; }
    ammo--;
    fireCooldown = 0.22;
    muzzle = 0.09;
    shake = 5;
    Sfx.play('shoot');

    // Hitscan: nearest enemy inside the crosshair cone with a clear line.
    let best = null, bestDist = Infinity;
    for(const e of enemies){
      const dx = e.x - px, dy = e.y - py;
      const dist = Math.hypot(dx, dy);
      if(dist > 14) continue;
      let a = Math.atan2(dy, dx) - dir;
      while(a > Math.PI) a -= Math.PI*2;
      while(a < -Math.PI) a += Math.PI*2;
      const halfAngle = Math.atan2(ENEMY_TYPES[e.type].radius, Math.max(0.4, dist));
      if(Math.abs(a) > halfAngle + 0.02) continue;
      if(!lineOfSight(px, py, e.x, e.y)) continue;
      if(dist < bestDist){ bestDist = dist; best = e; }
    }

    if(best){
      best.hp -= 3;
      best.hurt = 0.18;
      if(best.hp <= 0){
        kills++;
        waveKills++;
        enemies.splice(enemies.indexOf(best), 1);
        Sfx.play('explode');
        if(Math.random() < 0.25){
          pickups.push({ x:best.x, y:best.y, kind: Math.random()<0.5 ? 'ammo' : 'health' });
        }
      } else {
        Sfx.play('hit');
      }
    }
    updateHud();
  }

  function damagePlayer(amount){
    hp -= amount;
    hurtFlash = 0.35;
    shake = 12;
    Sfx.play('hit', 0.7);
    if(hp <= 0){ hp = 0; gameOver(); }
    updateHud();
  }

  function nextWave(){
    wave++;
    hp = Math.min(MAX_HP, hp + 30);
    ammo = MAG_SIZE;
    reloading = false;
    earnTokens('depths_wave', 1);
    Sfx.play('win');
    pop('WAVE ' + wave);
    buildWave();
    updateHud();
    refreshCabinets();
  }

  function update(dt){
    const cfg = DIFFS[difficulty];

    // --- player ---
    let moveX = 0, moveY = 0;
    if(keys.has('a')) dir -= TURN_SPEED * dt;
    if(keys.has('d')) dir += TURN_SPEED * dt;
    if(keys.has('arrowleft')) dir -= TURN_SPEED * dt;
    if(keys.has('arrowright')) dir += TURN_SPEED * dt;

    const fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const strafe = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0);
    moveX = Math.cos(dir)*fwd + Math.cos(dir + Math.PI/2)*strafe;
    moveY = Math.sin(dir)*fwd + Math.sin(dir + Math.PI/2)*strafe;
    const len = Math.hypot(moveX, moveY);
    if(len > 0){
      moveX /= len; moveY /= len;
      tryMove(px + moveX*MOVE_SPEED*dt, py + moveY*MOVE_SPEED*dt);
      bob += dt * 9;
    } else {
      bob += dt * 1.5;
    }

    if(keys.has('space')) fire();
    if(fireCooldown > 0) fireCooldown -= dt;
    if(muzzle > 0) muzzle -= dt;
    if(hurtFlash > 0) hurtFlash -= dt;
    if(shake > 0) shake = Math.max(0, shake - 30*dt);
    if(reloading){
      reloadTimer -= dt;
      if(reloadTimer <= 0){
        reloading = false;
        ammo = MAG_SIZE;
        Sfx.play('select');
      }
      updateHud();
    }

    // --- fog of war for the minimap ---
    const mx = Math.floor(px), my = Math.floor(py);
    for(let y=Math.max(0,my-4); y<=Math.min(MAP_H-1,my+4); y++){
      for(let x=Math.max(0,mx-4); x<=Math.min(MAP_W-1,mx+4); x++) seen[y][x] = true;
    }

    // --- enemies ---
    for(const e of enemies){
      const base = ENEMY_TYPES[e.type];
      const dx = px - e.x, dy = py - e.y;
      const dist = Math.hypot(dx, dy);
      const sees = dist < 12 && lineOfSight(e.x, e.y, px, py);
      if(e.hurt > 0) e.hurt -= dt;
      if(e.cooldown > 0) e.cooldown -= dt;

      let tx, ty;
      if(sees){
        // Sentinels hold their ground and shoot; the rest close in — but only
        // to arm's length, so a sprite never ends up inside the camera.
        const want = base.ranged ? 4.5 : 0.9;
        const push = dist > want ? 1 : -0.6;
        tx = (dx/dist) * push;
        ty = (dy/dist) * push;
      } else {
        e.wanderAngle += (Math.random()-0.5) * dt * 4;
        tx = Math.cos(e.wanderAngle) * 0.5;
        ty = Math.sin(e.wanderAngle) * 0.5;
      }

      const step = e.speed * dt;
      const nx = e.x + tx*step, ny = e.y + ty*step;
      if(!isWall(nx, e.y)) e.x = nx; else e.wanderAngle = Math.random()*Math.PI*2;
      if(!isWall(e.x, ny)) e.y = ny; else e.wanderAngle = Math.random()*Math.PI*2;

      // Hard personal-space floor: push anything that got too close back out.
      const after = Math.hypot(e.x-px, e.y-py);
      if(after < 0.7 && after > 0.001){
        e.x = px + (e.x-px)/after * 0.7;
        e.y = py + (e.y-py)/after * 0.7;
      }

      if(sees && e.cooldown <= 0){
        if(base.ranged && dist > 1.4){
          e.cooldown = 1.9;
          bolts.push({ x:e.x, y:e.y, vx:(dx/dist)*3.6, vy:(dy/dist)*3.6, dmg: base.dmg*cfg.dmg, life:4 });
          Sfx.play('laser', 0.6);
        } else if(dist < 1.15){
          e.cooldown = 1.1;
          damagePlayer(Math.round(base.dmg * cfg.dmg));
          if(!running) return;
        }
      }
    }

    // --- enemy bolts ---
    for(let i=bolts.length-1;i>=0;i--){
      const b = bolts[i];
      b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt;
      if(b.life <= 0 || isWall(b.x, b.y)){ bolts.splice(i,1); continue; }
      if(Math.hypot(b.x-px, b.y-py) < 0.35){
        bolts.splice(i,1);
        damagePlayer(Math.round(b.dmg));
        if(!running) return;
      }
    }

    // --- pickups ---
    for(let i=pickups.length-1;i>=0;i--){
      const p = pickups[i];
      if(Math.hypot(p.x-px, p.y-py) < 0.45){
        if(p.kind === 'health') hp = Math.min(MAX_HP, hp + 25);
        else { ammo = MAG_SIZE; reloading = false; }
        pickups.splice(i,1);
        Sfx.play('coin');
        updateHud();
      }
    }

    if(enemies.length === 0){
      if(waveKills > 0) earnTokens('depths_kill', waveKills);
      updateStat('depths', [{stat:'bestWave', type:'max', value:wave}]);
      nextWave();
    }
    updateHud();
  }

  function gameOver(){
    running = false;
    updateStat('depths', [{stat:'bestWave', type:'max', value:wave}]);
    zipReactToScore('depths', 'bestWave', wave);
    if(waveKills > 0) earnTokens('depths_kill', waveKills);
    Sfx.play('lose');
    document.getElementById('depths-result-text').textContent = 'YOU FELL';
    document.getElementById('depths-result-sub').textContent =
      'Wave ' + wave + ' on ' + DIFFS[difficulty].label + ' — ' + kills + ' kill' + (kills===1?'':'s') + ' before the depths took you.';
    document.getElementById('depths-play').classList.add('hidden');
    document.getElementById('depths-result').classList.remove('hidden');
    refreshCabinets();
  }

  /* ---------------- rendering ---------------- */
  function drawWorld(){
    const dirX = Math.cos(dir), dirY = Math.sin(dir);
    const planeX = -dirY * planeScale, planeY = dirX * planeScale;
    const horizon = H/2 + Math.sin(bob)*3;

    // ceiling + floor
    const ceil = ctx.createLinearGradient(0, 0, 0, horizon);
    ceil.addColorStop(0, '#05060f');
    ceil.addColorStop(1, '#141b33');
    ctx.fillStyle = ceil;
    ctx.fillRect(0, 0, W, horizon);
    const floor = ctx.createLinearGradient(0, horizon, 0, H);
    floor.addColorStop(0, '#1b1226');
    floor.addColorStop(1, '#05060f');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, W, H - horizon);

    // Cheap perspective floor: bands that bunch up toward the horizon.
    for(let i=1;i<=7;i++){
      const t = i/7;
      const y = horizon + (H - horizon) * t * t;
      ctx.fillStyle = `rgba(130,160,230,${0.04 + t*0.05})`;
      ctx.fillRect(0, y, W, 1);
    }

    for(let col=0, i=0; col<W; col+=COL_STEP, i++){
      const cameraX = 2*col/W - 1;
      const rayX = dirX + planeX*cameraX;
      const rayY = dirY + planeY*cameraX;

      let mapX = Math.floor(px), mapY = Math.floor(py);
      const deltaX = Math.abs(1/rayX), deltaY = Math.abs(1/rayY);
      let stepX, stepY, sideX, sideY;

      if(rayX < 0){ stepX = -1; sideX = (px - mapX) * deltaX; }
      else { stepX = 1; sideX = (mapX + 1 - px) * deltaX; }
      if(rayY < 0){ stepY = -1; sideY = (py - mapY) * deltaY; }
      else { stepY = 1; sideY = (mapY + 1 - py) * deltaY; }

      let side = 0, hitVal = 0, guard = 0;
      while(guard++ < 96){
        if(sideX < sideY){ sideX += deltaX; mapX += stepX; side = 0; }
        else { sideY += deltaY; mapY += stepY; side = 1; }
        if(mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H){ hitVal = 1; break; }
        if(map[mapY][mapX] > 0){ hitVal = map[mapY][mapX]; break; }
      }

      const perp = Math.max(0.05, side === 0 ? sideX - deltaX : sideY - deltaY);
      zbuf[i] = perp;

      // Where along the wall face the ray landed — used for panel seams, the
      // cheapest way to stop big flat walls looking like solid colour.
      let wallX = side === 0 ? py + perp * rayY : px + perp * rayX;
      wallX -= Math.floor(wallX);

      const lineH = H / perp;
      const top = horizon - lineH/2;
      const fade = Math.max(0.10, Math.min(1, 5.5/perp));
      const dim = side === 1 ? 0.62 : 1;
      const seam = (wallX % 0.25) < 0.035 ? 0.62 : 1;
      ctx.fillStyle = Mini3D.shade(WALL_COLORS[hitVal] || WALL_COLORS[1], fade * dim * seam * 1.4);
      ctx.fillRect(col, top, COL_STEP, lineH);

      // A bright rim along the top edge sells the neon look cheaply.
      if(fade > 0.25){
        ctx.fillStyle = `rgba(120,220,255,${fade*0.25*dim})`;
        ctx.fillRect(col, top, COL_STEP, Math.max(1, lineH*0.02));
        // ...and a groove two-thirds down for a bit of vertical structure.
        ctx.fillStyle = `rgba(0,0,0,${fade*0.22})`;
        ctx.fillRect(col, top + lineH*0.66, COL_STEP, Math.max(1, lineH*0.015));
      }
    }
  }

  function drawSprites(){
    const dirX = Math.cos(dir), dirY = Math.sin(dir);
    const planeX = -dirY * planeScale, planeY = dirX * planeScale;
    const invDet = 1.0 / (planeX*dirY - dirX*planeY);
    const horizon = H/2 + Math.sin(bob)*3;

    const list = [];
    enemies.forEach(e=>list.push({ kind:'enemy', ref:e, x:e.x, y:e.y }));
    pickups.forEach(p=>list.push({ kind:'pickup', ref:p, x:p.x, y:p.y }));
    bolts.forEach(b=>list.push({ kind:'bolt', ref:b, x:b.x, y:b.y }));
    list.forEach(s=>{ s.dist = (s.x-px)*(s.x-px) + (s.y-py)*(s.y-py); });
    list.sort((a,b)=> b.dist - a.dist);

    for(const s of list){
      const rx = s.x - px, ry = s.y - py;
      const tx = invDet * (dirY*rx - dirX*ry);
      const ty = invDet * (-planeY*rx + planeX*ry);
      if(ty < 0.25) continue;

      const screenX = (W/2) * (1 + tx/ty);
      // Cap the billboard so a point-blank enemy can't swallow the whole view.
      const size = Math.min(H * 1.9, Math.abs(H / ty));
      const col = Math.floor(screenX / COL_STEP);
      if(col < 0 || col >= zbuf.length) continue;
      if(zbuf[col] < ty) continue;   // hidden behind a wall

      const fade = Math.max(0.15, Math.min(1, 6/ty));
      ctx.save();
      ctx.globalAlpha = fade;

      if(s.kind === 'enemy'){
        const e = s.ref;
        const base = ENEMY_TYPES[e.type];
        const h = size * (base.radius * 1.9);
        const yBase = horizon + size*0.22;
        ctx.shadowColor = base.color;
        ctx.shadowBlur = 20 * fade;
        ctx.fillStyle = e.hurt > 0 ? '#ffffff' : base.color;
        ctx.beginPath();
        if(e.type === 'sentinel'){
          ctx.moveTo(screenX, yBase - h*1.5);
          ctx.lineTo(screenX + h*0.55, yBase);
          ctx.lineTo(screenX - h*0.55, yBase);
        } else {
          ctx.ellipse(screenX, yBase - h*0.7, h*0.5, h*0.75, 0, 0, Math.PI*2);
        }
        ctx.closePath();
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#04060a';
        ctx.beginPath();
        ctx.ellipse(screenX, yBase - h*0.85, h*0.16, h*0.1, 0, 0, Math.PI*2);
        ctx.fill();

        if(e.hp < e.maxHp){
          const bw = h*0.9;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(screenX-bw/2, yBase - h*1.75, bw, 4);
          ctx.fillStyle = '#ff4d6d';
          ctx.fillRect(screenX-bw/2, yBase - h*1.75, bw*(e.hp/e.maxHp), 4);
        }
      } else if(s.kind === 'pickup'){
        const h = size * 0.18;
        const color = s.ref.kind === 'health' ? '#45ffb0' : '#ffc857';
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 * fade;
        ctx.fillStyle = color;
        ctx.fillRect(screenX - h/2, horizon + size*0.2 - h, h, h);
      } else {
        const h = Math.max(3, size * 0.05);
        ctx.shadowColor = '#ffc857';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#fff2b0';
        ctx.beginPath();
        ctx.arc(screenX, horizon, h, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawGun(){
    const sway = Math.sin(bob) * 6;
    const kick = muzzle > 0 ? 14 : 0;
    const baseX = W/2 + sway;
    const baseY = H + 10 + kick;

    if(muzzle > 0){
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.shadowColor = '#ffc857';
      ctx.shadowBlur = 40;
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(baseX, baseY - 150, 26 + Math.random()*8, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = '#1a1f2b';
    ctx.strokeStyle = 'rgba(120,220,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(baseX - 46, baseY);
    ctx.lineTo(baseX - 26, baseY - 130);
    ctx.lineTo(baseX + 26, baseY - 130);
    ctx.lineTo(baseX + 46, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0c0f16';
    ctx.fillRect(baseX - 9, baseY - 155, 18, 30);
    ctx.strokeRect(baseX - 9, baseY - 155, 18, 30);
    ctx.restore();

    // crosshair
    ctx.save();
    ctx.strokeStyle = reloading ? 'rgba(255,200,87,0.8)' : 'rgba(232,236,241,0.7)';
    ctx.lineWidth = 1.5;
    const cx = W/2, cy = H/2, g = reloading ? 12 : 7;
    ctx.beginPath();
    ctx.moveTo(cx-g-7, cy); ctx.lineTo(cx-g, cy);
    ctx.moveTo(cx+g, cy);   ctx.lineTo(cx+g+7, cy);
    ctx.moveTo(cx, cy-g-7); ctx.lineTo(cx, cy-g);
    ctx.moveTo(cx, cy+g);   ctx.lineTo(cx, cy+g+7);
    ctx.stroke();
    ctx.restore();
  }

  function drawMinimap(){
    const cell = 6, pad = 12;
    const mw = MAP_W*cell, mh = MAP_H*cell;
    const ox = W - mw - pad, oy = pad;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = 'rgba(4,6,10,0.8)';
    ctx.fillRect(ox-4, oy-4, mw+8, mh+8);
    ctx.strokeStyle = 'rgba(120,220,255,0.3)';
    ctx.strokeRect(ox-4, oy-4, mw+8, mh+8);

    for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
      if(!seen[y][x]) continue;
      ctx.fillStyle = map[y][x] > 0 ? 'rgba(120,150,220,0.55)' : 'rgba(30,40,64,0.55)';
      ctx.fillRect(ox + x*cell, oy + y*cell, cell-1, cell-1);
    }

    enemies.forEach(e=>{
      if(Math.hypot(e.x-px, e.y-py) > 7) return;
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(ox + e.x*cell - 2, oy + e.y*cell - 2, 4, 4);
    });
    pickups.forEach(p=>{
      if(!seen[Math.floor(p.y)][Math.floor(p.x)]) return;
      ctx.fillStyle = p.kind === 'health' ? '#45ffb0' : '#ffc857';
      ctx.fillRect(ox + p.x*cell - 2, oy + p.y*cell - 2, 3, 3);
    });

    ctx.fillStyle = '#2de2c5';
    ctx.beginPath();
    ctx.moveTo(ox + px*cell + Math.cos(dir)*5, oy + py*cell + Math.sin(dir)*5);
    ctx.lineTo(ox + px*cell + Math.cos(dir+2.4)*4, oy + py*cell + Math.sin(dir+2.4)*4);
    ctx.lineTo(ox + px*cell + Math.cos(dir-2.4)*4, oy + py*cell + Math.sin(dir-2.4)*4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function render(){
    ctx.save();
    applyShake(ctx, shake);
    drawWorld();
    drawSprites();
    ctx.restore();

    drawGun();
    drawMinimap();

    if(hurtFlash > 0){
      // A vignette rather than a full-screen wash, so you can still see the
      // thing that's hitting you.
      ctx.save();
      ctx.globalAlpha = Math.min(0.8, hurtFlash * 2.2);
      const v = ctx.createRadialGradient(W/2, H/2, H*0.25, W/2, H/2, H*0.78);
      v.addColorStop(0, 'rgba(255,43,77,0)');
      v.addColorStop(1, 'rgba(255,43,77,0.85)');
      ctx.fillStyle = v;
      ctx.fillRect(0,0,W,H);
      ctx.restore();
    }

    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.fillText('WAVE ' + wave + ' · ' + enemies.length + ' HOSTILE' + (enemies.length===1?'':'S') + ' · ' + DIFFS[difficulty].label, 14, H-16);
    if(reloading){
      ctx.fillStyle = 'rgba(255,200,87,0.9)';
      ctx.fillText('RELOADING…', 14, H-32);
    }
    ctx.restore();
  }

  function loop(){
    if(!running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime)/1000);
    lastTime = now;
    if(!paused) update(dt);
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  setDifficulty(difficulty);
  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning, setDifficulty};
})();
