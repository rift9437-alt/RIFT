/* =========================================================
   GAME 13: NEON SUMO
   =========================================================
   Momentum brawling on a shrinking disc — the only versus cabinet where
   nobody has a health bar. Same setup shape as the other 1v1 games: local
   multiplayer or a bot with three difficulties. */
const SumoGame = (function(){
  const canvas = document.getElementById('sumo-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const CX = W/2, CY = H/2;
  const ARENA_START = 205;
  const ARENA_MIN = 118;
  const SHRINK_RATE = 7.5;          // px per second once the round is going
  const DISC_R = 22;
  const ACCEL = 780;
  const FRICTION = 0.90;
  const MAX_SPEED = 320;
  const DASH_COST = 34;
  const DASH_IMPULSE = 430;
  const STAM_REGEN = 26;
  const WIN_ROUNDS = 3;

  const DIFFS = {
    easy:   { label:'EASY',   react:0.55, dashChance:0.25, aim:0.5,  aggression:0.7 },
    medium: { label:'MEDIUM', react:0.8,  dashChance:0.55, aim:0.78, aggression:1.0 },
    hard:   { label:'HARD',   react:1.0,  dashChance:0.85, aim:0.95, aggression:1.25 }
  };
  let mode = 'single';
  let difficulty = 'medium';

  let rafId = null, running = false, paused = false;
  let p1, p2, arenaR, scoreP1, scoreP2, pads, sparks;
  let roundState, roundTimer, banner, lastTime, shake, botTimer, botDir;

  function setMode(m){
    mode = m;
    document.getElementById('sumo-mode-single').classList.toggle('selected', m==='single');
    document.getElementById('sumo-mode-multi').classList.toggle('selected', m==='multi');
    document.getElementById('sumo-diff-section').classList.toggle('hidden', m!=='single');
    document.getElementById('sumo-p2-label').textContent = m==='single' ? 'BOT' : 'PLAYER 2';
  }
  function setDifficulty(d){
    difficulty = d;
    ['easy','medium','hard'].forEach(k=>{
      document.getElementById('sumo-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  function makeDisc(x, color){
    return { x, y:CY, vx:0, vy:0, stamina:100, dashing:0, heavy:0, color, hitFlash:0 };
  }

  function resetRound(){
    p1 = makeDisc(CX - 90, '#2de2c5');
    p2 = makeDisc(CX + 90, '#ff3d8a');
    arenaR = ARENA_START;
    pads = [];
    sparks = [];
    roundState = 'countdown';
    roundTimer = 1.6;
    botTimer = 0;
    botDir = { x:0, y:0 };
    showBanner('READY');
    updateHud();
  }

  function freshState(){
    scoreP1 = 0;
    scoreP2 = 0;
    shake = 0;
    resetRound();
  }

  function showBanner(text){
    banner = text;
    const el = document.getElementById('sumo-banner');
    el.textContent = text;
    el.classList.remove('hidden');
  }
  function hideBanner(){
    banner = null;
    document.getElementById('sumo-banner').classList.add('hidden');
  }

  function updateHud(){
    document.getElementById('sumo-score').textContent = scoreP1 + ' : ' + scoreP2;
    document.getElementById('sumo-p1-stam').style.width = Math.max(0, p1.stamina) + '%';
    document.getElementById('sumo-p2-stam').style.width = Math.max(0, p2.stamina) + '%';
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    setMode(mode);
    setDifficulty(difficulty);
    document.getElementById('sumo-setup').classList.remove('hidden');
    document.getElementById('sumo-play').classList.add('hidden');
    document.getElementById('sumo-result').classList.add('hidden');
    document.getElementById('sumo-banner').classList.add('hidden');
    hideCompanions();
  }

  function start(){
    document.getElementById('sumo-setup').classList.add('hidden');
    document.getElementById('sumo-result').classList.add('hidden');
    document.getElementById('sumo-play').classList.remove('hidden');
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
    if(roundState !== 'live') return;
    if(name === 'space') tryDash(p1);
    if(name === 'enter' && mode === 'multi') tryDash(p2);
  }

  function tryDash(d){
    if(d.stamina < DASH_COST || d.dashing > 0) return;
    const len = Math.hypot(d.vx, d.vy);
    let dx, dy;
    if(len > 20){ dx = d.vx/len; dy = d.vy/len; }
    else {
      const other = d === p1 ? p2 : p1;
      const a = Math.atan2(other.y-d.y, other.x-d.x);
      dx = Math.cos(a); dy = Math.sin(a);
    }
    d.stamina -= DASH_COST;
    d.dashing = 0.28;
    d.vx += dx * DASH_IMPULSE;
    d.vy += dy * DASH_IMPULSE;
    Sfx.play('whoosh');
  }

  function spawnPad(){
    const a = Math.random()*Math.PI*2;
    const r = Math.random() * (arenaR - 50);
    pads.push({ x: CX + Math.cos(a)*r, y: CY + Math.sin(a)*r, phase: Math.random()*Math.PI*2, life: 9 });
  }

  function burst(x, y, color, n){
    for(let i=0;i<n;i++){
      sparks.push({
        x, y,
        vx: (Math.random()-0.5)*420,
        vy: (Math.random()-0.5)*420,
        life: 0.5 + Math.random()*0.4,
        color
      });
    }
  }

  function driveDisc(d, ax, ay, dt){
    const len = Math.hypot(ax, ay);
    if(len > 0){
      const boost = d.dashing > 0 ? 1.35 : 1;
      d.vx += (ax/len) * ACCEL * boost * dt;
      d.vy += (ay/len) * ACCEL * boost * dt;
    }
    d.vx *= Math.pow(FRICTION, dt*60);
    d.vy *= Math.pow(FRICTION, dt*60);
    const sp = Math.hypot(d.vx, d.vy);
    const cap = d.dashing > 0 ? MAX_SPEED*2.4 : MAX_SPEED;
    if(sp > cap){ d.vx = d.vx/sp*cap; d.vy = d.vy/sp*cap; }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if(d.dashing > 0) d.dashing -= dt;
    if(d.heavy > 0) d.heavy -= dt;
    if(d.hitFlash > 0) d.hitFlash -= dt;
    d.stamina = Math.min(100, d.stamina + STAM_REGEN*dt);
  }

  function botInput(dt){
    const cfg = DIFFS[difficulty];
    botTimer -= dt;
    if(botTimer <= 0){
      botTimer = 0.09 + (1 - cfg.react) * 0.35;
      // Line up on the far side of the player from the arena centre, so a
      // successful shove pushes them toward the edge rather than past it.
      const toCenter = Math.atan2(CY - p1.y, CX - p1.x);
      const targetX = p1.x - Math.cos(toCenter) * (DISC_R*1.9);
      const targetY = p1.y - Math.sin(toCenter) * (DISC_R*1.9);
      const idealX = targetX - p2.x, idealY = targetY - p2.y;
      const jitter = (1 - cfg.aim) * 180;
      let ax = idealX + (Math.random()-0.5)*jitter;
      let ay = idealY + (Math.random()-0.5)*jitter;

      // Don't chase so hard you fling yourself out.
      const edge = Math.hypot(p2.x-CX, p2.y-CY);
      if(edge > arenaR - DISC_R*2.2){
        ax = (CX - p2.x) * 1.4;
        ay = (CY - p2.y) * 1.4;
      }
      const len = Math.hypot(ax, ay) || 1;
      botDir = { x: ax/len * cfg.aggression, y: ay/len * cfg.aggression };

      const dist = Math.hypot(p1.x-p2.x, p1.y-p2.y);
      const playerOutward = Math.hypot(p1.x-CX, p1.y-CY) > arenaR*0.45;
      if(dist < DISC_R*3.4 && playerOutward && p2.stamina > DASH_COST + 8 && Math.random() < cfg.dashChance){
        tryDash(p2);
      }
      // Grab a nearby pad if one is basically on the way.
      const pad = pads.find(pd=>Math.hypot(pd.x-p2.x, pd.y-p2.y) < 130);
      if(pad && Math.random() < 0.6){
        const pl = Math.hypot(pad.x-p2.x, pad.y-p2.y) || 1;
        botDir = { x:(pad.x-p2.x)/pl, y:(pad.y-p2.y)/pl };
      }
    }
    return botDir;
  }

  function collide(){
    const dx = p2.x-p1.x, dy = p2.y-p1.y;
    const dist = Math.hypot(dx, dy);
    if(dist >= DISC_R*2 || dist === 0) return;

    const nx = dx/dist, ny = dy/dist;
    const overlap = DISC_R*2 - dist;
    p1.x -= nx*overlap/2; p1.y -= ny*overlap/2;
    p2.x += nx*overlap/2; p2.y += ny*overlap/2;

    const rvx = p2.vx - p1.vx, rvy = p2.vy - p1.vy;
    const sep = rvx*nx + rvy*ny;
    if(sep > 0) return;

    // Dashing (and a power pad) turn a bump into a proper shove.
    const p1Force = (p1.dashing > 0 ? 2.4 : 1) * (p1.heavy > 0 ? 1.5 : 1);
    const p2Force = (p2.dashing > 0 ? 2.4 : 1) * (p2.heavy > 0 ? 1.5 : 1);
    const impulse = -sep * 1.05;
    p1.vx -= nx*impulse*p2Force; p1.vy -= ny*impulse*p2Force;
    p2.vx += nx*impulse*p1Force; p2.vy += ny*impulse*p1Force;

    const big = p1.dashing > 0 || p2.dashing > 0 || p1.heavy > 0 || p2.heavy > 0;
    p1.hitFlash = 0.18; p2.hitFlash = 0.18;
    shake = big ? 14 : 6;
    burst((p1.x+p2.x)/2, (p1.y+p2.y)/2, big ? '#ffc857' : '#e8ecf1', big ? 16 : 8);
    Sfx.play(big ? 'thud' : 'hit', big ? 0.85 : 1.3);
  }

  function ringOut(){
    const d1 = Math.hypot(p1.x-CX, p1.y-CY);
    const d2 = Math.hypot(p2.x-CX, p2.y-CY);
    const out1 = d1 > arenaR + DISC_R*0.55;
    const out2 = d2 > arenaR + DISC_R*0.55;
    if(!out1 && !out2) return;

    if(out1 && !out2) scoreP2++;
    else if(out2 && !out1) scoreP1++;
    else { scoreP1++; scoreP2++; }

    burst(out1 ? p1.x : p2.x, out1 ? p1.y : p2.y, out1 ? p1.color : p2.color, 26);
    Sfx.play('explode');
    updateHud();

    if(scoreP1 >= WIN_ROUNDS || scoreP2 >= WIN_ROUNDS){
      endMatch(scoreP1 > scoreP2);
      return;
    }
    roundState = 'between';
    roundTimer = 1.2;
    showBanner(out1 && out2 ? 'DOUBLE RING-OUT!' : (out1 ? (mode==='single'?'BOT SCORES':'P2 SCORES') : 'P1 SCORES'));
  }

  function update(dt){
    if(roundState === 'countdown'){
      roundTimer -= dt;
      showBanner(roundTimer > 0.8 ? 'READY' : 'FIGHT!');
      if(roundTimer <= 0){
        roundState = 'live';
        hideBanner();
        Sfx.play('select');
      }
      return;
    }
    if(roundState === 'between'){
      roundTimer -= dt;
      if(roundTimer <= 0) resetRound();
      return;
    }

    arenaR = Math.max(ARENA_MIN, arenaR - SHRINK_RATE*dt);

    let a1x = 0, a1y = 0;
    if(keys.has('a')) a1x -= 1;
    if(keys.has('d')) a1x += 1;
    if(keys.has('w')) a1y -= 1;
    if(keys.has('s')) a1y += 1;
    driveDisc(p1, a1x, a1y, dt);

    let a2x = 0, a2y = 0;
    if(mode === 'multi'){
      if(keys.has('arrowleft')) a2x -= 1;
      if(keys.has('arrowright')) a2x += 1;
      if(keys.has('arrowup')) a2y -= 1;
      if(keys.has('arrowdown')) a2y += 1;
    } else {
      const bd = botInput(dt);
      a2x = bd.x; a2y = bd.y;
    }
    driveDisc(p2, a2x, a2y, dt);

    collide();

    // power pads
    if(pads.length < 2 && Math.random() < dt*0.5) spawnPad();
    for(let i=pads.length-1;i>=0;i--){
      const pd = pads[i];
      pd.life -= dt;
      pd.phase += dt*3;
      if(pd.life <= 0 || Math.hypot(pd.x-CX, pd.y-CY) > arenaR - 20){ pads.splice(i,1); continue; }
      [p1,p2].forEach(d=>{
        if(pads.indexOf(pd) >= 0 && Math.hypot(pd.x-d.x, pd.y-d.y) < DISC_R + 12){
          d.heavy = 6;
          d.stamina = 100;
          pads.splice(pads.indexOf(pd), 1);
          burst(pd.x, pd.y, '#ffc857', 12);
          Sfx.play('coin');
        }
      });
    }

    for(let i=sparks.length-1;i>=0;i--){
      const s = sparks[i];
      s.x += s.vx*dt; s.y += s.vy*dt;
      s.vx *= 0.94; s.vy *= 0.94;
      s.life -= dt;
      if(s.life <= 0) sparks.splice(i,1);
    }

    if(shake > 0) shake = Math.max(0, shake - 34*dt);
    ringOut();
    updateHud();
  }

  function endMatch(p1Won){
    running = false;
    updateStat('sumo', [{stat:'wins', type:'increment_if', value:1, cond:p1Won}]);
    earnTokens(p1Won ? 'sumo_win' : 'sumo_loss', 1);
    showZipCompanion(p1Won ? 'win' : 'loss');
    Sfx.play(p1Won ? 'win' : 'lose');
    document.getElementById('sumo-result-text').textContent = p1Won ? 'YOU TAKE THE MATCH!' : (mode==='single' ? 'BOT TAKES THE MATCH' : 'PLAYER 2 TAKES THE MATCH');
    document.getElementById('sumo-result-sub').textContent = 'Final ring-outs ' + scoreP1 + ' : ' + scoreP2 + '.';
    document.getElementById('sumo-play').classList.add('hidden');
    document.getElementById('sumo-result').classList.remove('hidden');
    document.getElementById('sumo-banner').classList.add('hidden');
    refreshCabinets();
  }

  function drawDisc(d, isP1){
    ctx.save();
    if(d.heavy > 0){
      ctx.strokeStyle = 'rgba(255,200,87,0.85)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffc857';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(d.x, d.y, DISC_R + 7 + Math.sin(performance.now()/120)*2, 0, Math.PI*2);
      ctx.stroke();
    }
    if(d.dashing > 0){
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x - d.vx*0.03, d.y - d.vy*0.03, DISC_R*0.9, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 22;
    const g = ctx.createRadialGradient(d.x - 6, d.y - 8, 3, d.x, d.y, DISC_R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, d.hitFlash > 0 ? '#ffffff' : d.color);
    g.addColorStop(1, Mini3D.shade(d.color, 0.4));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(d.x, d.y, DISC_R, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(4,6,10,0.75)';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isP1 ? 'P1' : (mode==='single' ? 'AI' : 'P2'), d.x, d.y);
    ctx.restore();
  }

  function render(){
    ctx.save();
    applyShake(ctx, shake);

    ctx.fillStyle = '#05060f';
    ctx.fillRect(-30,-30,W+60,H+60);

    // void beyond the disc
    ctx.save();
    const void_ = ctx.createRadialGradient(CX, CY, arenaR*0.9, CX, CY, arenaR*2.1);
    void_.addColorStop(0, 'rgba(255,61,138,0.10)');
    void_.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = void_;
    ctx.fillRect(0,0,W,H);
    ctx.restore();

    // arena disc
    ctx.save();
    const g = ctx.createRadialGradient(CX, CY, 10, CX, CY, arenaR);
    g.addColorStop(0, '#161d33');
    g.addColorStop(0.85, '#0d1224');
    g.addColorStop(1, '#1b2440');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(CX, CY, arenaR, 0, Math.PI*2);
    ctx.fill();

    ctx.strokeStyle = arenaR <= ARENA_MIN + 8 ? '#ff3d8a' : '#2de2c5';
    ctx.lineWidth = 3;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(120,150,220,0.16)';
    ctx.lineWidth = 1;
    for(let i=1;i<4;i++){
      ctx.beginPath();
      ctx.arc(CX, CY, arenaR*(i/4), 0, Math.PI*2);
      ctx.stroke();
    }
    for(let i=0;i<8;i++){
      const a = (i/8)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(a)*arenaR*0.25, CY + Math.sin(a)*arenaR*0.25);
      ctx.lineTo(CX + Math.cos(a)*arenaR, CY + Math.sin(a)*arenaR);
      ctx.stroke();
    }
    ctx.restore();

    pads.forEach(pd=>{
      ctx.save();
      ctx.translate(pd.x, pd.y);
      ctx.rotate(pd.phase);
      ctx.shadowColor = '#ffc857';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffe9a8';
      ctx.globalAlpha = pd.life < 2 ? 0.4 + Math.sin(pd.phase*4)*0.3 : 1;
      ctx.beginPath();
      for(let i=0;i<4;i++){
        const a = (i/4)*Math.PI*2;
        const x = Math.cos(a)*9, y = Math.sin(a)*9;
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });

    sparks.forEach(s=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life*1.6);
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.6, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });

    drawDisc(p1, true);
    drawDisc(p2, false);
    ctx.restore();

    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('FIRST TO ' + WIN_ROUNDS + ' RING-OUTS' + (mode==='single' ? ' · ' + DIFFS[difficulty].label : ''), 14, H-14);
    if(arenaR <= ARENA_MIN + 8){
      ctx.fillStyle = 'rgba(255,61,138,0.9)';
      ctx.fillText('ARENA AT MINIMUM', 14, H-30);
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

  setMode(mode);
  setDifficulty(difficulty);
  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning, setMode, setDifficulty};
})();
