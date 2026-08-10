/* =========================================================
   GAME 12: GRAVITY GOLF
   =========================================================
   Orbital mini-golf: every shot is an n-body-ish simulation against planets
   that pull, repulsors that push and stars that burn the shot. Holes are
   generated on the fly and get busier the further you get. */
const GolfGame = (function(){
  const canvas = document.getElementById('golf-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const G = 2600;               // gravity constant, tuned for feel not realism
  const MAX_POWER = 9.2;
  const BALL_R = 6;
  const HOLE_R = 15;
  const FRICTION = 0.999;
  const START_BUDGET = 6;

  let rafId = null, running = false, paused = false;
  let ball, bodies, hole, tee, trail, holeNum, strokes, par, budget, banked;
  let aiming, aimAngle, aimPower, dragging, dragPos, moving, sunkFlash;
  let lastTime, popTimer, holesSunk, shake;

  function pop(text){
    const el = document.getElementById('golf-pop');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(popTimer);
    popTimer = setTimeout(()=>el.classList.add('hidden'), 1200);
  }

  function updateHud(){
    document.getElementById('golf-hole').textContent = holeNum;
    document.getElementById('golf-strokes').textContent = strokes;
    document.getElementById('golf-par').textContent = par;
    document.getElementById('golf-budget').textContent = budget;
  }

  function far(ax, ay, bx, by, min){ return Math.hypot(ax-bx, ay-by) > min; }

  function buildHole(){
    const count = Math.min(7, 2 + Math.floor(holeNum/2));
    par = Math.min(7, 3 + Math.floor(holeNum/3));

    let attempt = 0;
    do{
      tee = { x: 70 + Math.random()*70, y: 90 + Math.random()*(H-180) };
      hole = { x: W - (70 + Math.random()*70), y: 90 + Math.random()*(H-180) };
      attempt++;
    } while(!far(tee.x, tee.y, hole.x, hole.y, W*0.55) && attempt < 40);

    bodies = [];
    let guard = 0;
    while(bodies.length < count && guard++ < 400){
      const r = 22 + Math.random()*34;
      const x = 170 + Math.random()*(W-340);
      const y = 50 + Math.random()*(H-100);
      if(!far(x, y, tee.x, tee.y, r + 70)) continue;
      if(!far(x, y, hole.x, hole.y, r + 62)) continue;
      if(bodies.some(b=>!far(x, y, b.x, b.y, r + b.r + 26))) continue;

      const roll = Math.random();
      let kind = 'planet';
      if(holeNum >= 3 && roll < 0.24) kind = 'repulsor';
      else if(holeNum >= 5 && roll < 0.36) kind = 'star';

      bodies.push({
        x, y, r,
        kind,
        mass: (kind === 'star' ? 0.7 : 1) * r * r * 0.012,
        color: kind === 'planet' ? '#4cb8ff' : (kind === 'repulsor' ? '#c9a6ff' : '#ffc857'),
        spin: Math.random()*Math.PI*2,
        orbit: Math.random() < 0.35 ? { cx:x, cy:y, rad: 16 + Math.random()*26, a: Math.random()*Math.PI*2, sp: (Math.random()-0.5)*0.6 } : null
      });
    }

    ball = { x: tee.x, y: tee.y, vx:0, vy:0 };
    trail = [];
    moving = false;
    aiming = true;
    aimAngle = Math.atan2(hole.y - tee.y, hole.x - tee.x);
    aimPower = MAX_POWER * 0.6;
    updateHud();
  }

  function freshState(){
    holeNum = 1;
    strokes = 0;
    holesSunk = 0;
    banked = 0;
    budget = START_BUDGET;
    sunkFlash = 0;
    shake = 0;
    dragging = false;
    buildHole();
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('golf-setup').classList.remove('hidden');
    document.getElementById('golf-play').classList.add('hidden');
    document.getElementById('golf-result').classList.add('hidden');
    document.getElementById('golf-pop').classList.add('hidden');
    hideCompanions();
  }

  function start(){
    document.getElementById('golf-setup').classList.add('hidden');
    document.getElementById('golf-result').classList.add('hidden');
    document.getElementById('golf-play').classList.remove('hidden');
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
    if(name === 'space') putt();
  }

  function putt(){
    if(!running || paused || moving || !aiming) return;
    ball.vx = Math.cos(aimAngle) * aimPower;
    ball.vy = Math.sin(aimAngle) * aimPower;
    moving = true;
    aiming = false;
    strokes++;
    budget--;
    trail = [];
    Sfx.play('shoot', 0.7);
    updateHud();
  }

  // Shared by the live sim and the aim preview.
  function accelAt(x, y){
    let ax = 0, ay = 0;
    for(const b of bodies){
      const dx = b.x - x, dy = b.y - y;
      const d2 = Math.max(140, dx*dx + dy*dy);
      const d = Math.sqrt(d2);
      const pull = (G * b.mass) / d2 * (b.kind === 'repulsor' ? -1 : 1);
      ax += (dx/d) * pull;
      ay += (dy/d) * pull;
    }
    return { ax, ay };
  }

  function previewPath(){
    let x = ball.x, y = ball.y;
    let vx = Math.cos(aimAngle)*aimPower, vy = Math.sin(aimAngle)*aimPower;
    const pts = [{x,y}];
    for(let i=0;i<90;i++){
      const a = accelAt(x, y);
      vx += a.ax * 0.05; vy += a.ay * 0.05;
      x += vx * 0.9; y += vy * 0.9;
      if(x < 0 || x > W || y < 0 || y > H) break;
      if(bodies.some(b=>Math.hypot(b.x-x, b.y-y) < b.r)) break;
      pts.push({x,y});
    }
    return pts;
  }

  function nextHole(){
    holesSunk++;
    holeNum++;
    // Beat par and you bank the shots you saved for later holes.
    const saved = Math.max(0, par - strokes);
    banked += saved;
    budget += START_BUDGET + Math.min(3, saved);
    strokes = 0;
    sunkFlash = 0.6;
    earnTokens('golf_hole', 1);
    updateStat('golf', [{stat:'bestHoles', type:'max', value:holesSunk}]);
    Sfx.play('win');
    pop(saved > 0 ? 'SUNK · ' + saved + ' UNDER PAR' : 'SUNK IT');
    buildHole();
    refreshCabinets();
  }

  function resetBall(reason){
    ball.x = tee.x; ball.y = tee.y;
    ball.vx = 0; ball.vy = 0;
    moving = false;
    aiming = true;
    trail = [];
    shake = 10;
    Sfx.play('hit');
    pop(reason);
    if(budget <= 0) gameOver();
  }

  function update(dt){
    const steps = 3;                       // sub-stepping keeps orbits stable
    const h = Math.min(0.05, dt) / steps * 60;

    bodies.forEach(b=>{
      b.spin += dt * 0.4;
      if(b.orbit){
        b.orbit.a += b.orbit.sp * dt;
        b.x = b.orbit.cx + Math.cos(b.orbit.a) * b.orbit.rad;
        b.y = b.orbit.cy + Math.sin(b.orbit.a) * b.orbit.rad;
      }
    });

    if(sunkFlash > 0) sunkFlash -= dt;
    if(shake > 0) shake = Math.max(0, shake - 26*dt);

    if(aiming && !dragging){
      if(keys.has('arrowleft')) aimAngle -= 1.8*dt;
      if(keys.has('arrowright')) aimAngle += 1.8*dt;
      if(keys.has('arrowup')) aimPower = Math.min(MAX_POWER, aimPower + 5*dt);
      if(keys.has('arrowdown')) aimPower = Math.max(1.2, aimPower - 5*dt);
    }

    if(!moving) return;

    for(let s=0;s<steps;s++){
      const a = accelAt(ball.x, ball.y);
      ball.vx += a.ax * h * 0.017;
      ball.vy += a.ay * h * 0.017;
      ball.vx *= FRICTION;
      ball.vy *= FRICTION;
      ball.x += ball.vx * h * 0.9;
      ball.y += ball.vy * h * 0.9;

      // Walls bounce with a little energy loss.
      if(ball.x < BALL_R){ ball.x = BALL_R; ball.vx = Math.abs(ball.vx)*0.72; Sfx.play('click'); }
      if(ball.x > W-BALL_R){ ball.x = W-BALL_R; ball.vx = -Math.abs(ball.vx)*0.72; Sfx.play('click'); }
      if(ball.y < BALL_R){ ball.y = BALL_R; ball.vy = Math.abs(ball.vy)*0.72; Sfx.play('click'); }
      if(ball.y > H-BALL_R){ ball.y = H-BALL_R; ball.vy = -Math.abs(ball.vy)*0.72; Sfx.play('click'); }

      if(Math.hypot(ball.x-hole.x, ball.y-hole.y) < HOLE_R){
        nextHole();
        return;
      }

      for(const b of bodies){
        const d = Math.hypot(b.x-ball.x, b.y-ball.y);
        if(d < b.r + BALL_R){
          if(b.kind === 'star'){
            resetBall('BURNED UP · SHOT LOST');
            return;
          }
          // Bounce off the surface.
          const nx = (ball.x-b.x)/d, ny = (ball.y-b.y)/d;
          const dot = ball.vx*nx + ball.vy*ny;
          ball.vx = (ball.vx - 2*dot*nx) * 0.68;
          ball.vy = (ball.vy - 2*dot*ny) * 0.68;
          ball.x = b.x + nx*(b.r + BALL_R + 0.5);
          ball.y = b.y + ny*(b.r + BALL_R + 0.5);
          Sfx.play('thud', 1.4);
        }
      }
    }

    trail.push({x:ball.x, y:ball.y});
    if(trail.length > 220) trail.shift();

    if(Math.hypot(ball.vx, ball.vy) < 0.18){
      moving = false;
      aiming = true;
      if(budget <= 0) gameOver();
    }
  }

  function gameOver(){
    running = false;
    updateStat('golf', [{stat:'bestHoles', type:'max', value:holesSunk}]);
    zipReactToScore('golf', 'bestHoles', holesSunk);
    Sfx.play('lose');
    document.getElementById('golf-result-text').textContent = holesSunk > 0 ? 'CARD SIGNED' : 'OUT OF SHOTS';
    document.getElementById('golf-result-sub').textContent =
      'You sank ' + holesSunk + ' hole' + (holesSunk===1?'':'s') + ' and banked ' + banked + ' spare shot' + (banked===1?'':'s') + ' along the way.';
    document.getElementById('golf-play').classList.add('hidden');
    document.getElementById('golf-result').classList.remove('hidden');
    refreshCabinets();
  }

  function render(){
    ctx.save();
    applyShake(ctx, shake);

    const bg = ctx.createRadialGradient(W*0.5, H*0.5, 40, W*0.5, H*0.5, W*0.7);
    bg.addColorStop(0, '#0b1026');
    bg.addColorStop(1, '#04050c');
    ctx.fillStyle = bg;
    ctx.fillRect(-30,-30,W+60,H+60);

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for(let i=0;i<70;i++){
      ctx.globalAlpha = 0.15 + ((i%6)/14);
      ctx.fillRect((i*113)%W, (i*197)%H, 1.5, 1.5);
    }
    ctx.restore();

    // hole / wormhole
    ctx.save();
    ctx.translate(hole.x, hole.y);
    ctx.rotate(performance.now()/900);
    for(let i=0;i<3;i++){
      ctx.beginPath();
      ctx.strokeStyle = `rgba(45,226,197,${0.7 - i*0.2})`;
      ctx.lineWidth = 2.5 - i*0.6;
      ctx.shadowColor = '#2de2c5';
      ctx.shadowBlur = 18;
      ctx.arc(0, 0, HOLE_R - i*4, i*0.7, i*0.7 + Math.PI*1.5);
      ctx.stroke();
    }
    ctx.restore();

    // bodies
    bodies.forEach(b=>{
      ctx.save();
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 26;
      const g = ctx.createRadialGradient(b.x - b.r*0.3, b.y - b.r*0.3, b.r*0.15, b.x, b.y, b.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, b.color);
      g.addColorStop(1, Mini3D.shade(b.color, 0.35));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fill();

      ctx.shadowBlur = 0;
      if(b.kind === 'repulsor'){
        ctx.strokeStyle = 'rgba(201,166,255,0.7)';
        ctx.setLineDash([5,5]);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 9 + Math.sin(b.spin*2)*3, 0, Math.PI*2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if(b.kind === 'star'){
        ctx.strokeStyle = 'rgba(255,200,87,0.8)';
        ctx.lineWidth = 1.6;
        for(let i=0;i<8;i++){
          const a = b.spin + (i/8)*Math.PI*2;
          ctx.beginPath();
          ctx.moveTo(b.x + Math.cos(a)*(b.r+3), b.y + Math.sin(a)*(b.r+3));
          ctx.lineTo(b.x + Math.cos(a)*(b.r+11), b.y + Math.sin(a)*(b.r+11));
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    // trail
    if(trail.length > 1){
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,61,138,0.5)';
      ctx.shadowColor = '#ff3d8a';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for(let i=1;i<trail.length;i++) ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
      ctx.restore();
    }

    // aim preview
    if(aiming){
      const pts = previewPath();
      ctx.save();
      ctx.setLineDash([4,6]);
      ctx.strokeStyle = 'rgba(232,236,241,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);

      // power arrow
      const len = 20 + (aimPower/MAX_POWER)*46;
      ctx.strokeStyle = '#ffc857';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffc857';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x + Math.cos(aimAngle)*len, ball.y + Math.sin(aimAngle)*len);
      ctx.stroke();
      ctx.restore();
    }

    // tee marker
    ctx.save();
    ctx.strokeStyle = 'rgba(120,150,200,0.4)';
    ctx.setLineDash([3,4]);
    ctx.beginPath();
    ctx.arc(tee.x, tee.y, 11, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();

    // ball
    ctx.save();
    ctx.shadowColor = '#ff3d8a';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    if(sunkFlash > 0){
      ctx.save();
      ctx.globalAlpha = sunkFlash * 0.5;
      ctx.fillStyle = '#2de2c5';
      ctx.fillRect(0,0,W,H);
      ctx.restore();
    }
    ctx.restore();

    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.55)';
    ctx.fillText(aiming ? 'DRAG FROM THE BALL, OR ←/→ AIM · ↑/↓ POWER · SPACE PUTT' : 'IN FLIGHT…', 14, H-14);
    ctx.fillText('BANKED ' + banked, W-92, H-14);
    ctx.restore();
  }

  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height)
    };
  }

  canvas.addEventListener('pointerdown', e=>{
    if(!running || paused || !aiming) return;
    e.preventDefault();
    const p = canvasPos(e);
    if(Math.hypot(p.x-ball.x, p.y-ball.y) > 60) return;
    dragging = true;
    dragPos = p;
  });
  canvas.addEventListener('pointermove', e=>{
    if(!dragging) return;
    const p = canvasPos(e);
    dragPos = p;
    const dx = p.x - ball.x, dy = p.y - ball.y;
    const d = Math.hypot(dx, dy);
    if(d > 4){
      // Drag away from the hole you want to hit — slingshot style.
      aimAngle = Math.atan2(-dy, -dx);
      aimPower = Math.min(MAX_POWER, (d/90) * MAX_POWER);
    }
  });
  ['pointerup','pointercancel','pointerleave'].forEach(evt=>{
    canvas.addEventListener(evt, ()=>{
      if(!dragging) return;
      dragging = false;
      putt();
    });
  });

  function loop(){
    if(!running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime)/1000);
    lastTime = now;
    if(!paused) update(dt);
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
