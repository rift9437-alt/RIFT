/* =========================================================
   GAME 11: SKY STACK (3D)
   =========================================================
   Every block is a real box pushed through Mini3D, and the camera orbits and
   climbs as the tower grows — so a tall tower genuinely looks tall. */
const StackGame = (function(){
  const canvas = document.getElementById('stack-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const FOCAL = 620;
  const BLOCK_H = 0.62;
  const START_SIZE = 4.2;
  const TRAVEL = 7.5;             // how far the sliding block swings out
  const PERFECT_TOL = 0.14;

  let rafId = null, running = false, paused = false;
  let blocks, debris, moving, height, combo, bestCombo, camAngle, camHeight;
  let sliceFlash, shake, lastTime, popTimer, sessionBest;

  function lookAt(cx, cy, cz, tx, ty, tz){
    const dx = tx-cx, dy = ty-cy, dz = tz-cz;
    const horiz = Math.hypot(dx, dz);
    return { x:cx, y:cy, z:cz, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, horiz) };
  }

  function hueFor(i){
    const palette = ['#2de2c5','#4cb8ff','#8b6dff','#ff6ad5','#ff5b3d','#ffc857','#9dff45'];
    return palette[i % palette.length];
  }

  function topBlock(){ return blocks[blocks.length-1]; }

  function spawnMoving(){
    const top = topBlock();
    const axis = blocks.length % 2 === 1 ? 'x' : 'z';
    const speed = Math.min(9.5, 3.2 + blocks.length * 0.19);
    // The block only ever swings a little past the edge of what it has to land
    // on, so a mistimed drop is a near miss you can recover from rather than
    // an instant loss from the other side of the screen.
    const topPos = axis === 'x' ? top.x : top.z;
    const topSize = axis === 'x' ? top.sx : top.sz;
    const range = topSize/2 + Math.min(TRAVEL, 2.6 + blocks.length*0.05);
    moving = {
      axis,
      range,
      sx: top.sx, sz: top.sz,
      x: axis === 'x' ? topPos - range : top.x,
      z: axis === 'z' ? topPos - range : top.z,
      y: top.y + BLOCK_H,
      dir: 1,
      speed,
      color: hueFor(blocks.length)
    };
  }

  function freshState(){
    blocks = [{ x:0, z:0, y:0, sx:START_SIZE, sz:START_SIZE, color:hueFor(0) }];
    debris = [];
    height = 0;
    combo = 0;
    bestCombo = 0;
    camAngle = 0.7;
    camHeight = 2.6;
    sliceFlash = 0;
    shake = 0;
    const rec = lbCache && lbCache[currentUser] && lbCache[currentUser].stack;
    sessionBest = (rec && rec.bestHeight) || 0;
    spawnMoving();
    updateHud();
  }

  function updateHud(){
    document.getElementById('stack-combo').textContent = combo;
    document.getElementById('stack-height').textContent = height;
    document.getElementById('stack-best').textContent = Math.max(sessionBest, height);
  }

  function pop(text){
    const el = document.getElementById('stack-pop');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(popTimer);
    popTimer = setTimeout(()=>el.classList.add('hidden'), 700);
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('stack-setup').classList.remove('hidden');
    document.getElementById('stack-play').classList.add('hidden');
    document.getElementById('stack-result').classList.add('hidden');
    document.getElementById('stack-pop').classList.add('hidden');
    hideCompanions();
  }

  function start(){
    document.getElementById('stack-setup').classList.add('hidden');
    document.getElementById('stack-result').classList.add('hidden');
    document.getElementById('stack-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    showZipCompanion('idle');
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
    if(name === 'space') drop();
  }

  function drop(){
    if(!running || paused || !moving) return;
    const top = topBlock();
    const axis = moving.axis;
    const movePos = axis === 'x' ? moving.x : moving.z;
    const topPos  = axis === 'x' ? top.x : top.z;
    const size    = axis === 'x' ? moving.sx : moving.sz;
    const topSize = axis === 'x' ? top.sx : top.sz;
    const offset = movePos - topPos;
    const overlap = Math.min(movePos + size/2, topPos + topSize/2) - Math.max(movePos - size/2, topPos - topSize/2);

    if(overlap <= 0.02){
      // Nothing to land on — the block tumbles into the void.
      debris.push({
        x: moving.x, y: moving.y, z: moving.z,
        sx: moving.sx, sz: moving.sz,
        vy: -1, spin: 0, color: moving.color, life: 1.4
      });
      shake = 14;
      // One free miss on the very first block, so an early tap doesn't end a
      // run before it starts.
      if(height === 0){
        Sfx.play('alarm');
        pop('TOO EARLY — TRY AGAIN');
        spawnMoving();
        return;
      }
      moving = null;
      Sfx.play('explode');
      gameOver();
      return;
    }

    const perfect = Math.abs(offset) < PERFECT_TOL;
    let newSize = perfect ? size : overlap;
    let newPos = perfect ? topPos : (Math.min(movePos + size/2, topPos + topSize/2) + Math.max(movePos - size/2, topPos - topSize/2)) / 2;

    if(perfect){
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      // A clean streak slowly wins back width you lost earlier.
      newSize = Math.min(START_SIZE, size + 0.16);
      Sfx.play('perfect');
      pop(combo >= 3 ? 'PERFECT ×' + combo : 'PERFECT');
    } else {
      combo = 0;
      Sfx.play('thud');
      sliceFlash = 0.25;
      // The overhang falls away as debris.
      const sliceSize = size - overlap;
      const sliceCenter = movePos > topPos
        ? movePos + size/2 - sliceSize/2
        : movePos - size/2 + sliceSize/2;
      debris.push({
        x: axis === 'x' ? sliceCenter : moving.x,
        z: axis === 'z' ? sliceCenter : moving.z,
        y: moving.y,
        sx: axis === 'x' ? sliceSize : moving.sx,
        sz: axis === 'z' ? sliceSize : moving.sz,
        vy: -0.4, spin: (Math.random()-0.5)*3, color: moving.color, life: 1.6
      });
    }

    blocks.push({
      x: axis === 'x' ? newPos : moving.x,
      z: axis === 'z' ? newPos : moving.z,
      y: moving.y,
      sx: axis === 'x' ? newSize : moving.sx,
      sz: axis === 'z' ? newSize : moving.sz,
      color: moving.color
    });

    height++;
    earnTokens('stack_block', 1);
    updateHud();
    spawnMoving();
  }

  function update(dt){
    if(moving){
      const range = moving.range;
      if(moving.axis === 'x'){
        moving.x += moving.dir * moving.speed * dt;
        if(moving.x > range){ moving.x = range; moving.dir = -1; }
        if(moving.x < -range){ moving.x = -range; moving.dir = 1; }
      } else {
        moving.z += moving.dir * moving.speed * dt;
        if(moving.z > range){ moving.z = range; moving.dir = -1; }
        if(moving.z < -range){ moving.z = -range; moving.dir = 1; }
      }
    }

    for(let i=debris.length-1;i>=0;i--){
      const d = debris[i];
      d.vy -= 9.5*dt;
      d.y += d.vy*dt;
      d.life -= dt;
      if(d.life <= 0 || d.y < -14) debris.splice(i,1);
    }

    // Camera slowly orbits and rides the top of the tower.
    camAngle += dt * 0.24;
    const targetHeight = height * BLOCK_H + 2.6;
    camHeight += (targetHeight - camHeight) * Math.min(1, dt*3.2);
    if(sliceFlash > 0) sliceFlash -= dt;
    if(shake > 0) shake = Math.max(0, shake - 30*dt);
  }

  function gameOver(){
    running = false;
    updateStat('stack', [{stat:'bestHeight', type:'max', value:height}]);
    zipReactToScore('stack', 'bestHeight', height);
    Sfx.play('lose');
    document.getElementById('stack-result-text').textContent = height >= 10 ? 'SKYLINE REACHED' : 'TOWER DOWN';
    document.getElementById('stack-result-sub').textContent =
      'You stacked ' + height + ' block' + (height===1?'':'s') + ', best perfect streak ×' + bestCombo + '.';
    document.getElementById('stack-play').classList.add('hidden');
    document.getElementById('stack-result').classList.remove('hidden');
    refreshCabinets();
  }

  function render(){
    const dist = 13 + Math.min(9, height*0.13);
    const cx = Math.sin(camAngle)*dist;
    const cz = Math.cos(camAngle)*dist;
    const cam = lookAt(cx, camHeight + 3.2, cz, 0, camHeight - 1.2, 0);

    ctx.save();
    applyShake(ctx, shake);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1030');
    bg.addColorStop(0.55, '#140c26');
    bg.addColorStop(1, '#04050c');
    ctx.fillStyle = bg;
    ctx.fillRect(-40, -40, W+80, H+80);

    // A few stars for depth, deterministic so they don't crawl.
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for(let i=0;i<40;i++){
      const sx = ((i*137)%W), sy = ((i*79)%(H*0.5));
      ctx.globalAlpha = 0.2 + ((i%5)/10);
      ctx.fillRect(sx, sy, 1.6, 1.6);
    }
    ctx.restore();

    const faces = [];

    // Ground pad, only worth drawing while it's still in shot.
    if(height < 16){
      faces.push(...Mini3D.box(0, -0.35, 0, 9, 0.4, 9, '#141a2b', { stroke:'rgba(120,220,255,0.18)' }));
    }

    // Only the top slice of the tower is on screen — skip the rest.
    const from = Math.max(0, blocks.length - 18);
    for(let i=from;i<blocks.length;i++){
      const b = blocks[i];
      const isTop = i === blocks.length-1;
      faces.push(...Mini3D.box(b.x, b.y, b.z, b.sx, BLOCK_H, b.sz, b.color, {
        stroke: isTop ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.14)',
        lineWidth: isTop ? 1.6 : 1,
        glow: isTop ? b.color : null,
        glowBlur: 16
      }));
    }

    if(moving){
      faces.push(...Mini3D.box(moving.x, moving.y, moving.z, moving.sx, BLOCK_H, moving.sz, moving.color, {
        stroke:'#ffffff', lineWidth:1.8, glow:moving.color, glowBlur:22
      }));
    }

    debris.forEach(d=>{
      faces.push(...Mini3D.box(d.x, d.y, d.z, d.sx, BLOCK_H, d.sz, d.color, {
        alpha: Math.max(0, Math.min(1, d.life)), stroke:'rgba(255,255,255,0.2)'
      }));
    });

    Mini3D.render(ctx, faces, cam, W, H, FOCAL);

    if(sliceFlash > 0){
      // A soft edge glow, not a full-screen wash — the tower stays readable.
      ctx.globalAlpha = Math.min(0.5, sliceFlash * 1.8);
      const fl = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.85);
      fl.addColorStop(0, 'rgba(255,61,138,0)');
      fl.addColorStop(1, 'rgba(255,61,138,0.7)');
      ctx.fillStyle = fl;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.55)';
    ctx.fillText('SPACE OR CLICK TO DROP', 14, H-16);
    if(moving){
      const width = (moving.axis === 'x' ? moving.sx : moving.sz);
      ctx.fillText('WIDTH ' + width.toFixed(2), 14, H-32);
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

  canvas.addEventListener('pointerdown', e=>{ e.preventDefault(); drop(); });

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
