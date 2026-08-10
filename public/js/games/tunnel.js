/* =========================================================
   GAME 9: HYPER TUNNEL (3D)
   =========================================================
   A true-perspective tube racer. The camera sits on the tunnel's axis and
   rolls with the player, so spinning around the tube spins the whole world —
   every ring, barrier and energy cell is projected through Mini3D. */
const TunnelGame = (function(){
  const canvas = document.getElementById('tunnel-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const FOCAL = 430;
  const R = 6;                 // tunnel radius in world units
  const SIDES = 16;            // ring resolution
  const RING_SPACING = 3;
  const VIEW_DEPTH = 66;
  const SHIP_SCREEN_Y = H * 0.78;
  const MAX_SHIELDS = 3;

  const DIFFS = {
    cruise:     { label:'CRUISE',     speed:13, ramp:0.26, gap:1.60, spacing:27 },
    warp:       { label:'WARP',       speed:19, ramp:0.42, gap:1.28, spacing:23 },
    lightspeed: { label:'LIGHTSPEED', speed:26, ramp:0.58, gap:1.02, spacing:19 }
  };
  let difficulty = 'warp';

  let rafId = null, running = false, paused = false;
  let camZ, angle, angleVel, speed, score, mult, shields, boost, boosting;
  let barriers, cells, sparks, nextBarrierZ, nextCellZ, gatesCleared, cellsTaken;
  let invuln, shake, lastTime, popTimer;

  function setDifficulty(d){
    difficulty = d;
    Object.keys(DIFFS).forEach(k=>{
      document.getElementById('tunnel-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  function freshState(){
    const cfg = DIFFS[difficulty];
    camZ = 0;
    angle = -Math.PI/2;
    angleVel = 0;
    speed = cfg.speed;
    score = 0;
    mult = 1;
    shields = MAX_SHIELDS;
    boost = 100;
    boosting = false;
    barriers = [];
    cells = [];
    sparks = [];
    gatesCleared = 0;
    cellsTaken = 0;
    invuln = 0;
    shake = 0;
    nextBarrierZ = 34;
    nextCellZ = 20;
    updateHud();
  }

  function updateHud(){
    document.getElementById('tunnel-shields').textContent = shields;
    document.getElementById('tunnel-mult').textContent = mult.toFixed(1);
    document.getElementById('tunnel-score').textContent = Math.floor(score);
    document.getElementById('tunnel-boost-fill').style.width = Math.max(0, boost) + '%';
  }

  function pop(text){
    const el = document.getElementById('tunnel-pop');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(popTimer);
    popTimer = setTimeout(()=>el.classList.add('hidden'), 800);
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    setDifficulty(difficulty);
    document.getElementById('tunnel-setup').classList.remove('hidden');
    document.getElementById('tunnel-play').classList.add('hidden');
    document.getElementById('tunnel-result').classList.add('hidden');
    document.getElementById('tunnel-pop').classList.add('hidden');
    hideCompanions();
  }

  function start(){
    document.getElementById('tunnel-setup').classList.add('hidden');
    document.getElementById('tunnel-result').classList.add('hidden');
    document.getElementById('tunnel-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    showZipCompanion('idle');
    Sfx.play('whoosh');
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
  function onKeyPress(name){}

  function cam(){
    // Rolling the camera by -90° minus the player's angle keeps the ship
    // pinned to the bottom of the screen while the tunnel spins around it.
    return { x:0, y:0, z:camZ, yaw:0, pitch:0, roll:-Math.PI/2 - angle };
  }

  function projectWorld(x, y, z, c){
    const v = Mini3D.toView({x,y,z}, c);
    if(v.z < Mini3D.NEAR) return null;
    return Mini3D.project(v, W, H, FOCAL);
  }

  function angDiff(a, b){
    let d = a - b;
    while(d > Math.PI) d -= Math.PI*2;
    while(d < -Math.PI) d += Math.PI*2;
    return d;
  }

  function spawnBarrier(z){
    const cfg = DIFFS[difficulty];
    // Gaps tighten a little the deeper you get, but never below a fair width.
    const tighten = Math.min(0.35, camZ / 6000);
    barriers.push({
      z,
      gapAngle: Math.random()*Math.PI*2,
      gapWidth: Math.max(0.78, cfg.gap - tighten),
      hue: ['#ff3d8a','#ff8a3d','#a78bff','#2de2c5'][Math.floor(Math.random()*4)],
      passed: false,
      spin: (Math.random()-0.5) * 0.5
    });
  }

  function spawnCell(z){
    cells.push({ z, angle: Math.random()*Math.PI*2, taken:false, phase: Math.random()*Math.PI*2 });
  }

  function spark(count, color){
    for(let i=0;i<count;i++){
      sparks.push({
        a: Math.random()*Math.PI*2,
        r: R*0.2 + Math.random()*R*0.8,
        z: camZ + 4 + Math.random()*6,
        vz: -6 - Math.random()*10,
        life: 1,
        color
      });
    }
  }

  function loseShield(){
    shields--;
    invuln = 1.1;
    mult = 1;
    speed = Math.max(DIFFS[difficulty].speed * 0.7, speed - 5);
    shake = 16;
    spark(22, '#ff3d8a');
    Sfx.play('explode');
    if(shields <= 0) gameOver();
    else pop('SHIELD DOWN · ' + shields + ' LEFT');
  }

  function update(dt){
    const cfg = DIFFS[difficulty];

    // --- steering: momentum-based roll around the tube ---
    const turnAccel = 7.5;
    if(keys.has('a') || keys.has('arrowleft')) angleVel -= turnAccel * dt;
    if(keys.has('d') || keys.has('arrowright')) angleVel += turnAccel * dt;
    angleVel *= Math.pow(0.02, dt);
    angleVel = clamp(angleVel, -5.5, 5.5);
    angle += angleVel * dt;

    // --- boost ---
    boosting = (keys.has('shift') || keys.has('control')) && boost > 0;
    if(boosting){
      boost = Math.max(0, boost - 34*dt);
      speed += 26 * dt;
    } else {
      boost = Math.min(100, boost + 5*dt);
      speed += cfg.ramp * dt;
      const cruise = cfg.speed + cfg.ramp * (camZ/40);
      if(speed > cruise) speed -= 9 * dt;
    }
    speed = Math.min(speed, cfg.speed + 40);

    camZ += speed * dt;
    score += dt * speed * mult * (boosting ? 2.2 : 1);
    if(invuln > 0) invuln -= dt;
    if(shake > 0) shake = Math.max(0, shake - 40*dt);

    // --- streaming spawns ---
    while(nextBarrierZ < camZ + VIEW_DEPTH){
      spawnBarrier(nextBarrierZ);
      nextBarrierZ += cfg.spacing * (0.8 + Math.random()*0.5);
    }
    while(nextCellZ < camZ + VIEW_DEPTH){
      spawnCell(nextCellZ);
      nextCellZ += 15 + Math.random()*22;
    }

    // --- barriers ---
    for(let i=barriers.length-1;i>=0;i--){
      const b = barriers[i];
      b.gapAngle += b.spin * dt;
      if(b.z < camZ - 4){ barriers.splice(i,1); continue; }
      if(!b.passed && b.z <= camZ + 0.6){
        b.passed = true;
        const off = Math.abs(angDiff(angle, b.gapAngle));
        if(off > b.gapWidth/2){
          if(invuln <= 0) loseShield();
        } else {
          gatesCleared++;
          score += 25 * mult;
          const clean = off < b.gapWidth * 0.18;
          if(clean){
            mult = Math.min(5, mult + 0.2);
            pop('THREADED IT · ×' + mult.toFixed(1));
            Sfx.play('perfect');
          } else {
            Sfx.play('laser');
          }
        }
        if(!running) return;
      }
    }

    // --- energy cells ---
    for(let i=cells.length-1;i>=0;i--){
      const c = cells[i];
      if(c.z < camZ - 3){ cells.splice(i,1); continue; }
      if(!c.taken && c.z <= camZ + 1.0 && Math.abs(angDiff(angle, c.angle)) < 0.45){
        c.taken = true;
        cellsTaken++;
        boost = Math.min(100, boost + 26);
        mult = Math.min(5, mult + 0.1);
        score += 40 * mult;
        spark(10, '#ffc857');
        Sfx.play('coin');
        cells.splice(i,1);
      }
    }

    for(let i=sparks.length-1;i>=0;i--){
      const s = sparks[i];
      s.z += s.vz * dt;
      s.life -= dt * 1.6;
      if(s.life <= 0 || s.z < camZ) sparks.splice(i,1);
    }

    updateHud();
  }

  function gameOver(){
    running = false;
    const finalScore = Math.floor(score);
    updateStat('tunnel', [{stat:'highScore', type:'max', value:finalScore}]);
    zipReactToScore('tunnel', 'highScore', finalScore);
    if(gatesCleared > 0) earnTokens('tunnel_gate', gatesCleared);
    Sfx.play('lose');
    document.getElementById('tunnel-result-text').textContent = 'TUNNEL COLLAPSED';
    document.getElementById('tunnel-result-sub').textContent =
      'Score ' + finalScore + ' on ' + DIFFS[difficulty].label + ' — ' + gatesCleared +
      ' gate' + (gatesCleared===1?'':'s') + ' threaded, ' + cellsTaken + ' energy cell' + (cellsTaken===1?'':'s') + ' collected.';
    document.getElementById('tunnel-play').classList.add('hidden');
    document.getElementById('tunnel-result').classList.remove('hidden');
    refreshCabinets();
  }

  function ringPoints(z, c, radius){
    const pts = [];
    for(let i=0;i<SIDES;i++){
      const a = (i/SIDES) * Math.PI*2;
      const p = projectWorld(Math.cos(a)*radius, Math.sin(a)*radius, z, c);
      pts.push(p);
    }
    return pts;
  }

  function drawTunnel(c){
    const first = Math.ceil((camZ + 1.2) / RING_SPACING) * RING_SPACING;
    const rings = [];
    for(let z = first; z < camZ + VIEW_DEPTH; z += RING_SPACING){
      rings.push({ z, pts: ringPoints(z, c, R) });
    }

    // Longitudinal rails first so the rings read as bands on top of them.
    ctx.lineWidth = 1;
    for(let i=0;i<SIDES;i++){
      ctx.beginPath();
      let started = false;
      for(const ring of rings){
        const p = ring.pts[i];
        if(!p){ started = false; continue; }
        if(!started){ ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(120,160,255,0.35)' : 'rgba(80,110,190,0.14)';
      ctx.stroke();
    }

    for(let r=0;r<rings.length;r++){
      const ring = rings[r];
      const dist = ring.z - camZ;
      const fade = Math.max(0.06, Math.min(0.9, 14 / dist));
      const beat = (Math.floor(ring.z / RING_SPACING) % 4 === 0);
      ctx.beginPath();
      let started = false;
      for(let i=0;i<=SIDES;i++){
        const p = ring.pts[i % SIDES];
        if(!p){ started = false; continue; }
        if(!started){ ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = beat
        ? `rgba(45,226,197,${fade})`
        : `rgba(90,120,210,${fade*0.5})`;
      ctx.lineWidth = beat ? 2 : 1;
      ctx.stroke();
    }
  }

  function barrierFaces(c){
    const faces = [];
    for(const b of barriers){
      if(b.z < camZ + 0.4 || b.z > camZ + VIEW_DEPTH) continue;
      // Everything except the gap is solid — build it as a set of quads
      // walking around the ring from one edge of the gap to the other.
      const start = b.gapAngle + b.gapWidth/2;
      const sweep = Math.PI*2 - b.gapWidth;
      const steps = 14;
      const inner = R * 0.42;
      for(let i=0;i<steps;i++){
        const a0 = start + (i/steps)*sweep;
        const a1 = start + ((i+1)/steps)*sweep;
        faces.push({
          pts: [
            { x: Math.cos(a0)*R, y: Math.sin(a0)*R, z: b.z },
            { x: Math.cos(a1)*R, y: Math.sin(a1)*R, z: b.z },
            { x: Math.cos(a1)*inner, y: Math.sin(a1)*inner, z: b.z },
            { x: Math.cos(a0)*inner, y: Math.sin(a0)*inner, z: b.z }
          ],
          fill: Mini3D.shade(b.hue, 0.42),
          stroke: b.hue,
          lineWidth: 1.2,
          glow: b.hue,
          glowBlur: 12,
          fog: 26
        });
      }
    }
    return faces;
  }

  function drawCells(c){
    for(const cell of cells){
      if(cell.z < camZ + 0.5 || cell.z > camZ + VIEW_DEPTH) continue;
      const bob = Math.sin(cell.phase + camZ*0.2) * 0.4;
      const rad = R * 0.62 + bob;
      const p = projectWorld(Math.cos(cell.angle)*rad, Math.sin(cell.angle)*rad, cell.z, c);
      if(!p) continue;
      const size = Math.max(2, 0.55 * p.s);
      ctx.save();
      ctx.globalAlpha = Math.max(0.2, Math.min(1, 22/(cell.z-camZ)));
      ctx.translate(p.x, p.y);
      ctx.rotate(camZ * 0.6 + cell.phase);
      ctx.shadowColor = '#ffc857';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      for(let i=0;i<6;i++){
        const a = (i/6)*Math.PI*2;
        const x = Math.cos(a)*size, y = Math.sin(a)*size;
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawSparks(c){
    ctx.save();
    for(const s of sparks){
      const p = projectWorld(Math.cos(s.a)*s.r, Math.sin(s.a)*s.r, s.z, c);
      if(!p) continue;
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.2, 0.12*p.s), 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawShip(){
    const x = W/2, y = SHIP_SCREEN_Y;
    const flicker = invuln > 0 && Math.floor(invuln*14) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = flicker ? 0.35 : 1;
    ctx.translate(x, y);
    ctx.rotate(clamp(angleVel * 0.09, -0.5, 0.5));

    // thruster
    const flame = 12 + (boosting ? 22 : 8) * (0.7 + Math.random()*0.6);
    const grad = ctx.createLinearGradient(0, 6, 0, 6+flame);
    grad.addColorStop(0, boosting ? '#fff2b0' : '#8fd4ff');
    grad.addColorStop(1, 'rgba(255,61,138,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-7, 6); ctx.lineTo(7, 6); ctx.lineTo(0, 6+flame);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = boosting ? '#ffc857' : '#2de2c5';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#e8ecf1';
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(16, 10);
    ctx.lineTo(0, 3);
    ctx.lineTo(-16, 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = boosting ? '#ffc857' : '#2de2c5';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  function render(){
    const c = cam();
    ctx.save();
    applyShake(ctx, shake);

    const g = ctx.createRadialGradient(W/2, H/2, 10, W/2, H/2, H*0.9);
    g.addColorStop(0, boosting ? '#141a3a' : '#070a18');
    g.addColorStop(1, '#02030a');
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, W+80, H+80);

    drawTunnel(c);
    Mini3D.render(ctx, barrierFaces(c), c, W, H, FOCAL);
    drawCells(c);
    drawSparks(c);
    drawShip();

    if(boosting){
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#ffc857';
      ctx.fillRect(0,0,W,H);
      ctx.restore();
    }

    ctx.restore();

    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.55)';
    ctx.fillText(DIFFS[difficulty].label + ' · ' + Math.round(speed*10) + ' KM/S', 14, H-16);
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
