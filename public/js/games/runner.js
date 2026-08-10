/* =========================================================
   GAME 4: HOP RUNNER
   ========================================================= */
const RunnerGame = (function(){
  const canvas = document.getElementById('runner-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const GROUND_Y = 240;
  const GRAVITY = 0.55;
  const JUMP_VY = -10;
  const PLAYER_X = 80, PLAYER_W = 28, PLAYER_H = 42;

  let rafId = null;
  let running = false;
  let paused = false;
  let player, obstacles, score, spawnTimer, frameCount;

  function freshState(){
    player = {y:GROUND_Y-PLAYER_H, vy:0, onGround:true};
    obstacles = [];
    score = 0;
    spawnTimer = 60;
    frameCount = 0;
    updateHud();
  }

  function updateHud(){
    document.getElementById('runner-score').textContent = score;
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('runner-setup').classList.remove('hidden');
    document.getElementById('runner-play').classList.add('hidden');
    document.getElementById('runner-result').classList.add('hidden');
  }

  function start(){
    document.getElementById('runner-setup').classList.add('hidden');
    document.getElementById('runner-result').classList.add('hidden');
    document.getElementById('runner-play').classList.remove('hidden');
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

  function onKeyPress(name){
    if(!running) return;
    if((name === 'space' || name === 'arrowup') && player.onGround){
      player.vy = JUMP_VY;
      player.onGround = false;
    }
  }

  function currentSpeed(){ return Math.min(4 + score*0.08, 10); }
  function currentSpawnInterval(){ return Math.max(40, 95 - score*1.1); }

  function update(){
    frameCount++;
    player.vy += GRAVITY;
    player.y += player.vy;
    if(player.y + PLAYER_H >= GROUND_Y){
      player.y = GROUND_Y - PLAYER_H;
      player.vy = 0;
      player.onGround = true;
    }

    spawnTimer--;
    if(spawnTimer <= 0){
      const h = 28 + Math.random()*24;
      obstacles.push({x:W+10, w:18, h:h, passed:false});
      spawnTimer = currentSpawnInterval();
    }

    const speed = currentSpeed();
    for(let i=obstacles.length-1; i>=0; i--){
      const o = obstacles[i];
      o.x -= speed;
      if(!o.passed && o.x + o.w < PLAYER_X){
        o.passed = true;
        score++;
        updateHud();
      }
      if(o.x < -40) obstacles.splice(i,1);
    }

    for(const o of obstacles){
      const oy = GROUND_Y - o.h;
      const overlapX = PLAYER_X < o.x + o.w && PLAYER_X + PLAYER_W > o.x;
      const overlapY = player.y < oy + o.h && player.y + PLAYER_H > oy;
      if(overlapX && overlapY){
        gameOver();
        return;
      }
    }
  }

  function gameOver(){
    running = false;
    updateStat('runner', [{stat:'highScore', type:'max', value:score}]);
    zipReactToScore('runner', 'highScore', score);
    if(score > 0) earnTokens('runner_score', score);
    document.getElementById('runner-result-text').textContent = 'RUN OVER';
    document.getElementById('runner-result-sub').textContent = 'You cleared ' + score + ' obstacle' + (score===1?'':'s') + '.';
    document.getElementById('runner-play').classList.add('hidden');
    document.getElementById('runner-result').classList.remove('hidden');
  }

  function render(){
    ctx.fillStyle = '#10131c';
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.moveTo(0,GROUND_Y); ctx.lineTo(W,GROUND_Y); ctx.stroke();

    // Draw hopper sprite, fall back to rectangle
    const hopperImg = SPRITES.hopperPlayer;
    const drawn = drawFacingSprite(ctx, hopperImg, PLAYER_X + PLAYER_W/2, player.y + PLAYER_H, 1, 1.5, 7, 3, 7, 5);
    if(!drawn){
      ctx.fillStyle = '#8b8bff';
      ctx.fillRect(PLAYER_X, player.y, PLAYER_W, PLAYER_H);
      ctx.fillStyle = '#04060a';
      ctx.beginPath();
      ctx.arc(PLAYER_X+PLAYER_W/2, player.y+8, 7, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.fillStyle = '#ff3d8a';
    obstacles.forEach(o=>{
      const oy = GROUND_Y - o.h;
      ctx.beginPath();
      ctx.moveTo(o.x, GROUND_Y);
      ctx.lineTo(o.x + o.w/2, oy);
      ctx.lineTo(o.x + o.w, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    });
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
