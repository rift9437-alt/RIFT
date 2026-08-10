/* =========================================================
   GAME: NINJA PARKOUR
   ========================================================= */
const ParkourGame = (function(){
  const canvas = document.getElementById('parkour-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const GROUND_Y = 440;

  const PLATFORMS = [
    {x:0,y:GROUND_Y,w:130,h:20},
    {x:170,y:340,w:22,h:100},
    {x:240,y:GROUND_Y,w:120,h:20},
    {x:410,y:260,w:22,h:180},
    {x:480,y:220,w:130,h:20},
    {x:660,y:340,w:22,h:100},
    {x:720,y:GROUND_Y,w:180,h:20}
  ];
  const GATES = [230, 470, 690, 860];
  const FINISH_X = 880;
  const PLAYER_W = 16, PLAYER_H = 26;

  let rafId=null, running=false, paused=false;
  let px,py,vx,vy,onGround,onWallSide,grappling,grapplePoint,timeLeft,gatesPassed,finished,mouseX,mouseY;

  function freshState(){
    px = 30; py = GROUND_Y-PLAYER_H; vx=0; vy=0;
    onGround = true; onWallSide = 0;
    grappling = false; grapplePoint = null;
    timeLeft = 60;
    gatesPassed = GATES.map(()=>false);
    finished = false;
    updateHud();
  }

  function updateHud(){
    document.getElementById('parkour-time-hud').textContent = Math.max(0,timeLeft).toFixed(1);
    document.getElementById('parkour-gates-hud').textContent = `GATES ${gatesPassed.filter(Boolean).length} / ${GATES.length}`;
  }

  function rectsOverlap(ax,ay,aw,ah,bx,by,bw,bh){
    return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
  }

  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX-rect.left)*(W/rect.width), y: (e.clientY-rect.top)*(H/rect.height) };
  }
  canvas.addEventListener('pointerdown', e=>{
    if(!running || paused) return;
    const p = canvasPos(e);
    if(Math.hypot(p.x-px, p.y-py) > 320) return;
    grappling = true;
    grapplePoint = p;
  });
  canvas.addEventListener('pointerup', ()=>{ grappling = false; });
  canvas.addEventListener('pointermove', e=>{
    const p = canvasPos(e);
    mouseX = p.x; mouseY = p.y;
  });

  function onKeyPress(name){
    if(!running || paused) return;
    if(name === 'w' || name === 'space'){
      if(onGround){ vy = -11.5; onGround = false; }
      else if(onWallSide !== 0){ vy = -10; vx = -onWallSide * 8; onWallSide = 0; }
    }
  }

  function gameOver(reason){
    running = false;
    let score = gatesPassed.filter(Boolean).length * 40 + (finished ? 150 : 0) + Math.max(0, Math.round(timeLeft*2));
    updateStat('parkour', [{stat:'bestTime', type:'max', value:score}]);
    zipReactToScore('parkour', 'bestTime', score);
    const gates = gatesPassed.filter(Boolean).length;
    if(gates > 0) earnTokens('parkour_gate', gates);
    if(finished) earnTokens('parkour_finish', 1);
    document.getElementById('parkour-result-text').textContent = finished ? 'COURSE CLEAR' : reason;
    document.getElementById('parkour-result-sub').textContent =
      `Score ${score} · ${gates}/${GATES.length} gates cleared${finished ? ' · course finished!' : ''}`;
    document.getElementById('parkour-play').classList.add('hidden');
    document.getElementById('parkour-result').classList.remove('hidden');
  }

  function update(){
    timeLeft -= 1/60;
    if(timeLeft <= 0){ gameOver('TIME UP'); return; }

    let dx = 0;
    if(keys.has('a') || keys.has('arrowleft')) dx -= 0.9;
    if(keys.has('d') || keys.has('arrowright')) dx += 0.9;
    vx += dx;
    vx *= onGround ? 0.82 : 0.94;
    vx = clamp(vx, -6, 6);

    if(grappling && grapplePoint){
      const ddx = grapplePoint.x - px, ddy = grapplePoint.y - py;
      const dist = Math.hypot(ddx,ddy) || 1;
      if(dist < 22){ grappling = false; }
      else {
        vx += (ddx/dist) * 0.85;
        vy += (ddy/dist) * 0.85;
        vx = clamp(vx, -9, 9);
        vy = clamp(vy, -9, 9);
      }
    } else {
      vy += 0.55; // gravity
      vy = Math.min(vy, 14);
    }

    // horizontal move + collide
    px += vx;
    onWallSide = 0;
    for(const p of PLATFORMS){
      if(rectsOverlap(px,py,PLAYER_W,PLAYER_H,p.x,p.y,p.w,p.h)){
        if(vx > 0){ px = p.x - PLAYER_W; onWallSide = 1; }
        else if(vx < 0){ px = p.x + p.w; onWallSide = -1; }
        vx = 0;
      }
    }

    // vertical move + collide
    py += vy;
    onGround = false;
    for(const p of PLATFORMS){
      if(rectsOverlap(px,py,PLAYER_W,PLAYER_H,p.x,p.y,p.w,p.h)){
        if(vy > 0){ py = p.y - PLAYER_H; onGround = true; }
        else if(vy < 0){ py = p.y + p.h; }
        vy = 0;
      }
    }

    if(py > H + 60){ gameOver('FELL OFF'); return; }

    GATES.forEach((gx,i) => {
      if(!gatesPassed[i] && px >= gx){
        gatesPassed[i] = true;
        timeLeft += 8;
        updateHud();
      }
    });

    if(px >= FINISH_X && onGround && !finished){
      finished = true;
      gameOver('');
      return;
    }

    updateHud();
  }

  function render(){
    ctx.fillStyle = '#080a12';
    ctx.fillRect(0,0,W,H);

    PLATFORMS.forEach(p => {
      ctx.fillStyle = '#1c2438';
      ctx.fillRect(p.x,p.y,p.w,p.h);
      ctx.strokeStyle = '#5be3ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x,p.y,p.w,p.h);
    });

    GATES.forEach((gx,i) => {
      ctx.strokeStyle = gatesPassed[i] ? 'rgba(139,255,107,0.9)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gx, 60);
      ctx.lineTo(gx, GROUND_Y);
      ctx.stroke();
    });

    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(FINISH_X-4, GROUND_Y-70, 8, 70);
    ctx.beginPath();
    ctx.moveTo(FINISH_X+4, GROUND_Y-70);
    ctx.lineTo(FINISH_X+34, GROUND_Y-60);
    ctx.lineTo(FINISH_X+4, GROUND_Y-50);
    ctx.fill();

    if(grappling && grapplePoint){
      ctx.strokeStyle = '#5be3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px+PLAYER_W/2, py+PLAYER_H/2);
      ctx.lineTo(grapplePoint.x, grapplePoint.y);
      ctx.stroke();
      ctx.fillStyle = '#5be3ff';
      ctx.beginPath();
      ctx.arc(grapplePoint.x, grapplePoint.y, 4, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.fillStyle = '#5be3ff';
    ctx.shadowColor = '#5be3ff';
    ctx.shadowBlur = 8;
    ctx.fillRect(px,py,PLAYER_W,PLAYER_H);
    ctx.shadowBlur = 0;
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('parkour-setup').classList.add('hidden');
    document.getElementById('parkour-result').classList.add('hidden');
    document.getElementById('parkour-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    loop();
  }
  function stop(){ running=false; paused=false; grappling=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false; grappling = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('parkour-setup').classList.remove('hidden');
    document.getElementById('parkour-play').classList.add('hidden');
    document.getElementById('parkour-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
