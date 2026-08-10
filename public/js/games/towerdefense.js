/* =========================================================
   GAME: TOWER DEFENSE
   ========================================================= */
const TowerDefenseGame = (function(){
  const canvas = document.getElementById('towerdefense-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const WAYPOINTS = [
    {x:0,y:80},{x:170,y:80},{x:170,y:230},{x:330,y:230},
    {x:330,y:100},{x:500,y:100},{x:500,y:360},{x:250,y:360},
    {x:250,y:440},{x:700,y:440}
  ];
  const SEG_LEN = [];
  let TOTAL_LEN = 0;
  (function measure(){
    for(let i=0;i<WAYPOINTS.length-1;i++){
      const d = Math.hypot(WAYPOINTS[i+1].x-WAYPOINTS[i].x, WAYPOINTS[i+1].y-WAYPOINTS[i].y);
      SEG_LEN.push(d);
      TOTAL_LEN += d;
    }
  })();

  function pointAtDistance(dist){
    let d = dist;
    for(let i=0;i<SEG_LEN.length;i++){
      if(d <= SEG_LEN[i]){
        const t = SEG_LEN[i] === 0 ? 0 : d / SEG_LEN[i];
        return {
          x: WAYPOINTS[i].x + (WAYPOINTS[i+1].x - WAYPOINTS[i].x) * t,
          y: WAYPOINTS[i].y + (WAYPOINTS[i+1].y - WAYPOINTS[i].y) * t
        };
      }
      d -= SEG_LEN[i];
    }
    return WAYPOINTS[WAYPOINTS.length-1];
  }

  function distToPath(px, py){
    let best = Infinity;
    for(let i=0;i<WAYPOINTS.length-1;i++){
      const a = WAYPOINTS[i], b = WAYPOINTS[i+1];
      const dx = b.x-a.x, dy = b.y-a.y;
      const len2 = dx*dx + dy*dy;
      let t = len2 === 0 ? 0 : ((px-a.x)*dx + (py-a.y)*dy) / len2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(px - (a.x+dx*t), py - (a.y+dy*t)));
    }
    return best;
  }

  // --- troop catalogue -----------------------------------------------------
  // `targets` is what the troop can actually shoot, and it's enforced in the
  // targeting code — it isn't just flavour text on the card.
  const TROOPS = {
    archer: {
      name:'Archer', icon:'🏹', cost:30, targets:'both', color:'#45ffb0',
      range:96, damage:9, cooldown:34, splash:0, slow:0,
      blurb:'Cheap, reliable, hits anything.'
    },
    cannon: {
      name:'Cannon', icon:'💣', cost:55, targets:'ground', color:'#ffc857',
      range:82, damage:24, cooldown:70, splash:34, slow:0,
      blurb:'Heavy splash, but it cannot elevate to hit flyers.'
    },
    frost: {
      name:'Frost Mage', icon:'❄️', cost:45, targets:'both', color:'#7dd3ff',
      range:88, damage:4, cooldown:44, splash:0, slow:0.45,
      blurb:'Low damage, but chills whatever it hits.'
    },
    ballista: {
      name:'Ballista', icon:'🎯', cost:80, targets:'air', color:'#c9a6ff',
      range:150, damage:30, cooldown:58, splash:0, slow:0,
      blurb:'Long-range anti-air specialist. Ignores ground.'
    },
    tesla: {
      name:'Tesla Coil', icon:'⚡', cost:95, targets:'both', color:'#ff6ad5',
      range:74, damage:13, cooldown:22, splash:0, slow:0, chain:2,
      blurb:'Fast chain lightning. Short reach, melts clumps.'
    }
  };

  // --- enemy catalogue -----------------------------------------------------
  const ENEMIES = {
    grunt:  { name:'Grunt',  kind:'ground', hp:26,  speed:0.85, bounty:6,  color:'#ff5454', r:9 },
    runner: { name:'Runner', kind:'ground', hp:16,  speed:1.85, bounty:7,  color:'#ff9d00', r:7 },
    brute:  { name:'Brute',  kind:'ground', hp:95,  speed:0.55, bounty:16, color:'#b04a4a', r:13 },
    flyer:  { name:'Flyer',  kind:'air',    hp:30,  speed:1.35, bounty:12, color:'#7dd3ff', r:9 },
    swarm:  { name:'Swarm',  kind:'air',    hp:12,  speed:1.7,  bounty:5,  color:'#c9a6ff', r:6 }
  };

  const MAX_LEVEL = 5;
  function upgradeCost(troopId, level){
    return Math.round(TROOPS[troopId].cost * 0.7 * Math.pow(1.55, level-1));
  }
  // Levels scale damage and range; the display numbers come from these too, so
  // the card can never disagree with what the troop actually does.
  function towerStats(t){
    const base = TROOPS[t.type];
    return {
      damage: base.damage * (1 + 0.42*(t.level-1)),
      range: base.range * (1 + 0.10*(t.level-1)),
      cooldown: Math.max(8, base.cooldown * (1 - 0.08*(t.level-1))),
      splash: base.splash * (1 + 0.15*(t.level-1)),
      slow: base.slow,
      chain: base.chain || 0
    };
  }
  function dpsOf(t){
    const s = towerStats(t);
    const shots = 60 / s.cooldown;
    const targets = 1 + (s.chain || 0) + (s.splash > 0 ? 1 : 0);
    return (s.damage * shots * targets).toFixed(1);
  }

  let rafId=null, running=false, paused=false;
  let towers, enemies, shots, puffs, wave, lives, gold, spawnQueue, spawnTimer, waveDelay;
  let frame, kills, wavesCleared, selectedTroop, selectedTower, hoverPos, message, messageTimer;

  function freshState(){
    towers = [];
    enemies = [];
    shots = [];
    puffs = [];
    wave = 1;
    lives = 10;
    gold = 100;
    spawnQueue = [];
    spawnTimer = 0;
    waveDelay = 90;
    frame = 0;
    kills = 0;
    wavesCleared = 0;
    selectedTroop = 'archer';
    selectedTower = null;
    hoverPos = null;
    message = '';
    messageTimer = 0;
    renderShop();
    renderInspector();
    updateHud();
  }

  function say(text){ message = text; messageTimer = 110; }

  function updateHud(){
    document.getElementById('towerdefense-wave-hud').textContent = wave;
    document.getElementById('towerdefense-lives-hud').textContent = '❤ ' + lives;
    document.getElementById('towerdefense-gold-hud').textContent = '🪙 ' + gold;
  }

  /* ---------------- side menu ---------------- */
  function targetTag(targets){
    const label = targets === 'both' ? 'Ground + Air' : (targets === 'air' ? 'Air only' : 'Ground only');
    return `<span class="td-tag td-tag-${targets}">${label}</span>`;
  }

  function renderShop(){
    const box = document.getElementById('td-shop');
    if(!box) return;
    box.innerHTML = Object.entries(TROOPS).map(([id, t])=>`
      <button class="td-troop ${selectedTroop===id?'selected':''} ${gold < t.cost ? 'cant':''}"
              onclick="TowerDefenseGame.selectTroop('${id}')">
        <span class="td-troop-icon">${t.icon}</span>
        <span>
          <span class="td-troop-name">${t.name}</span><br>
          <span class="td-troop-meta">${t.targets === 'both' ? 'GND+AIR' : t.targets.toUpperCase()} · RNG ${t.range}</span>
        </span>
        <span class="td-troop-cost">🪙${t.cost}</span>
      </button>`).join('');
  }

  function renderInspector(){
    const box = document.getElementById('td-inspect');
    if(!box) return;
    if(!selectedTower){
      const t = TROOPS[selectedTroop];
      box.className = '';
      box.innerHTML = `
        <div class="td-stat"><span>Placing</span><b>${t.icon} ${t.name}</b></div>
        <div class="td-stat"><span>Targets</span>${targetTag(t.targets)}</div>
        <div class="td-stat"><span>Damage</span><b>${t.damage}</b></div>
        <div class="td-stat"><span>Range</span><b>${t.range}</b></div>
        <div class="td-stat"><span>Cost</span><b>🪙 ${t.cost}</b></div>
        <div class="td-inspect-empty" style="margin-top:8px;">${t.blurb}</div>`;
      return;
    }
    const base = TROOPS[selectedTower.type];
    const s = towerStats(selectedTower);
    const maxed = selectedTower.level >= MAX_LEVEL;
    const cost = maxed ? 0 : upgradeCost(selectedTower.type, selectedTower.level);
    box.className = '';
    box.innerHTML = `
      <div class="td-stat"><span>Troop</span><b>${base.icon} ${base.name}</b></div>
      <div class="td-stat"><span>Level</span><b>${selectedTower.level} / ${MAX_LEVEL}</b></div>
      <div class="td-stat"><span>Targets</span>${targetTag(base.targets)}</div>
      <div class="td-stat"><span>DPS</span><b>${dpsOf(selectedTower)}</b></div>
      <div class="td-stat"><span>Damage</span><b>${s.damage.toFixed(1)}</b></div>
      <div class="td-stat"><span>Range</span><b>${Math.round(s.range)}</b></div>
      <div class="td-stat"><span>Fire rate</span><b>${(60/s.cooldown).toFixed(2)}/s</b></div>
      ${s.splash > 0 ? `<div class="td-stat"><span>Splash</span><b>${Math.round(s.splash)}</b></div>` : ''}
      ${s.slow > 0 ? `<div class="td-stat"><span>Slow</span><b>${Math.round(s.slow*100)}%</b></div>` : ''}
      ${s.chain > 0 ? `<div class="td-stat"><span>Chains</span><b>+${s.chain}</b></div>` : ''}
      <div class="td-stat"><span>Kills</span><b>${selectedTower.kills}</b></div>
      ${maxed
        ? `<button class="btn btn-secondary" disabled>Max Level</button>`
        : `<button class="btn btn-primary" ${gold < cost ? 'disabled':''} onclick="TowerDefenseGame.upgradeSelected()">Upgrade · 🪙 ${cost}</button>`}
      <button class="btn btn-secondary" onclick="TowerDefenseGame.sellSelected()">Sell · +🪙 ${sellValue(selectedTower)}</button>`;
  }

  function sellValue(t){
    let spent = TROOPS[t.type].cost;
    for(let l=1;l<t.level;l++) spent += upgradeCost(t.type, l);
    return Math.floor(spent/2);
  }

  function selectTroop(id){
    selectedTroop = id;
    selectedTower = null;
    Sfx.play('click');
    renderShop();
    renderInspector();
  }

  function upgradeSelected(){
    if(!selectedTower || selectedTower.level >= MAX_LEVEL) return;
    const cost = upgradeCost(selectedTower.type, selectedTower.level);
    if(gold < cost){ say('Not enough gold'); return; }
    gold -= cost;
    selectedTower.level++;
    Sfx.play('perfect');
    updateHud();
    renderShop();
    renderInspector();
  }

  function sellSelected(){
    if(!selectedTower) return;
    gold += sellValue(selectedTower);
    towers.splice(towers.indexOf(selectedTower), 1);
    selectedTower = null;
    Sfx.play('coin');
    updateHud();
    renderShop();
    renderInspector();
  }

  /* ---------------- waves ---------------- */
  function waveComposition(n){
    const out = [];
    const push = (type, count)=>{ for(let i=0;i<count;i++) out.push(type); };
    push('grunt', 4 + Math.floor(n*1.3));
    if(n >= 2) push('runner', Math.floor(n*0.9));
    if(n >= 4) push('flyer', Math.floor((n-2)*0.7));
    if(n >= 6) push('brute', Math.floor((n-4)*0.5));
    if(n >= 9) push('swarm', Math.floor((n-7)*1.2));
    // shuffle so the order isn't predictable
    for(let i=out.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function startWave(){
    spawnQueue = waveComposition(wave);
    spawnTimer = 0;
    say('Wave ' + wave + ' — ' + spawnQueue.length + ' incoming');
    Sfx.play('alarm');
  }

  function spawnEnemy(type){
    const base = ENEMIES[type];
    const scale = 1 + (wave-1) * 0.16;
    enemies.push({
      type,
      kind: base.kind,
      dist: 0,
      hp: base.hp * scale,
      maxHp: base.hp * scale,
      speed: base.speed,
      slowTimer: 0,
      slowAmount: 0,
      r: base.r,
      color: base.color,
      bounty: base.bounty,
      hitFlash: 0
    });
  }

  /* ---------------- targeting ---------------- */
  function canHit(troop, enemy){
    if(troop.targets === 'both') return true;
    return troop.targets === enemy.kind;
  }

  function fire(t, target, stats){
    shots.push({ x:t.x, y:t.y, tx:target.x, ty:target.y, life:1, color:TROOPS[t.type].color });
    damage(target, stats.damage, t);
    if(stats.splash > 0){
      enemies.forEach(e=>{
        if(e === target || e.hp <= 0) return;
        const p = pointAtDistance(e.dist);
        if(Math.hypot(p.x-target.x, p.y-target.y) < stats.splash) damage(e, stats.damage*0.55, t);
      });
      puffs.push({ x:target.x, y:target.y, r:6, max:stats.splash, life:1, color:TROOPS[t.type].color });
    }
    if(stats.chain > 0){
      let chained = 0;
      for(const e of enemies){
        if(chained >= stats.chain) break;
        if(e === target || e.hp <= 0 || !canHit(TROOPS[t.type], e)) continue;
        const p = pointAtDistance(e.dist);
        if(Math.hypot(p.x-target.x, p.y-target.y) < 62){
          shots.push({ x:target.x, y:target.y, tx:p.x, ty:p.y, life:1, color:TROOPS[t.type].color });
          damage(e, stats.damage*0.7, t);
          chained++;
        }
      }
    }
    if(stats.slow > 0){
      target.slowTimer = 70;
      target.slowAmount = stats.slow;
    }
  }

  function damage(e, amount, sourceTower){
    e.hp -= amount;
    e.hitFlash = 5;
    if(e.hp <= 0 && !e.counted){
      e.counted = true;
      kills++;
      gold += e.bounty;
      if(sourceTower) sourceTower.kills++;
    }
  }

  /* ---------------- input ---------------- */
  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height)
    };
  }

  function onCanvasClick(e){
    if(!running || paused) return;
    const p = canvasPos(e);

    // clicking a deployed troop inspects it rather than building
    const existing = towers.find(t => Math.hypot(t.x-p.x, t.y-p.y) < 20);
    if(existing){
      selectedTower = existing;
      Sfx.play('select');
      renderInspector();
      return;
    }

    const troop = TROOPS[selectedTroop];
    if(gold < troop.cost){ say('Not enough gold for ' + troop.name); Sfx.play('alarm'); return; }
    if(distToPath(p.x, p.y) < 26){ say("Can't build on the path"); Sfx.play('alarm'); return; }
    if(towers.some(t => Math.hypot(t.x-p.x, t.y-p.y) < 30)){ say('Too close to another troop'); Sfx.play('alarm'); return; }

    gold -= troop.cost;
    const tower = { x:p.x, y:p.y, type:selectedTroop, level:1, timer:0, kills:0, angle:0 };
    towers.push(tower);
    selectedTower = tower;
    Sfx.play('coin');
    updateHud();
    renderShop();
    renderInspector();
  }

  function onCanvasMove(e){
    if(!running) return;
    hoverPos = canvasPos(e);
  }
  function onCanvasLeave(){ hoverPos = null; }

  /* ---------------- loop ---------------- */
  function gameOver(){
    running = false;
    updateStat('towerdefense', [{stat:'bestWave', type:'max', value:wavesCleared}]);
    zipReactToScore('towerdefense', 'bestWave', wavesCleared);
    if(wavesCleared > 0) earnTokens('towerdefense_wave', wavesCleared);
    document.getElementById('towerdefense-result-text').textContent = 'BASE OVERRUN';
    document.getElementById('towerdefense-result-sub').textContent =
      `You held the line through ${wavesCleared} wave${wavesCleared===1?'':'s'} and racked up ${kills} kills.`;
    document.getElementById('towerdefense-play').classList.add('hidden');
    document.getElementById('towerdefense-result').classList.remove('hidden');
  }

  function update(){
    frame++;
    if(messageTimer > 0) messageTimer--;

    if(spawnQueue.length === 0 && enemies.length === 0){
      waveDelay--;
      if(waveDelay <= 0){
        if(frame > 60){ wavesCleared = wave; wave++; }
        startWave();
        waveDelay = 150;
      }
    }

    if(spawnQueue.length){
      spawnTimer--;
      if(spawnTimer <= 0){
        spawnEnemy(spawnQueue.shift());
        spawnTimer = Math.max(14, 40 - wave);
      }
    }

    for(let i=enemies.length-1;i>=0;i--){
      const e = enemies[i];
      if(e.hitFlash > 0) e.hitFlash--;
      let speed = e.speed;
      if(e.slowTimer > 0){ e.slowTimer--; speed *= (1 - e.slowAmount); }
      e.dist += speed;
      const p = pointAtDistance(e.dist);
      e.x = p.x; e.y = p.y;
      if(e.hp <= 0){
        puffs.push({ x:e.x, y:e.y, r:3, max:22, life:1, color:e.color });
        enemies.splice(i,1);
        updateHud();
        continue;
      }
      if(e.dist >= TOTAL_LEN){
        enemies.splice(i,1);
        lives--;
        Sfx.play('hit', 0.7);
        updateHud();
        if(lives <= 0){ gameOver(); return; }
      }
    }

    towers.forEach(t=>{
      const stats = towerStats(t);
      const base = TROOPS[t.type];
      t.timer--;
      // Nearest valid target that this troop is actually allowed to shoot.
      let best = null, bestD = Infinity;
      for(const e of enemies){
        if(e.hp <= 0 || !canHit(base, e)) continue;
        const d = Math.hypot(e.x-t.x, e.y-t.y);
        if(d <= stats.range && d < bestD){ bestD = d; best = e; }
      }
      if(best) t.angle = Math.atan2(best.y-t.y, best.x-t.x);
      if(best && t.timer <= 0){
        t.timer = stats.cooldown;
        fire(t, best, stats);
      }
    });

    for(let i=shots.length-1;i>=0;i--){
      shots[i].life -= 0.14;
      if(shots[i].life <= 0) shots.splice(i,1);
    }
    for(let i=puffs.length-1;i>=0;i--){
      const pf = puffs[i];
      pf.r += (pf.max - pf.r) * 0.3;
      pf.life -= 0.07;
      if(pf.life <= 0) puffs.splice(i,1);
    }
  }

  function render(){
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0,0,W,H);

    // buildable ground texture
    ctx.strokeStyle = 'rgba(120,150,220,0.06)';
    ctx.lineWidth = 1;
    for(let x=0;x<W;x+=28){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for(let y=0;y<H;y+=28){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // path
    ctx.strokeStyle = '#1d2a44';
    ctx.lineWidth = 46;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
    for(let i=1;i<WAYPOINTS.length;i++) ctx.lineTo(WAYPOINTS[i].x, WAYPOINTS[i].y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(125,211,255,0.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([9,11]);
    ctx.stroke();
    ctx.setLineDash([]);

    // base
    const endP = WAYPOINTS[WAYPOINTS.length-1];
    ctx.fillStyle = '#45ffb0';
    ctx.shadowColor = '#45ffb0';
    ctx.shadowBlur = 18;
    ctx.fillRect(endP.x-22, endP.y-22, 22, 44);
    ctx.shadowBlur = 0;

    // placement preview
    if(hoverPos && !selectedTower){
      const troop = TROOPS[selectedTroop];
      const blocked = distToPath(hoverPos.x, hoverPos.y) < 26 ||
                      towers.some(t => Math.hypot(t.x-hoverPos.x, t.y-hoverPos.y) < 30) ||
                      gold < troop.cost;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = blocked ? '#ff5454' : troop.color;
      ctx.fillStyle = blocked ? 'rgba(255,84,84,0.08)' : 'rgba(69,255,176,0.07)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hoverPos.x, hoverPos.y, troop.range, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // towers
    towers.forEach(t=>{
      const base = TROOPS[t.type];
      const stats = towerStats(t);
      if(t === selectedTower){
        ctx.save();
        ctx.strokeStyle = base.color;
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5,5]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, stats.range, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.shadowColor = base.color;
      ctx.shadowBlur = t === selectedTower ? 20 : 10;
      ctx.fillStyle = base.color;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // barrel points at whatever it's shooting
      ctx.rotate(t.angle);
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(4, -3.5, 15, 7);
      ctx.restore();

      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0b1220';
      ctx.fillText(base.icon, t.x, t.y+4);
      // level pips
      for(let i=0;i<t.level;i++){
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(t.x - 10 + i*5, t.y + 15, 3, 3);
      }
    });

    // shots
    shots.forEach(s=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.4;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.tx, s.ty);
      ctx.stroke();
      ctx.restore();
    });

    // enemies
    enemies.forEach(e=>{
      ctx.save();
      if(e.kind === 'air'){
        // flyers ride above the path with a shadow beneath
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + 6, e.r*0.8, e.r*0.3, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const drawY = e.kind === 'air' ? e.y - 12 : e.y;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
      ctx.beginPath();
      if(e.kind === 'air'){
        ctx.moveTo(e.x, drawY - e.r);
        ctx.lineTo(e.x + e.r, drawY + e.r*0.7);
        ctx.lineTo(e.x - e.r, drawY + e.r*0.7);
        ctx.closePath();
      } else {
        ctx.arc(e.x, drawY, e.r, 0, Math.PI*2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      if(e.slowTimer > 0){
        ctx.strokeStyle = '#7dd3ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // hp bar
      const w = e.r*2.4;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - w/2, drawY - e.r - 8, w, 3);
      ctx.fillStyle = '#45ffb0';
      ctx.fillRect(e.x - w/2, drawY - e.r - 8, w * Math.max(0, e.hp/e.maxHp), 3);
      ctx.restore();
    });

    puffs.forEach(pf=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, pf.life)*0.7;
      ctx.strokeStyle = pf.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(pf.x, pf.y, pf.r, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    });

    ctx.textAlign = 'left';
    ctx.font = '11px "JetBrains Mono", monospace';
    if(messageTimer > 0){
      ctx.fillStyle = 'rgba(255,200,87,0.95)';
      ctx.fillText(message, 14, 22);
    }
    ctx.fillStyle = 'rgba(232,236,241,0.45)';
    ctx.fillText('SELECTED: ' + TROOPS[selectedTroop].name + ' · click ground to deploy, click a troop to inspect', 14, H-14);
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('towerdefense-setup').classList.add('hidden');
    document.getElementById('towerdefense-result').classList.add('hidden');
    document.getElementById('towerdefense-play').classList.remove('hidden');
    freshState();
    startWave();
    paused = false;
    running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('towerdefense-setup').classList.remove('hidden');
    document.getElementById('towerdefense-play').classList.add('hidden');
    document.getElementById('towerdefense-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }
  function onKeyPress(name){
    // 1-5 hotkeys for the troop menu
    const ids = Object.keys(TROOPS);
    const n = parseInt(name, 10);
    if(n >= 1 && n <= ids.length) selectTroop(ids[n-1]);
  }

  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mousemove', onCanvasMove);
  canvas.addEventListener('mouseleave', onCanvasLeave);

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning,
          selectTroop, upgradeSelected, sellSelected};
})();
