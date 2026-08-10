/* =========================================================
   GAME 7: NEON BREAKER
   ========================================================= */
const BreakerGame = (function(){
  const canvas = document.getElementById('breaker-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const PADDLE_W = 90, PADDLE_H = 12, PADDLE_Y = H - 30;
  const PADDLE_SPEED = 6.5;
  const BALL_RADIUS = 7;
  const BASE_BALL_SPEED = 5;
  const ROWS = 5, COLS = 9;
  const BRICK_MARGIN = 18, BRICK_GAP = 5, BRICK_TOP = 50, BRICK_H = 18;
  const BRICK_W = (W - BRICK_MARGIN*2 - BRICK_GAP*(COLS-1)) / COLS;
  const MAX_LIVES = 3;
  const ROW_COLORS = ['#ff5b3d','#ffc857','#2de2c5','#6aadee','#c9a6ff'];

  let rafId = null;
  let running = false;
  let paused = false;
  let paddleX, ball, bricks, lives, score, level, ballOnPaddle;

  function buildBricks(){
    const arr = [];
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        arr.push({
          x: BRICK_MARGIN + c*(BRICK_W+BRICK_GAP),
          y: BRICK_TOP + r*(BRICK_H+BRICK_GAP),
          w: BRICK_W, h: BRICK_H,
          color: ROW_COLORS[r % ROW_COLORS.length],
          alive: true
        });
      }
    }
    return arr;
  }

  function resetBall(){
    ballOnPaddle = true;
    ball = { x: paddleX + PADDLE_W/2, y: PADDLE_Y - BALL_RADIUS - 1, vx: 0, vy: 0 };
  }

  function updateHud(){
    document.getElementById('breaker-score').textContent = score;
    document.getElementById('breaker-lives-hud').textContent = '❤️'.repeat(Math.max(lives,0));
  }

  function freshState(){
    paddleX = W/2 - PADDLE_W/2;
    bricks = buildBricks();
    lives = MAX_LIVES;
    score = 0;
    level = 1;
    resetBall();
    updateHud();
  }

  function launchBall(){
    if(!ballOnPaddle) return;
    ballOnPaddle = false;
    const speed = BASE_BALL_SPEED + (level-1)*0.4;
    const angle = -Math.PI/2 + (Math.random()*0.6 - 0.3); // mostly straight up, slight random
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
  }

  function onKeyPress(name){
    if(name === 'space') launchBall();
  }

  function paddleInput(){
    let dx = 0;
    if(keys.has('a') || keys.has('arrowleft')) dx -= PADDLE_SPEED;
    if(keys.has('d') || keys.has('arrowright')) dx += PADDLE_SPEED;
    return dx;
  }

  function gameOver(){
    running = false;
    updateStat('breaker', [{stat:'highScore', type:'max', value:score}]);
    zipReactToScore('breaker', 'highScore', score);
    if(score > 0) earnTokens('breaker_brick', score);
    document.getElementById('breaker-result-text').textContent = 'BOARD OVER';
    document.getElementById('breaker-result-sub').textContent = `You broke ${score} brick${score===1?'':'s'} across ${level} board${level===1?'':'s'}.`;
    document.getElementById('breaker-play').classList.add('hidden');
    document.getElementById('breaker-result').classList.remove('hidden');
  }

  function update(){
    paddleX = clamp(paddleX + paddleInput(), 0, W - PADDLE_W);

    if(ballOnPaddle){
      ball.x = paddleX + PADDLE_W/2;
      ball.y = PADDLE_Y - BALL_RADIUS - 1;
      return;
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    if(ball.x - BALL_RADIUS < 0){ ball.x = BALL_RADIUS; ball.vx *= -1; }
    if(ball.x + BALL_RADIUS > W){ ball.x = W - BALL_RADIUS; ball.vx *= -1; }
    if(ball.y - BALL_RADIUS < 0){ ball.y = BALL_RADIUS; ball.vy *= -1; }

    // paddle collision
    if(ball.vy > 0 && ball.y + BALL_RADIUS >= PADDLE_Y && ball.y + BALL_RADIUS <= PADDLE_Y + PADDLE_H + 8 &&
       ball.x >= paddleX - BALL_RADIUS && ball.x <= paddleX + PADDLE_W + BALL_RADIUS){
      const hitPos = clamp((ball.x - (paddleX + PADDLE_W/2)) / (PADDLE_W/2), -1, 1);
      const speed = Math.hypot(ball.vx, ball.vy);
      const angle = -Math.PI/2 + hitPos * (Math.PI/3);
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
      ball.y = PADDLE_Y - BALL_RADIUS - 1;
    }

    // brick collisions (one per frame is plenty at this ball speed)
    for(const b of bricks){
      if(!b.alive) continue;
      if(ball.x + BALL_RADIUS > b.x && ball.x - BALL_RADIUS < b.x + b.w &&
         ball.y + BALL_RADIUS > b.y && ball.y - BALL_RADIUS < b.y + b.h){
        b.alive = false;
        score++;
        const overlapLeft = (ball.x + BALL_RADIUS) - b.x;
        const overlapRight = (b.x + b.w) - (ball.x - BALL_RADIUS);
        const overlapTop = (ball.y + BALL_RADIUS) - b.y;
        const overlapBottom = (b.y + b.h) - (ball.y - BALL_RADIUS);
        const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
        if(minOverlap === overlapTop || minOverlap === overlapBottom) ball.vy *= -1;
        else ball.vx *= -1;
        updateHud();
        break;
      }
    }

    if(ball.y - BALL_RADIUS > H){
      lives--;
      updateHud();
      if(lives <= 0){ gameOver(); return; }
      resetBall();
    }

    if(bricks.every(b => !b.alive)){
      level++;
      bricks = buildBricks();
      resetBall();
    }
  }

  function render(){
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0,0,W,H);

    bricks.forEach(b=>{
      if(!b.alive) return;
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 6;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.shadowBlur = 0;
    });

    ctx.fillStyle = '#2de2c5';
    ctx.shadowColor = '#2de2c5';
    ctx.shadowBlur = 8;
    ctx.fillRect(paddleX, PADDLE_Y, PADDLE_W, PADDLE_H);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if(ballOnPaddle){
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PRESS SPACE TO LAUNCH', W/2, H - 60);
      ctx.textAlign = 'left';
    }
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('breaker-setup').classList.add('hidden');
    document.getElementById('breaker-result').classList.add('hidden');
    document.getElementById('breaker-play').classList.remove('hidden');
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
    document.getElementById('breaker-setup').classList.remove('hidden');
    document.getElementById('breaker-play').classList.add('hidden');
    document.getElementById('breaker-result').classList.add('hidden');
  }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
