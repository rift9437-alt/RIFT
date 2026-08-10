/* =========================================================
   GAME: BASKETBALL HOOPS
   =========================================================
   Ninety seconds, one hoop that keeps moving, and a power meter. Sink
   consecutive shots to build a multiplier; miss and it resets. */
const HoopsGame = (function(){
  const canvas = document.getElementById('hoops-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const GRAVITY = 0.42;
  const FLOOR_Y = H - 40;
  const ROUND_SECONDS = 90;

  let rafId=null, running=false, paused=false;
  let ball, hoop, aiming, angle, power, powerDir, score, combo, bestCombo;
  let shots, made, timeLeft, particles, frame, message, messageTimer, netWave;

  function freshState(){
    resetBall();
    hoop = { x: W - 150, y: 170, w: 74, vx: 0, vy: 0, moving: false };
    angle = -0.88; // starts inside the arc that actually reaches the rim
    power = 0.5;
    powerDir = 1;
    aiming = true;
    score = 0; combo = 0; bestCombo = 0;
    shots = 0; made = 0;
    timeLeft = ROUND_SECONDS;
    particles = [];
    frame = 0;
    netWave = 0;
    message = ''; messageTimer = 0;
    updateHud();
  }

  function resetBall(){
    ball = { x: 90, y: FLOOR_Y - 16, vx: 0, vy: 0, live: false, spin: 0, scored: false };
  }

  function updateHud(){
    document.getElementById('hoops-score').textContent = score;
    document.getElementById('hoops-combo').textContent = '×' + (1 + combo);
    document.getElementById('hoops-time').textContent = Math.max(0, Math.ceil(timeLeft)) + 's';
    const acc = shots ? Math.round(made / shots * 100) : 0;
    document.getElementById('hoops-acc').textContent = acc + '%';
  }

  function say(t){ message = t; messageTimer = 90; }

  function shoot(){
    if(!aiming || ball.live) return;
    ball.vx = Math.cos(angle) * (9 + power * 12);
    ball.vy = Math.sin(angle) * (9 + power * 12);
    ball.live = true;
    ball.scored = false;
    aiming = false;
    shots++;
    Sfx.play('whoosh');
    updateHud();
  }

  function onKeyPress(name){
    if(name === 'space') shoot();
  }

  function update(){
    frame++;
    timeLeft -= 1/60;
    if(messageTimer > 0) messageTimer--;
    if(netWave > 0) netWave -= 0.05;
    if(timeLeft <= 0){ gameOver(); return; }

    // The hoop drifts once you're good enough to deserve it.
    hoop.moving = made >= 3;
    if(hoop.moving){
      hoop.y += Math.sin(frame * 0.018) * 1.1;
      hoop.x = W - 150 + Math.sin(frame * 0.009) * 60;
    }

    if(aiming){
      if(keys.has('w') || keys.has('arrowup')) angle -= 0.022;
      if(keys.has('s') || keys.has('arrowdown')) angle += 0.022;
      angle = clamp(angle, -1.35, -0.1);
      // Power oscillates so the shot is a timing decision, not a slider.
      power += powerDir * 0.014;
      if(power > 1){ power = 1; powerDir = -1; }
      if(power < 0.12){ power = 0.12; powerDir = 1; }
    }

    if(ball.live){
      ball.vy += GRAVITY;
      ball.x += ball.vx;
      ball.y += ball.vy;
      ball.spin += ball.vx * 0.04;

      // rim/backboard
      const rimL = hoop.x, rimR = hoop.x + hoop.w;
      if(!ball.scored && ball.vy > 0 &&
         ball.y > hoop.y - 6 && ball.y < hoop.y + 14 &&
         ball.x > rimL && ball.x < rimR){
        ball.scored = true;
        made++;
        combo++;
        bestCombo = Math.max(bestCombo, combo);
        const points = 2 + combo;
        score += points;
        netWave = 1;
        for(let i=0;i<16;i++)
          particles.push({ x: ball.x, y: hoop.y+10, vx:(Math.random()-0.5)*5, vy:Math.random()*3, life:1, color:'#ffc857' });
        say(combo >= 3 ? `ON FIRE ×${combo} · +${points}` : `+${points}`);
        Sfx.play(combo >= 3 ? 'perfect' : 'coin');
        if(typeof scorePop === 'function') scorePop('+' + points, combo >= 5 ? 'huge' : combo >= 3 ? 'big' : 'normal');
        earnTokens('hoops_basket', 1);
        updateHud();
      }

      // backboard bounce
      if(ball.x > rimR + 4 && ball.x < rimR + 16 && ball.y > hoop.y - 70 && ball.y < hoop.y){
        ball.vx = -Math.abs(ball.vx) * 0.62;
        Sfx.play('hit', 1.5);
      }

      if(ball.x < 8 || ball.x > W - 8) ball.vx *= -0.6;
      if(ball.y > FLOOR_Y - 12){
        ball.y = FLOOR_Y - 12;
        ball.vy *= -0.45;
        ball.vx *= 0.7;
        if(Math.abs(ball.vy) < 1.6){
          if(!ball.scored){
            combo = 0;
            say('MISS');
            Sfx.play('lose', 1.4);
            updateHud();
          }
          resetBall();
          aiming = true;
        }
      }
    }

    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life -= 0.03;
      if(p.life <= 0) particles.splice(i,1);
    }
    updateHud();
  }

  function gameOver(){
    running = false;
    updateStat('hoops', [{stat:'highScore', type:'max', value:score}]);
    zipReactToScore('hoops', 'highScore', score);
    Sfx.play('lose');
    const acc = shots ? Math.round(made/shots*100) : 0;
    document.getElementById('hoops-result-text').textContent = 'FULL TIME';
    document.getElementById('hoops-result-sub').textContent =
      `${score} points · ${made}/${shots} shots (${acc}%) · best streak ×${bestCombo}.`;
    document.getElementById('hoops-play').classList.add('hidden');
    document.getElementById('hoops-result').classList.remove('hidden');
  }

  function render(){
    const bg = ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0, '#241207');
    bg.addColorStop(1, '#0d0703');
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,W,H);

    // court floor
    ctx.fillStyle = '#3d2210';
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.strokeStyle = 'rgba(255,200,150,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(W, FLOOR_Y); ctx.stroke();
    ctx.beginPath(); ctx.arc(90, FLOOR_Y, 46, Math.PI, 0); ctx.stroke();

    // backboard + hoop
    ctx.fillStyle = '#e8ecf1';
    ctx.fillRect(hoop.x + hoop.w + 4, hoop.y - 66, 7, 74);
    ctx.strokeStyle = '#ff5b3d';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(hoop.x, hoop.y);
    ctx.lineTo(hoop.x + hoop.w, hoop.y);
    ctx.stroke();
    // net
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    for(let i=0;i<=6;i++){
      const t = i/6;
      const sway = Math.sin(frame*0.2 + i) * netWave * 5;
      ctx.beginPath();
      ctx.moveTo(hoop.x + t*hoop.w, hoop.y);
      ctx.lineTo(hoop.x + hoop.w*0.5 + (t-0.5)*hoop.w*0.42 + sway, hoop.y + 30 + netWave*6);
      ctx.stroke();
    }

    // aim guide
    if(aiming){
      ctx.save();
      ctx.setLineDash([5,6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let sx = ball.x, sy = ball.y, svx = Math.cos(angle)*(9+power*12), svy = Math.sin(angle)*(9+power*12);
      ctx.moveTo(sx, sy);
      for(let i=0;i<26;i++){
        svy += GRAVITY; sx += svx; sy += svy;
        if(sy > FLOOR_Y) break;
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.restore();

      // power meter
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(30, H-30, 150, 10);
      const pg = ctx.createLinearGradient(30, 0, 180, 0);
      pg.addColorStop(0, '#45ffb0'); pg.addColorStop(0.6, '#ffc857'); pg.addColorStop(1, '#ff5454');
      ctx.fillStyle = pg;
      ctx.fillRect(30, H-30, 150*power, 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(30, H-30, 150, 10);
    }

    // ball
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.spin);
    ctx.shadowColor = '#ff8a3d';
    ctx.shadowBlur = 14;
    const bg2 = ctx.createRadialGradient(-4,-4,2, 0,0,13);
    bg2.addColorStop(0, '#ffb066');
    bg2.addColorStop(1, '#c95a1c');
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(0,0,13,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#5a2a0c';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-13,0); ctx.lineTo(13,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-13); ctx.lineTo(0,13); ctx.stroke();
    ctx.restore();

    particles.forEach(p=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    });

    if(messageTimer > 0){
      ctx.save();
      ctx.font = 'bold 22px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffc857';
      ctx.shadowColor = '#ffc857';
      ctx.shadowBlur = 14;
      ctx.fillText(message, W/2, 70);
      ctx.restore();
    }

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,230,200,0.5)';
    ctx.fillText('↑/↓ AIM · SPACE SHOOT (power swings on its own)', 14, H-12);
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('hoops-setup').classList.add('hidden');
    document.getElementById('hoops-result').classList.add('hidden');
    document.getElementById('hoops-play').classList.remove('hidden');
    freshState();
    paused = false; running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('hoops-setup').classList.remove('hidden');
    document.getElementById('hoops-play').classList.add('hidden');
    document.getElementById('hoops-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
