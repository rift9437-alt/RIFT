/* =========================================================
   GAME 6: ASTEROID BLASTER
   ========================================================= */
const AsteroidGame = (function(){
  const canvas = document.getElementById('asteroid-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const GUN_Y = H - 36; // y of gun strip
  const GUN_BASE_Y = H - 20;
  const GUN_MAX_ANGLE = Math.PI * 0.42; // max aim from center
  const BULLET_SPEED = 8;
  const BASE_MAX_LIVES = 3;
  const BASE_GUN_TURN_SPEED = 0.05;
  const AUTO_TURRET_X_OFFSET = 90; // sits to the side of the main turret
  const AUTO_TURRET_COOLDOWN = 55; // frames between auto-turret shots

  // Upgrade levels are read fresh from the wallet each time a run starts,
  // so buying an upgrade between runs takes effect immediately.
  let MAX_LIVES = BASE_MAX_LIVES;
  let GUN_TURN_SPEED = BASE_GUN_TURN_SPEED;
  let hasAutoTurret = false;

  function applyUpgrades(){
    const up = (wallet && wallet.asteroidUpgrades) || {};
    MAX_LIVES = BASE_MAX_LIVES + (up.extraLife || 0);
    GUN_TURN_SPEED = BASE_GUN_TURN_SPEED * (1 + 0.15 * (up.turnSpeed || 0));
    hasAutoTurret = (up.autoTurret || 0) >= 1;
  }

  let rafId = null;
  let running = false;
  let paused = false;
  let gunAngle, bullets, asteroids, lives, shotCount, spawnTimer, frameCount, particles;
  let autoTurretCooldown;

  function freshState(){
    applyUpgrades();
    gunAngle = -Math.PI/2; // pointing straight up
    bullets = [];
    asteroids = [];
    particles = [];
    lives = MAX_LIVES;
    shotCount = 0;
    spawnTimer = 80;
    frameCount = 0;
    autoTurretCooldown = AUTO_TURRET_COOLDOWN;
    updateHud();
  }

  function updateHud(){
    document.getElementById('asteroid-score').textContent = shotCount;
    const hearts = '❤️'.repeat(Math.max(0,lives)) + '🖤'.repeat(Math.max(0,MAX_LIVES-lives));
    document.getElementById('asteroid-lives-hud').textContent = hearts;
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('asteroid-setup').classList.remove('hidden');
    document.getElementById('asteroid-play').classList.add('hidden');
    document.getElementById('asteroid-result').classList.add('hidden');
    renderAsteroidUpgrades();
  }

  function start(){
    document.getElementById('asteroid-setup').classList.add('hidden');
    document.getElementById('asteroid-result').classList.add('hidden');
    document.getElementById('asteroid-play').classList.remove('hidden');
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
    if(name === 'space') shoot();
  }

  function shoot(){
    bullets.push({
      x: W/2,
      y: GUN_Y,
      vx: Math.cos(gunAngle) * BULLET_SPEED,
      vy: Math.sin(gunAngle) * BULLET_SPEED,
      life: 120
    });
  }

  function autoTurretFire(){
    if(!asteroids.length) return;
    const tx = W/2 + AUTO_TURRET_X_OFFSET, ty = GUN_Y;
    // Aim at whichever asteroid is closest to the turret.
    let nearest = asteroids[0], bestDist = Infinity;
    asteroids.forEach(a=>{
      const d = Math.hypot(a.x-tx, a.y-ty);
      if(d < bestDist){ bestDist = d; nearest = a; }
    });
    const ang = Math.atan2(nearest.y-ty, nearest.x-tx);
    bullets.push({
      x: tx, y: ty,
      vx: Math.cos(ang) * BULLET_SPEED,
      vy: Math.sin(ang) * BULLET_SPEED,
      life: 120,
      auto: true
    });
  }

  function spawnAsteroid(){
    const x = 30 + Math.random() * (W-60);
    const size = 14 + Math.random()*18;
    const speedY = 0.5 + Math.random()*0.8 + frameCount*0.0004;
    const vx = (Math.random()-0.5)*0.6;
    const rot = (Math.random()-0.5)*0.06;
    const sides = 6 + Math.floor(Math.random()*4);
    const wobble = Array.from({length:sides}, ()=> 0.75 + Math.random()*0.5);
    asteroids.push({x, y:-size, size, vx, vy:speedY, rot, angle:0, sides, wobble});
  }

  function spawnParticles(x, y, color){
    for(let i=0; i<10; i++){
      const a = Math.random()*Math.PI*2;
      const sp = 1+Math.random()*3;
      particles.push({x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:28, maxLife:28, color});
    }
  }

  function update(){
    frameCount++;

    // Steer gun
    if(keys.has('a') || keys.has('arrowleft')){
      gunAngle = Math.max(-Math.PI + (Math.PI/2 - GUN_MAX_ANGLE), gunAngle - GUN_TURN_SPEED);
    }
    if(keys.has('d') || keys.has('arrowright')){
      gunAngle = Math.min(-Math.PI/2 + GUN_MAX_ANGLE, gunAngle + GUN_TURN_SPEED);
    }

    // Auto turret (from the Auto Turret upgrade) fires on its own
    if(hasAutoTurret){
      autoTurretCooldown--;
      if(autoTurretCooldown <= 0){
        autoTurretFire();
        autoTurretCooldown = AUTO_TURRET_COOLDOWN;
      }
    }

    // Move bullets
    for(let i=bullets.length-1; i>=0; i--){
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if(b.y < -10 || b.x < -10 || b.x > W+10 || b.life<=0) bullets.splice(i,1);
    }

    // Spawn asteroids
    spawnTimer--;
    if(spawnTimer <= 0){
      spawnAsteroid();
      spawnTimer = Math.max(28, 80 - shotCount*1.2);
    }

    // Move & check asteroids
    for(let i=asteroids.length-1; i>=0; i--){
      const a = asteroids[i];
      a.x += a.vx; a.y += a.vy; a.angle += a.rot;

      // Hit the platform
      if(a.y + a.size >= GUN_BASE_Y - 6){
        asteroids.splice(i,1);
        spawnParticles(a.x, GUN_BASE_Y, '#ff3d8a');
        lives--;
        updateHud();
        if(lives <= 0){
          gameOver();
          return;
        }
        continue;
      }

      // Bullet collision
      let hit = false;
      for(let j=bullets.length-1; j>=0; j--){
        const b = bullets[j];
        if(Math.hypot(b.x-a.x, b.y-a.y) < a.size + 3){
          bullets.splice(j,1);
          asteroids.splice(i,1);
          spawnParticles(a.x, a.y, '#ffc857');
          shotCount++;
          updateHud();
          hit = true;
          break;
        }
      }
    }

    // Update particles
    for(let i=particles.length-1; i>=0; i--){
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life--;
      if(p.life<=0) particles.splice(i,1);
    }
  }

  function gameOver(){
    running = false;
    updateStat('asteroid', [{stat:'highScore', type:'max', value:shotCount}]);
    zipReactToScore('asteroid', 'highScore', shotCount);
    if(shotCount > 0) earnTokens('asteroid_shot', shotCount);
    document.getElementById('asteroid-result-text').textContent = 'SHIELDS DOWN!';
    document.getElementById('asteroid-result-sub').textContent = 'You blasted ' + shotCount + ' asteroid' + (shotCount===1?'':'s') + ' before the platform was overwhelmed.';
    document.getElementById('asteroid-play').classList.add('hidden');
    document.getElementById('asteroid-result').classList.remove('hidden');
  }

  function render(){
    // Space background
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0,0,W,H);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    const starList = [[50,40],[150,90],[280,25],[420,70],[530,45],[80,200],[330,180],
                      [470,220],[580,160],[200,320],[400,300],[560,280],[100,380],[300,420]];
    starList.forEach(([sx,sy])=>{ ctx.beginPath(); ctx.arc(sx,sy,1,0,Math.PI*2); ctx.fill(); });

    // Distant nebula glow
    const neb = ctx.createRadialGradient(W*0.7,H*0.2,10,W*0.7,H*0.2,160);
    neb.addColorStop(0,'rgba(45,80,226,0.06)');
    neb.addColorStop(1,'transparent');
    ctx.fillStyle = neb; ctx.fillRect(0,0,W,H);
    const neb2 = ctx.createRadialGradient(W*0.25,H*0.6,10,W*0.25,H*0.6,120);
    neb2.addColorStop(0,'rgba(180,45,226,0.05)');
    neb2.addColorStop(1,'transparent');
    ctx.fillStyle = neb2; ctx.fillRect(0,0,W,H);

    // Particles
    particles.forEach(p=>{
      const alpha = p.life/p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Asteroids
    asteroids.forEach(a=>{
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle);
      ctx.fillStyle = '#8a7060';
      ctx.strokeStyle = '#c0a080';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for(let i=0; i<a.sides; i++){
        const ang = (i/a.sides)*Math.PI*2;
        const r = a.size * a.wobble[i];
        const px = Math.cos(ang)*r, py = Math.sin(ang)*r;
        i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Crater detail
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.arc(a.size*0.25,-a.size*0.2,a.size*0.2,0,Math.PI*2); ctx.fill();
      ctx.restore();
    });

    // Bullets
    bullets.forEach(b=>{
      const color = b.auto ? '#ffc857' : '#2de2c5';
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(b.x,b.y,3,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Gun platform strip
    ctx.fillStyle = '#3a3f4d';
    ctx.fillRect(0, GUN_BASE_Y - 16, W, 16 + (H - GUN_BASE_Y + 16));
    ctx.strokeStyle = '#5a6070';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0,GUN_BASE_Y-16); ctx.lineTo(W,GUN_BASE_Y-16); ctx.stroke();
    // Rivets
    for(let rx=20; rx<W; rx+=60){
      ctx.fillStyle = '#5a6070';
      ctx.beginPath(); ctx.arc(rx, GUN_BASE_Y-8, 3, 0, Math.PI*2); ctx.fill();
    }

    // Gun barrel
    const GX = W/2, GY = GUN_BASE_Y - 14;
    const BARREL_LEN = 38;
    ctx.save();
    ctx.translate(GX, GY);
    // gunAngle follows the standard trig convention (0 = right, -PI/2 = up) to
    // match the bullet velocity math below, but the barrel rectangle is drawn
    // pointing straight up in its own local coordinates — so it needs an
    // extra +90° added here to line up with where the bullets actually go.
    ctx.rotate(gunAngle + Math.PI/2);
    // Barrel
    ctx.fillStyle = '#6ad0ff';
    ctx.fillRect(-4, -BARREL_LEN, 8, BARREL_LEN);
    ctx.strokeStyle = '#a0e4ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(-4, -BARREL_LEN, 8, BARREL_LEN);
    ctx.restore();
    // Gun base
    ctx.fillStyle = '#4a90d0';
    ctx.beginPath();
    ctx.arc(GX, GY, 12, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#6aadee';
    ctx.beginPath();
    ctx.arc(GX, GY, 7, 0, Math.PI*2);
    ctx.fill();

    // Auto turret (small automatic gun to the side, from the Auto Turret upgrade)
    if(hasAutoTurret){
      const AX = W/2 + AUTO_TURRET_X_OFFSET, AY = GUN_BASE_Y - 14;
      ctx.fillStyle = '#ffc857';
      ctx.beginPath();
      ctx.arc(AX, AY, 8, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ffe0a0';
      ctx.beginPath();
      ctx.arc(AX, AY, 4, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
