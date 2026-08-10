/* =========================================================
   GAME 1: STREET SOCCER
   ========================================================= */
const SoccerGame = (function(){
  const canvas = document.getElementById('soccer-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const GROUND_Y = 350;
  const GRAVITY = 0.6;
  const JUMP_VY = -11;
  const MOVE_SPEED = 4;
  const PW = 32, PH = 54;
  const BALL_R = 9;
  const KICK_RANGE = 46;
  const KICK_POWER = 9;
  const BALL_GRAVITY = 0.4;
  const GOAL_TOP = 250, GOAL_BOTTOM = 350;
  const GOAL_LINE_L = 14, GOAL_LINE_R = 786;
  const WIN_SCORE = 5;

  let mode = 'single';
  let difficulty = 'medium';
  let rafId = null;
  let running = false;
  let paused = false;
  let p1, p2, ball, scoreP1, scoreP2, matchGoalsP1, matchSavesP1, goalFlashTimer, goalFlashText;

  function setMode(m){
    mode = m;
    document.getElementById('soccer-mode-single').classList.toggle('selected', m==='single');
    document.getElementById('soccer-mode-multi').classList.toggle('selected', m==='multi');
    document.getElementById('soccer-diff-section').classList.toggle('hidden', m!=='single');
    document.getElementById('soccer-p2-label').textContent = m==='single' ? 'BOT' : 'PLAYER 2';
  }
  function setDifficulty(d){
    difficulty = d;
    ['easy','medium','hard'].forEach(k=>{
      document.getElementById('soccer-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  function freshState(){
    p1 = {x:200, y:GROUND_Y-PH, vx:0, vy:0, onGround:true, facing:1};
    p2 = {x:560, y:GROUND_Y-PH, vx:0, vy:0, onGround:true, facing:-1};
    ball = {x:400, y:GROUND_Y-BALL_R, vx:0, vy:0, spin:0};
    scoreP1 = 0; scoreP2 = 0;
    matchGoalsP1 = 0; matchSavesP1 = 0;
    goalFlashTimer = 0; goalFlashText = '';
    updateHud();
  }

  function updateHud(){
    document.getElementById('soccer-score').textContent = scoreP1 + ' : ' + scoreP2;
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('soccer-setup').classList.remove('hidden');
    document.getElementById('soccer-play').classList.add('hidden');
    document.getElementById('soccer-result').classList.add('hidden');
    setMode(mode);
    setDifficulty(difficulty);
  }

  function start(){
    document.getElementById('soccer-setup').classList.add('hidden');
    document.getElementById('soccer-result').classList.add('hidden');
    document.getElementById('soccer-play').classList.remove('hidden');
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
    if(name === 'w' && p1.onGround){ p1.vy = JUMP_VY; p1.onGround = false; }
    if(name === 's') tryKick(true);
    if(mode === 'multi'){
      if(name === 'arrowup' && p2.onGround){ p2.vy = JUMP_VY; p2.onGround = false; }
      if(name === 'arrowdown') tryKick(false);
    }
  }

  function tryKick(isP1, botSkill){
    const player = isP1 ? p1 : p2;
    const cx = player.x + PW/2, cy = player.y + PH/2;
    const dist = Math.hypot(ball.x - cx, ball.y - cy);
    if(dist <= KICK_RANGE){
      const dir = isP1 ? 1 : -1;
      if(isP1){
        const nearOwnGoal = ball.x < 150;
        const movingTowardOwnGoal = ball.vx < 0;
        if(nearOwnGoal && movingTowardOwnGoal) matchSavesP1++;
        ball.vx = dir * KICK_POWER + (Math.random()*2 - 1);
        ball.vy = -4 - Math.random()*2;
      } else {
        // Bot shot selection: if the human is standing between the bot and
        // its own goal (in the shot's path), lob it over them instead of
        // driving straight into a block. Higher skill sharpens both reads.
        const opponentInPath = p1.x < player.x && (player.x - p1.x) < 140;
        const skill = botSkill == null ? 0.5 : botSkill;
        if(opponentInPath){
          ball.vx = dir * (KICK_POWER * (0.85 + skill*0.25)) + (Math.random()*1.4 - 0.7);
          ball.vy = -6.5 - skill*2.5 - Math.random()*1.5; // higher arc to clear the blocker
        } else {
          ball.vx = dir * (KICK_POWER * (1 + skill*0.15)) + (Math.random()*1.2 - 0.6);
          ball.vy = -3 - skill*1.5 - Math.random(); // low, fast, harder to react to
        }
      }
      return true;
    }
    return false;
  }

  function applyPlayerPhysics(player, vx){
    player.vx = vx;
    if(vx > 0) player.facing = 1;
    else if(vx < 0) player.facing = -1;
    player.x = clamp(player.x + vx, 16, W-16-PW);
    player.vy += GRAVITY;
    player.y += player.vy;
    if(player.y + PH >= GROUND_Y){
      player.y = GROUND_Y - PH;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
  }

  function p1Input(){
    if(keys.has('a')) return -MOVE_SPEED;
    if(keys.has('d')) return MOVE_SPEED;
    return 0;
  }
  function p2Input(){
    if(keys.has('arrowleft')) return -MOVE_SPEED;
    if(keys.has('arrowright')) return MOVE_SPEED;
    return 0;
  }

  function botUpdate(){
    let speed, jumpChance, kickChance, reactionSkill;
    if(difficulty === 'easy'){ speed = 1.4; jumpChance = 0.006; kickChance = 0.2; reactionSkill = 0.3; }
    else if(difficulty === 'medium'){ speed = 2.2; jumpChance = 0.012; kickChance = 0.32; reactionSkill = 0.6; }
    else { speed = 3.1; jumpChance = 0.025; kickChance = 0.48; reactionSkill = 0.9; }

    // Predict where the ball is actually heading instead of just chasing its
    // current position — look a few frames ahead using its own velocity.
    const lookahead = 14;
    const predictedBallX = ball.x + ball.vx * lookahead;
    const ballHeadingToOwnGoal = ball.vx > 0.5; // moving right, toward P2's goal at x=786

    const homeX = 580;
    let targetX;
    if(ballHeadingToOwnGoal && ball.x > 340){
      // Defending / goalkeeping: track the predicted arrival point along the
      // goal line rather than the ball's current spot, so it's already
      // moving into position before the shot arrives.
      targetX = clamp(predictedBallX, 500, 760) - PW/2;
    } else if(ball.x < 380){
      targetX = homeX - PW/2; // ball's far away — hold defensive shape
    } else {
      targetX = predictedBallX - PW/2; // closing in — go to where it will be
    }

    if(p2.x + PW/2 < targetX - 6) p2.vx = speed;
    else if(p2.x + PW/2 > targetX + 6) p2.vx = -speed;
    else p2.vx = 0;

    // Jump to meet aerial balls, weighted by difficulty (keeper positioning).
    const distX = Math.abs((p2.x+PW/2) - ball.x);
    const jumpWindow = ballHeadingToOwnGoal ? 80 : 60;
    if(p2.onGround && ball.y < p2.y && distX < jumpWindow && Math.random() < jumpChance * (1 + reactionSkill)){
      p2.vy = JUMP_VY; p2.onGround = false;
    }

    const distToBall = Math.hypot((p2.x+PW/2)-ball.x, (p2.y+PH/2)-ball.y);
    if(distToBall <= KICK_RANGE && Math.random() < kickChance) tryKick(false, reactionSkill);
  }

  function resetPositions(){
    ball.x = 400; ball.y = GROUND_Y - BALL_R; ball.vx = 0; ball.vy = 0; ball.spin = 0;
    p1.x = 200; p1.y = GROUND_Y - PH; p1.vy = 0; p1.facing = 1;
    p2.x = 560; p2.y = GROUND_Y - PH; p2.vy = 0; p2.facing = -1;
  }

  function checkWin(){
    if(scoreP1 >= WIN_SCORE) endMatch(true);
    else if(scoreP2 >= WIN_SCORE) endMatch(false);
  }

  function endMatch(p1Won){
    running = false;
    updateStat('soccer', [
      {stat:'goals', type:'increment', value:matchGoalsP1},
      {stat:'saves', type:'increment', value:matchSavesP1},
      {stat:'wins', type:'increment_if', value:1, cond:p1Won}
    ]);
    showZipCompanion(p1Won ? 'win' : 'loss');
    earnTokens(p1Won ? 'soccer_win' : 'soccer_loss', 1);
    if(matchGoalsP1 > 0) earnTokens('soccer_goal', matchGoalsP1);
    if(matchSavesP1 > 0) earnTokens('soccer_save', matchSavesP1);
    const oppName = mode==='single' ? 'the bot' : 'Player 2';
    document.getElementById('soccer-result-text').textContent = p1Won ? 'YOU WIN!' : (mode==='single' ? 'BOT WINS' : 'PLAYER 2 WINS');
    document.getElementById('soccer-result-sub').textContent = `Final score ${scoreP1} : ${scoreP2} vs ${oppName}.`;
    document.getElementById('soccer-play').classList.add('hidden');
    document.getElementById('soccer-result').classList.remove('hidden');
  }

  function update(){
    applyPlayerPhysics(p1, p1Input());
    if(mode === 'multi'){
      applyPlayerPhysics(p2, p2Input());
    } else {
      botUpdate();
      applyPlayerPhysics(p2, p2.vx);
    }

    ball.vy += BALL_GRAVITY;
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= 0.992;
    ball.spin += ball.vx * 0.05;

    if(ball.y + BALL_R >= GROUND_Y){
      ball.y = GROUND_Y - BALL_R;
      ball.vy = -ball.vy * 0.42;
      if(Math.abs(ball.vy) < 0.8) ball.vy = 0;
    }
    if(ball.y - BALL_R <= 0){
      ball.y = BALL_R;
      ball.vy = -ball.vy * 0.5;
    }

    const inGoalY = ball.y > GOAL_TOP && ball.y < GOAL_BOTTOM;
    if(ball.x - BALL_R <= GOAL_LINE_L && inGoalY){
      scoreP2++;
      resetPositions();
      updateHud();
      checkWin();
      return;
    }
    if(ball.x + BALL_R >= GOAL_LINE_R && inGoalY){
      scoreP1++; matchGoalsP1++;
      resetPositions();
      updateHud();
      checkWin();
      return;
    }
    if(ball.x - BALL_R <= 0 && !inGoalY){ ball.x = BALL_R; ball.vx = -ball.vx*0.6; }
    if(ball.x + BALL_R >= W && !inGoalY){ ball.x = W-BALL_R; ball.vx = -ball.vx*0.6; }
  }

  function drawField(){
    ctx.fillStyle = '#0e3a24';
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10,10,W-20,H-20);
    ctx.beginPath();
    ctx.moveTo(W/2,10); ctx.lineTo(W/2,H-10); ctx.stroke();
    ctx.beginPath();
    ctx.arc(W/2,H/2,45,0,Math.PI*2); ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, GOAL_TOP, 16, GOAL_BOTTOM-GOAL_TOP);
    ctx.fillRect(W-16, GOAL_TOP, 16, GOAL_BOTTOM-GOAL_TOP);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeRect(0, GOAL_TOP, 16, GOAL_BOTTOM-GOAL_TOP);
    ctx.strokeRect(W-16, GOAL_TOP, 16, GOAL_BOTTOM-GOAL_TOP);

    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.moveTo(0,GROUND_Y); ctx.lineTo(W,GROUND_Y); ctx.stroke();
  }

  function drawPlayer(p, isP1, color, label){
    const img = SPRITES[isP1 ? 'redPlayer' : 'bluePlayer'];
    const nativeW = isP1 ? 3 : 4; // red sprite is 3px wide, blue is 4px wide
    const footX = p.x + PW/2, footY = p.y + PH;
    const drawn = drawFacingSprite(ctx, img, footX, footY, p.facing, nativeW/2, 7, nativeW, 7, 6.5);
    if(!drawn){
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(p.x, p.y, PW, PH, 6) : ctx.rect(p.x,p.y,PW,PH);
      ctx.fill();
      ctx.fillStyle = '#04060a';
      ctx.beginPath();
      ctx.arc(p.x+PW/2, p.y+12, 9, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, p.x+PW/2, p.y-6);
  }

  function render(){
    drawField();
    drawPlayer(p1, true, '#2de2c5', 'P1');
    drawPlayer(p2, false, '#ff3d8a', mode==='single' ? 'BOT' : 'P2');
    const ballDrawn = drawRotatedSprite(ctx, SPRITES.soccerBall, ball.x, ball.y, ball.spin, 4.5, 4, 9, 8, 2.2, 0, false);
    if(!ballDrawn){
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.stroke();
    }
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  setMode('single');
  setDifficulty('medium');

  return {setMode, setDifficulty, start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
