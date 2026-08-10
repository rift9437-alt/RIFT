/* =========================================================
   GAME 3: TANK DUEL
   ========================================================= */
const TankGame = (function(){
  const canvas = document.getElementById('tank-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const TANK_HALF = 14;
  const FORWARD_SPEED = 2.2;
  const ROTATE_SPEED = 0.045;
  const BULLET_SPEED = 7;
  const BULLET_RADIUS = 4;
  const HIT_RADIUS = 18;
  const COOLDOWN_FRAMES = 40;
  const WIN_HITS = 3;

  const OBSTACLES = [
    {x:350, y:140, w:100, h:22},
    {x:350, y:338, w:100, h:22},
    {x:378, y:228, w:44, h:44}
  ];

  // Waypoints just outside each obstacle's corners — the bot uses these to
  // flank around cover instead of driving straight at it.
  const COVER_POINTS = OBSTACLES.flatMap(o => [
    {x:o.x-34, y:o.y-34}, {x:o.x+o.w+34, y:o.y-34},
    {x:o.x-34, y:o.y+o.h+34}, {x:o.x+o.w+34, y:o.y+o.h+34}
  ]).map(p => ({ x: clamp(p.x, 20, W-20), y: clamp(p.y, 20, H-20) }));

  let mode = 'single';
  let difficulty = 'medium';
  let rafId = null;
  let running = false;
  let paused = false;
  let p1, p2, bullets, hitsP1, hitsP2, botStuckTimer;
  let p1PrevX, p1PrevY, p1Vx, p1Vy, dodgeTimer, dodgeHeading, coverTarget;

  function setMode(m){
    mode = m;
    document.getElementById('tank-mode-single').classList.toggle('selected', m==='single');
    document.getElementById('tank-mode-multi').classList.toggle('selected', m==='multi');
    document.getElementById('tank-diff-section').classList.toggle('hidden', m!=='single');
  }
  function setDifficulty(d){
    difficulty = d;
    ['easy','medium','hard'].forEach(k=>{
      document.getElementById('tank-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  function spawnPositions(){
    p1 = {x:70, y:H/2, angle:0, cooldown:0};
    p2 = {x:W-70, y:H/2, angle:Math.PI, cooldown:0};
  }

  function freshState(){
    spawnPositions();
    bullets = [];
    hitsP1 = 0; hitsP2 = 0;
    botStuckTimer = 0;
    p1PrevX = p1.x; p1PrevY = p1.y; p1Vx = 0; p1Vy = 0;
    dodgeTimer = 0; dodgeHeading = 0; coverTarget = null;
    updateHud();
  }

  function updateHud(){
    document.getElementById('tank-p1-label').textContent = 'PLAYER 1: ' + hitsP1;
    document.getElementById('tank-p2-label').textContent = (mode==='single'?'BOT: ':'PLAYER 2: ') + hitsP2;
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('tank-setup').classList.remove('hidden');
    document.getElementById('tank-play').classList.add('hidden');
    document.getElementById('tank-result').classList.add('hidden');
    setMode(mode);
    setDifficulty(difficulty);
  }

  function start(){
    document.getElementById('tank-setup').classList.add('hidden');
    document.getElementById('tank-result').classList.add('hidden');
    document.getElementById('tank-play').classList.remove('hidden');
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
    if(name === 'space') fire(p1, true);
    if(mode === 'multi' && name === 'l') fire(p2, false);
  }

  function rectsOverlap(ax,ay,aw,ah, bx,by,bw,bh){
    return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
  }

  function blockedAt(x,y){
    if(x-TANK_HALF < 6 || x+TANK_HALF > W-6 || y-TANK_HALF < 6 || y+TANK_HALF > H-6) return true;
    for(const o of OBSTACLES){
      if(rectsOverlap(x-TANK_HALF,y-TANK_HALF,TANK_HALF*2,TANK_HALF*2, o.x,o.y,o.w,o.h)) return true;
    }
    return false;
  }

  // Sample-based line-of-sight check between two points — used so the bot
  // can tell whether cover is blocking a shot, rather than firing blindly
  // into an obstacle.
  function hasLineOfSight(ax,ay,bx,by){
    const steps = 20;
    for(let i=1; i<steps; i++){
      const t = i/steps;
      const px = ax + (bx-ax)*t, py = ay + (by-ay)*t;
      for(const o of OBSTACLES){
        if(px >= o.x && px <= o.x+o.w && py >= o.y && py <= o.y+o.h) return false;
      }
    }
    return true;
  }

  function moveTank(tank, forwardDir, rotateDir, speedMult, rotateMult){
    tank.angle += rotateDir * ROTATE_SPEED * rotateMult;
    if(forwardDir !== 0){
      const nx = tank.x + Math.cos(tank.angle)*FORWARD_SPEED*forwardDir*speedMult;
      const ny = tank.y + Math.sin(tank.angle)*FORWARD_SPEED*forwardDir*speedMult;
      if(!blockedAt(nx,ny)){ tank.x = nx; tank.y = ny; }
    }
    if(tank.cooldown > 0) tank.cooldown--;
  }

  function fire(tank, isP1){
    if(tank.cooldown > 0) return;
    tank.cooldown = COOLDOWN_FRAMES;
    const fx = tank.x + Math.cos(tank.angle)*(TANK_HALF+6);
    const fy = tank.y + Math.sin(tank.angle)*(TANK_HALF+6);
    bullets.push({
      x:fx, y:fy,
      vx:Math.cos(tank.angle)*BULLET_SPEED,
      vy:Math.sin(tank.angle)*BULLET_SPEED,
      owner: isP1 ? 'p1' : 'p2',
      life: 120
    });
  }

  function botUpdate(){
    let aimMult, fireChance, speedMult, rotateMult, keepDist, dodgeSkill, coverSkill;
    if(difficulty === 'easy'){ aimMult=0.45; fireChance=0.3; speedMult=0.55; rotateMult=0.55; keepDist=110; dodgeSkill=0.25; coverSkill=0.2; }
    else if(difficulty === 'medium'){ aimMult=0.7; fireChance=0.5; speedMult=0.75; rotateMult=0.75; keepDist=130; dodgeSkill=0.55; coverSkill=0.5; }
    else { aimMult=0.95; fireChance=0.7; speedMult=0.95; rotateMult=1.0; keepDist=150; dodgeSkill=0.85; coverSkill=0.8; }

    // Predict incoming bullets — if one of P1's shots is on a path that will
    // pass close to us soon, dodge by turning off that line instead of
    // holding our current heading and eating the hit.
    if(dodgeTimer <= 0 && Math.random() < dodgeSkill){
      for(const b of bullets){
        if(b.owner !== 'p1') continue;
        for(let t=4; t<=24; t+=4){
          const bx = b.x + b.vx*t, by = b.y + b.vy*t;
          if(Math.hypot(bx-p2.x, by-p2.y) < HIT_RADIUS + 14){
            // Steer perpendicular to the bullet's travel direction.
            const bulletHeading = Math.atan2(b.vy, b.vx);
            dodgeHeading = bulletHeading + (Math.random() < 0.5 ? Math.PI/2 : -Math.PI/2);
            dodgeTimer = 16;
            break;
          }
        }
        if(dodgeTimer > 0) break;
      }
    }

    let targetAngle, forwardDir, rotateDir;
    const dist = Math.hypot(p1.x-p2.x, p1.y-p2.y);
    const los = hasLineOfSight(p2.x, p2.y, p1.x, p1.y);

    if(dodgeTimer > 0){
      dodgeTimer--;
      targetAngle = dodgeHeading;
      forwardDir = 1;
    } else if(!los && Math.random() < coverSkill){
      // Flank: no clean shot right now, so head toward the nearest cover
      // waypoint to come around an obstacle at an angle instead of ramming
      // straight into it or standing still.
      if(!coverTarget || Math.hypot(coverTarget.x-p2.x, coverTarget.y-p2.y) < 24){
        coverTarget = COVER_POINTS.reduce((best,pt)=>{
          const d = Math.hypot(pt.x-p2.x, pt.y-p2.y);
          return (!best || d < best.d) ? {x:pt.x, y:pt.y, d} : best;
        }, null);
      }
      targetAngle = Math.atan2(coverTarget.y-p2.y, coverTarget.x-p2.x);
      forwardDir = 1;
    } else {
      coverTarget = null;
      targetAngle = Math.atan2(p1.y-p2.y, p1.x-p2.x);
      forwardDir = 0;
      if(Math.abs(angleDiff(targetAngle, p2.angle)) < 0.6){
        if(dist > keepDist) forwardDir = 1;
        else if(dist < keepDist*0.6) forwardDir = -1;
      }
    }

    let diff = angleDiff(targetAngle, p2.angle);
    rotateDir = Math.abs(diff) < 0.04 ? 0 : (diff > 0 ? 1 : -1);

    if(botStuckTimer > 0){
      botStuckTimer--;
      forwardDir = -1;
    } else if(forwardDir !== 0){
      const testX = p2.x + Math.cos(p2.angle)*FORWARD_SPEED*forwardDir*speedMult;
      const testY = p2.y + Math.sin(p2.angle)*FORWARD_SPEED*forwardDir*speedMult;
      if(blockedAt(testX, testY)){
        forwardDir = -forwardDir;
        botStuckTimer = 25;
      }
    }

    moveTank(p2, forwardDir, rotateDir, speedMult, rotateMult);

    // Lead the shot: aim at where P1 is heading, not just where they are now.
    const leadFrames = 10 * aimMult;
    const predictedX = p1.x + p1Vx*leadFrames, predictedY = p1.y + p1Vy*leadFrames;
    const leadAngle = Math.atan2(predictedY-p2.y, predictedX-p2.x);
    const aimDiff = angleDiff(leadAngle, p2.angle);

    const fireThreshold = 0.18 / aimMult;
    if(los && Math.abs(aimDiff) < fireThreshold && Math.random() < fireChance){
      fire(p2, false);
    }
  }

  function angleDiff(a, b){
    let d = a - b;
    while(d > Math.PI) d -= Math.PI*2;
    while(d < -Math.PI) d += Math.PI*2;
    return d;
  }

  function update(){
    let p1Forward = 0, p1Rotate = 0;
    if(keys.has('w')) p1Forward = 1;
    else if(keys.has('s')) p1Forward = -1;
    if(keys.has('a')) p1Rotate = -1;
    else if(keys.has('d')) p1Rotate = 1;
    moveTank(p1, p1Forward, p1Rotate, 1, 1);
    p1Vx = p1.x - p1PrevX; p1Vy = p1.y - p1PrevY;
    p1PrevX = p1.x; p1PrevY = p1.y;

    if(mode === 'multi'){
      let p2Forward = 0, p2Rotate = 0;
      if(keys.has('arrowup')) p2Forward = 1;
      else if(keys.has('arrowdown')) p2Forward = -1;
      if(keys.has('arrowleft')) p2Rotate = -1;
      else if(keys.has('arrowright')) p2Rotate = 1;
      moveTank(p2, p2Forward, p2Rotate, 1, 1);
    } else {
      botUpdate();
    }

    for(let i=bullets.length-1; i>=0; i--){
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      let remove = false;
      if(b.x < 0 || b.x > W || b.y < 0 || b.y > H) remove = true;
      if(b.life <= 0) remove = true;
      for(const o of OBSTACLES){
        if(b.x > o.x && b.x < o.x+o.w && b.y > o.y && b.y < o.y+o.h){ remove = true; break; }
      }
      if(!remove){
        const targetTank = b.owner === 'p1' ? p2 : p1;
        const d = Math.hypot(b.x-targetTank.x, b.y-targetTank.y);
        if(d <= HIT_RADIUS){
          remove = true;
          if(b.owner === 'p1'){ hitsP1++; } else { hitsP2++; }
          updateHud();
          spawnPositions();
          if(hitsP1 >= WIN_HITS){ endMatch(true); return; }
          if(hitsP2 >= WIN_HITS){ endMatch(false); return; }
        }
      }
      if(remove) bullets.splice(i,1);
    }
  }

  function endMatch(p1Won){
    running = false;
    updateStat('tank', [{stat:'wins', type:'increment_if', value:1, cond:p1Won}]);
    showZipCompanion(p1Won ? 'win' : 'loss');
    earnTokens(p1Won ? 'tank_win' : 'tank_loss', 1);
    document.getElementById('tank-result-text').textContent = p1Won ? 'YOU WIN THE DUEL!' : (mode==='single'?'BOT WINS THE DUEL':'PLAYER 2 WINS THE DUEL');
    document.getElementById('tank-result-sub').textContent = 'Final hits ' + hitsP1 + ' : ' + hitsP2 + '.';
    document.getElementById('tank-play').classList.add('hidden');
    document.getElementById('tank-result').classList.remove('hidden');
  }

  function drawTank(tank, isP1, color, label){
    const img = SPRITES[isP1 ? 'redTank' : 'blueTank'];
    const drawn = drawRotatedSprite(ctx, img, tank.x, tank.y, tank.angle, 3.5, 4.5, 12, 9, 2.8, 0, true);
    if(!drawn){
      ctx.save();
      ctx.translate(tank.x, tank.y);
      ctx.rotate(tank.angle);
      ctx.fillStyle = color;
      ctx.fillRect(-TANK_HALF, -TANK_HALF, TANK_HALF*2, TANK_HALF*2);
      ctx.fillStyle = '#0a0d13';
      ctx.fillRect(0, -3, TANK_HALF+10, 6);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, tank.x, tank.y - TANK_HALF - 8);
  }

  function render(){
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for(let gx=0; gx<W; gx+=40){ ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,H); ctx.stroke(); }
    for(let gy=0; gy<H; gy+=40){ ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(W,gy); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(6,6,W-12,H-12);

    ctx.fillStyle = '#3a4150';
    OBSTACLES.forEach(o=> ctx.fillRect(o.x,o.y,o.w,o.h));

    drawTank(p1, true, '#2de2c5', 'P1');
    drawTank(p2, false, '#ff3d8a', mode==='single'?'BOT':'P2');

    ctx.fillStyle = '#ffe27a';
    bullets.forEach(b=>{
      ctx.beginPath();
      ctx.arc(b.x,b.y,BULLET_RADIUS,0,Math.PI*2);
      ctx.fill();
    });
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
