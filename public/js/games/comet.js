/* =========================================================
   GAME 9: COMET DODGE
   ========================================================= */
const CometGame = (function(){
  const canvas = document.getElementById('comet-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const SHIP_W = 34, SHIP_H = 22;
  const SHIP_Y = H - 44;
  const SHIP_SPEED = 6.5;
  const BASE_FALL_SPEED = 2.6;
  const BASE_SPAWN_FRAMES = 55;
  const MIN_SPAWN_FRAMES = 16;

  let rafId = null;
  let running = false;
  let paused = false;

  let shipX, comets, frameCount, spawnTimer, score, dodged, speedTier, stars;

  function buildStars(){
    const arr = [];
    for(let i=0;i<70;i++){
      arr.push({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*1.6 + 0.4, tw: Math.random()*Math.PI*2 });
    }
    return arr;
  }

  function currentFallSpeed(){
    return BASE_FALL_SPEED + speedTier * 0.55;
  }
  function currentSpawnFrames(){
    return Math.max(MIN_SPAWN_FRAMES, BASE_SPAWN_FRAMES - speedTier * 4);
  }

  function spawnComet(){
    const r = 10 + Math.random()*14;
    comets.push({
      x: r + Math.random() * (W - r*2),
      y: -r,
      r,
      vy: currentFallSpeed() * (0.85 + Math.random()*0.3),
      drift: (Math.random()-0.5) * 1.4
    });
  }

  function freshState(){
    shipX = W/2;
    comets = [];
    frameCount = 0;
    spawnTimer = 40;
    score = 0;
    dodged = 0;
    speedTier = 0;
    stars = buildStars();
    updateHud();
  }

  function updateHud(){
    document.getElementById('comet-score').textContent = score;
    document.getElementById('comet-speed-hud').textContent = 'SPEED ' + (speedTier + 1);
  }

  function shipInput(){
    let dx = 0;
    if(keys.has('a') || keys.has('arrowleft')) dx -= SHIP_SPEED;
    if(keys.has('d') || keys.has('arrowright')) dx += SHIP_SPEED;
    return dx;
  }

  function onKeyPress(name){ /* handled via continuous key checks in update() */ }

  function circleRectHit(cx, cy, cr, rx, ry, rw, rh){
    const closestX = clamp(cx, rx, rx + rw);
    const closestY = clamp(cy, ry, ry + rh);
    return Math.hypot(cx - closestX, cy - closestY) < cr;
  }

  function gameOver(){
    running = false;
    updateStat('comet', [{stat:'highScore', type:'max', value:score}]);
    zipReactToScore('comet', 'highScore', score);
    if(dodged > 0) earnTokens('comet_dodged', dodged);
    document.getElementById('comet-result-text').textContent = 'SHIP DESTROYED';
    document.getElementById('comet-result-sub').textContent =
      `You scored ${score} and dodged ${dodged} comet${dodged===1?'':'s'}.`;
    document.getElementById('comet-play').classList.add('hidden');
    document.getElementById('comet-result').classList.remove('hidden');
  }

  function update(){
    frameCount++;
    if(frameCount % 6 === 0) { score++; updateHud(); }
    if(frameCount % 600 === 0) speedTier = Math.min(speedTier + 1, 12); // ramps up every ~10s

    shipX = clamp(shipX + shipInput(), SHIP_W/2, W - SHIP_W/2);

    spawnTimer--;
    if(spawnTimer <= 0){
      spawnComet();
      spawnTimer = currentSpawnFrames();
    }

    const shipRect = { x: shipX - SHIP_W/2, y: SHIP_Y, w: SHIP_W, h: SHIP_H };

    for(let i=comets.length-1; i>=0; i--){
      const c = comets[i];
      c.y += c.vy;
      c.x += c.drift;
      if(c.x < c.r || c.x > W - c.r) c.drift *= -1;

      if(circleRectHit(c.x, c.y, c.r, shipRect.x, shipRect.y, shipRect.w, shipRect.h)){
        comets.splice(i,1);
        gameOver();
        return;
      }

      if(c.y - c.r > H){
        comets.splice(i,1);
        dodged++;
      }
    }
  }

  function render(){
    ctx.fillStyle = '#060810';
    ctx.fillRect(0,0,W,H);

    ctx.fillStyle = '#ffffff';
    stars.forEach(s=>{
      const a = 0.35 + 0.35 * Math.sin(frameCount*0.03 + s.tw);
      ctx.globalAlpha = Math.max(0, a);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    comets.forEach(c=>{
      ctx.beginPath();
      const grad = ctx.createRadialGradient(c.x, c.y - c.r*2, 1, c.x, c.y, c.r*1.4);
      grad.addColorStop(0, 'rgba(255,150,80,0.0)');
      grad.addColorStop(1, 'rgba(255,120,60,0.35)');
      ctx.fillStyle = grad;
      ctx.fillRect(c.x - c.r*1.4, c.y - c.r*5, c.r*2.8, c.r*6);

      ctx.fillStyle = '#ff8a3c';
      ctx.shadowColor = '#ff8a3c';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(c.x - c.r*0.3, c.y - c.r*0.3, c.r*0.4, 0, Math.PI*2);
      ctx.fill();
    });

    // ship
    ctx.fillStyle = '#2de2c5';
    ctx.shadowColor = '#2de2c5';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(shipX, SHIP_Y);
    ctx.lineTo(shipX - SHIP_W/2, SHIP_Y + SHIP_H);
    ctx.lineTo(shipX + SHIP_W/2, SHIP_Y + SHIP_H);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0d0a14';
    ctx.beginPath();
    ctx.arc(shipX, SHIP_Y + SHIP_H*0.7, 4, 0, Math.PI*2);
    ctx.fill();
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('comet-setup').classList.add('hidden');
    document.getElementById('comet-result').classList.add('hidden');
    document.getElementById('comet-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    loop();
  }

  function stop(){
    running = false;
    paused = false;
    if(rafId) cancelAnimationFrame(rafId);
  }

  function pause(){
    if(running) paused = true;
  }
  function resume(){
    paused = false;
  }
  function isPaused(){
    return paused;
  }
  function isRunning(){
    return running;
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('comet-setup').classList.remove('hidden');
    document.getElementById('comet-play').classList.add('hidden');
    document.getElementById('comet-result').classList.add('hidden');
  }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
