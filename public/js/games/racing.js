/* =========================================================
   GAME 2: APEX LOOP (RACING)
   ========================================================= */
const RacingGame = (function(){
  const canvas = document.getElementById('racing-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const CX = W/2, CY = H/2;

  const OUTER_RX = 350, OUTER_RY = 250;
  const INNER_RX = 170, INNER_RY = 110;
  const BASE_SPEED = 1.8;
  const TURN_RATE = 0.045;
  const OFFTRACK_MULT = 0.45;
  const LAPS_TO_WIN = 5;
  const SPIN_DURATION = 75;       // frames a car is spun-out and can't steer
  const ITEM_TABLE = [
    { id: 'boost',  weight: 40, icon: '⚡' },
    { id: 'shell',  weight: 35, icon: '🔴' },
    { id: 'banana', weight: 25, icon: '🍌' }
  ];

  let mode = 'single';
  let difficulty = 'medium';
  let rafId = null;
  let running = false;
  let paused = false;
  let p1, p2, frameCount, powerups, shells, bananas;

  // Speed boost powerup state on car
  function applyBoost(car){ car.boostTimer = 180; } // 3 seconds at 60fps

  function rollItem(){
    const total = ITEM_TABLE.reduce((s,i)=>s+i.weight, 0);
    let roll = Math.random()*total;
    for(const it of ITEM_TABLE){ if(roll < it.weight) return it; roll -= it.weight; }
    return ITEM_TABLE[0];
  }

  function spinOutCar(car){
    car.spinTimer = SPIN_DURATION;
    car.boostTimer = 0;
    car.driftFrames = 0;
  }

  function fireShell(fromCar, atCar){
    shells.push({ x: fromCar.x, y: fromCar.y, target: atCar, owner: fromCar });
  }

  function dropBanana(fromCar){
    const bx = fromCar.x - Math.cos(fromCar.heading)*22;
    const by = fromCar.y - Math.sin(fromCar.heading)*22;
    bananas.push({ x: bx, y: by, owner: fromCar, armTimer: 30 });
  }

  function useItem(car, opponent){
    if(!car.heldItem || car.spinTimer > 0) return;
    if(car.heldItem === 'boost') applyBoost(car);
    else if(car.heldItem === 'shell') fireShell(car, opponent);
    else if(car.heldItem === 'banana') dropBanana(car);
    car.heldItem = null;
  }

  function setMode(m){
    mode = m;
    document.getElementById('racing-mode-single').classList.toggle('selected', m==='single');
    document.getElementById('racing-mode-multi').classList.toggle('selected', m==='multi');
    document.getElementById('racing-diff-section').classList.toggle('hidden', m!=='single');
    document.getElementById('racing-p2-label').textContent = (m==='single' ? 'BOT' : 'RIVAL') + ' · LAP 0/5';
  }
  function setDifficulty(d){
    difficulty = d;
    ['easy','medium','hard'].forEach(k=>{
      document.getElementById('racing-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  function trackPoint(angle, t){
    const ox = CX + OUTER_RX*Math.cos(angle), oy = CY + OUTER_RY*Math.sin(angle);
    const ix = CX + INNER_RX*Math.cos(angle), iy = CY + INNER_RY*Math.sin(angle);
    return { x: ix + t*(ox-ix), y: iy + t*(oy-iy) };
  }

  function spawnCar(tLane){
    const p = trackPoint(0, tLane);
    return {x:p.x, y:p.y, heading:Math.PI/2, prevAngle:0, totalAngle:0, laps:0, boostTimer:0,
            heldItem:null, spinTimer:0, driftFrames:0, driftHeld:false};
  }

  function spawnPowerups(){
    powerups = [];
    shells = [];
    bananas = [];
    // Place 3 item boxes at fixed points around the track
    const angles = [Math.PI/2, Math.PI, Math.PI*3/2];
    angles.forEach(a=>{
      const pt = trackPoint(a, 0.5);
      powerups.push({x:pt.x, y:pt.y, active:true, respawnTimer:0});
    });
  }

  function freshState(){
    p1 = spawnCar(0.38);
    p2 = spawnCar(0.62);
    frameCount = 0;
    spawnPowerups();
    updateHud();
  }

  function updateHud(){
    const p1Boost = p1 && p1.boostTimer > 0 ? ' ⚡' : '';
    const p2Boost = p2 && p2.boostTimer > 0 ? ' ⚡' : '';
    const itemIcon = id => id ? (ITEM_TABLE.find(i=>i.id===id)||{}).icon || '' : '';
    document.getElementById('racing-p1-label').textContent = 'YOU · LAP ' + Math.min(p1.laps,LAPS_TO_WIN) + '/' + LAPS_TO_WIN + p1Boost;
    document.getElementById('racing-p2-label').textContent = (mode==='single'?'BOT':'RIVAL') + ' · LAP ' + Math.min(p2.laps,LAPS_TO_WIN) + '/' + LAPS_TO_WIN + p2Boost;
    const p1ItemEl = document.getElementById('racing-p1-item');
    const p2ItemEl = document.getElementById('racing-p2-item');
    if(p1ItemEl) p1ItemEl.textContent = p1 ? itemIcon(p1.heldItem) : '';
    if(p2ItemEl) p2ItemEl.textContent = p2 ? itemIcon(p2.heldItem) : '';
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('racing-setup').classList.remove('hidden');
    document.getElementById('racing-play').classList.add('hidden');
    document.getElementById('racing-result').classList.add('hidden');
    setMode(mode);
    setDifficulty(difficulty);
  }

  function start(){
    document.getElementById('racing-setup').classList.add('hidden');
    document.getElementById('racing-result').classList.add('hidden');
    document.getElementById('racing-play').classList.remove('hidden');
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
    if(name === 'f') useItem(p1, p2);
    else if(name === 'l' && mode === 'multi') useItem(p2, p1);
  }

  function offTrackMultiplier(x,y){
    const dOuter = Math.pow((x-CX)/OUTER_RX,2) + Math.pow((y-CY)/OUTER_RY,2);
    const dInner = Math.pow((x-CX)/INNER_RX,2) + Math.pow((y-CY)/INNER_RY,2);
    if(dOuter > 1 || dInner < 1) return OFFTRACK_MULT;
    return 1;
  }

  function moveCar(car, turnDir, speedMult, driftHeld){
    if(car.spinTimer > 0){
      car.spinTimer--;
      car.heading += 0.35; // uncontrolled spin
      const speed = BASE_SPEED * 0.35;
      car.x += Math.cos(car.heading) * speed;
      car.y += Math.sin(car.heading) * speed;
    } else if(driftHeld && turnDir !== 0){
      car.driftFrames = (car.driftFrames||0) + 1;
      car.heading += turnDir * TURN_RATE * 1.35;
      const penalty = offTrackMultiplier(car.x, car.y);
      const boost = car.boostTimer > 0 ? 1.45 : 1;
      if(car.boostTimer > 0) car.boostTimer--;
      const speed = BASE_SPEED * speedMult * penalty * boost * 0.92;
      car.x += Math.cos(car.heading) * speed;
      car.y += Math.sin(car.heading) * speed;
    } else {
      if(car.driftFrames > 0){
        // Released the drift — pay out a mini-turbo scaled to how long it was held.
        if(car.driftFrames >= 100) car.boostTimer = Math.max(car.boostTimer, 150);
        else if(car.driftFrames >= 50) car.boostTimer = Math.max(car.boostTimer, 90);
        car.driftFrames = 0;
      }
      car.heading += turnDir * TURN_RATE;
      const penalty = offTrackMultiplier(car.x, car.y);
      const boost = car.boostTimer > 0 ? 1.45 : 1;
      if(car.boostTimer > 0) car.boostTimer--;
      const speed = BASE_SPEED * speedMult * penalty * boost;
      car.x += Math.cos(car.heading) * speed;
      car.y += Math.sin(car.heading) * speed;
    }
    car.x = clamp(car.x, 5, W-5);
    car.y = clamp(car.y, 5, H-5);

    const rawAngle = Math.atan2(car.y-CY, car.x-CX);
    let delta = rawAngle - car.prevAngle;
    while(delta > Math.PI) delta -= Math.PI*2;
    while(delta < -Math.PI) delta += Math.PI*2;
    car.totalAngle += delta;
    car.prevAngle = rawAngle;
    car.laps = Math.max(0, Math.floor(car.totalAngle / (Math.PI*2)));
  }

  // Improved bot AI: uses the car's current track position angle to look ahead
  // on the track and steer toward it. Clamps turn so it can never over-rotate.
  function botTurnDir(car, targetT, lookahead){
    const rawAngle = Math.atan2(car.y-CY, car.x-CX);
    const target = trackPoint(rawAngle + lookahead, targetT);
    const desiredHeading = Math.atan2(target.y-car.y, target.x-car.x);
    let diff = desiredHeading - car.heading;
    while(diff > Math.PI) diff -= Math.PI*2;
    while(diff < -Math.PI) diff += Math.PI*2;
    // Clamp the steering command proportionally — prevents wild oscillations
    const maxTurn = Math.PI * 0.6;
    diff = clamp(diff, -maxTurn, maxTurn);
    if(Math.abs(diff) < 0.03) return 0;
    return diff > 0 ? 1 : -1;
  }

  function checkPowerups(car){
    powerups.forEach(pu=>{
      if(!pu.active) return;
      if(Math.hypot(car.x-pu.x, car.y-pu.y) < 18){
        pu.active = false;
        pu.respawnTimer = 480; // 8 seconds respawn
        if(!car.heldItem) car.heldItem = rollItem().id;
      }
    });
  }

  function updateProjectiles(){
    for(let i=shells.length-1; i>=0; i--){
      const s = shells[i];
      const target = s.target;
      const dx = target.x - s.x, dy = target.y - s.y;
      const dist = Math.hypot(dx,dy);
      if(dist < 14 && target.spinTimer <= 0){
        spinOutCar(target);
        shells.splice(i,1);
        continue;
      }
      const speed = 6;
      s.x += (dx/dist) * speed;
      s.y += (dy/dist) * speed;
    }
    for(let i=bananas.length-1; i>=0; i--){
      const b = bananas[i];
      if(b.armTimer > 0){ b.armTimer--; continue; }
      [p1,p2].forEach(car=>{
        if(car === b.owner) return;
        if(car.spinTimer <= 0 && Math.hypot(car.x-b.x, car.y-b.y) < 16){
          spinOutCar(car);
          b.hit = true;
        }
      });
      if(b.hit) bananas.splice(i,1);
    }
  }

  function update(){
    frameCount++;
    let p1Turn = 0;
    if(keys.has('a')) p1Turn = -1;
    else if(keys.has('d')) p1Turn = 1;
    const p1Drift = keys.has('shift');
    moveCar(p1, p1Turn, 1, p1Drift);
    checkPowerups(p1);

    if(mode === 'multi'){
      let p2Turn = 0;
      if(keys.has('arrowleft')) p2Turn = -1;
      else if(keys.has('arrowright')) p2Turn = 1;
      const p2Drift = keys.has('control');
      moveCar(p2, p2Turn, 1, p2Drift);
      checkPowerups(p2);
    } else {
      // Fixed AI: stable targetT and lookahead per difficulty, no jitter
      let targetT, speedMult, lookahead;
      if(difficulty === 'easy'){ targetT = 0.5; speedMult = 0.80; lookahead = 0.30; }
      else if(difficulty === 'medium'){ targetT = 0.36; speedMult = 0.98; lookahead = 0.22; }
      else { targetT = 0.14; speedMult = 1.20; lookahead = 0.18; }

      // Overtaking: if the bot is close behind P1 in track progress, swing to
      // the opposite side of the racing line to find a passing lane instead
      // of just tailing them on the same line.
      const progressGap = p1.totalAngle - p2.totalAngle;
      if(progressGap > 0 && progressGap < 0.35){
        targetT = targetT > 0.5 ? targetT - 0.22 : targetT + 0.22;
        speedMult *= 1.06; // extra push while making the move
      }

      // Drifting: commit extra speed through a sharp corner on higher
      // difficulties instead of braking off the racing line for it.
      const rawAngle = Math.atan2(p2.y-CY, p2.x-CX);
      const aheadTarget = trackPoint(rawAngle + lookahead, targetT);
      const desiredHeading = Math.atan2(aheadTarget.y-p2.y, aheadTarget.x-p2.x);
      let cornerSharpness = desiredHeading - p2.heading;
      while(cornerSharpness > Math.PI) cornerSharpness -= Math.PI*2;
      while(cornerSharpness < -Math.PI) cornerSharpness += Math.PI*2;
      if(difficulty === 'hard' && Math.abs(cornerSharpness) > 0.35){
        speedMult *= 1.08; // drift through it rather than slow down
      }

      // Wall avoidance: if the car has drifted off-track, steer hard back
      // toward the centre line instead of continuing to follow the fixed
      // racing line as if nothing happened.
      const offTrack = offTrackMultiplier(p2.x, p2.y) < 1;
      const dir = offTrack ? botTurnDir(p2, 0.5, lookahead * 0.6) : botTurnDir(p2, targetT, lookahead);
      moveCar(p2, dir, offTrack ? speedMult * 0.85 : speedMult, false);
      checkPowerups(p2);

      // Item AI: use whatever's held after a short delay, like a Mario Kart bot.
      if(p2.heldItem && frameCount % 45 === 0 && Math.random() < 0.6){
        useItem(p2, p1);
      }
    }

    updateProjectiles();

    // Respawn collected powerups
    powerups.forEach(pu=>{
      if(!pu.active){ pu.respawnTimer--; if(pu.respawnTimer <= 0) pu.active = true; }
    });

    updateHud();

    if(p1.laps >= LAPS_TO_WIN) endRace(true);
    else if(p2.laps >= LAPS_TO_WIN) endRace(false);
  }

  function endRace(p1Won){
    running = false;
    updateStat('racing', [{stat:'wins', type:'increment_if', value:1, cond:p1Won}]);
    showZipCompanion(p1Won ? 'win' : 'loss');
    earnTokens(p1Won ? 'racing_win' : 'racing_loss', 1);
    document.getElementById('racing-result-text').textContent = p1Won ? 'YOU WIN THE RACE!' : (mode==='single' ? 'BOT WINS THE RACE' : 'RIVAL WINS THE RACE');
    document.getElementById('racing-result-sub').textContent = 'You: ' + Math.min(p1.laps,LAPS_TO_WIN) + ' laps · Opponent: ' + Math.min(p2.laps,LAPS_TO_WIN) + ' laps.';
    document.getElementById('racing-play').classList.add('hidden');
    document.getElementById('racing-result').classList.remove('hidden');
  }

  function drawEllipse(rx, ry, color, width){
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(CX, CY, rx, ry, 0, 0, Math.PI*2);
    ctx.stroke();
  }

  function drawCar(car, isP1, color, label){
    const img = SPRITES[isP1 ? 'redCar' : 'blueCar'];
    const drawn = drawRotatedSprite(ctx, img, car.x, car.y, car.heading, 3, 3.5, 6, 7, 2.9, Math.PI/2);
    if(!drawn){
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.heading);
      ctx.fillStyle = color;
      ctx.fillRect(-8,-9,20,18);
      ctx.fillStyle = '#04060a';
      ctx.fillRect(8,-9,4,18);
      ctx.restore();
    }
    // Boost flame effect
    if(car.boostTimer > 0){
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.heading);
      const flicker = Math.random()*4;
      ctx.fillStyle = `rgba(255,${140+Math.random()*60|0},0,0.85)`;
      ctx.beginPath();
      ctx.ellipse(-10, 0, 3+flicker, 5, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
    // Spin-out stars
    if(car.spinTimer > 0){
      ctx.save();
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💫', car.x, car.y-16);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, car.x, car.y-20);
  }

  function render(){
    // Polished background — starfield + grass + track
    ctx.fillStyle = '#07111a';
    ctx.fillRect(0,0,W,H);

    // Subtle stars in background
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    const stars = [[40,30],[120,80],[200,20],[330,55],[470,35],[560,70],[620,25],[750,50],
                   [80,160],[280,140],[480,180],[680,130],[760,170],[30,400],[150,430],
                   [400,410],[600,390],[740,420]];
    stars.forEach(([sx,sy])=>{ ctx.beginPath(); ctx.arc(sx,sy,1,0,Math.PI*2); ctx.fill(); });

    // Grass infield
    ctx.fillStyle = '#0d3a1a';
    ctx.beginPath(); ctx.ellipse(CX,CY, INNER_RX+2, INNER_RY+2, 0, 0, Math.PI*2); ctx.fill();

    // Outer grass area
    ctx.fillStyle = '#0d2e18';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#07111a'; // sky/track base
    ctx.beginPath(); ctx.ellipse(CX,CY, OUTER_RX+22, OUTER_RY+22, 0, 0, Math.PI*2); ctx.fill();

    // Track surface with subtle gradient
    ctx.fillStyle = '#2e333f';
    ctx.beginPath(); ctx.ellipse(CX,CY, OUTER_RX, OUTER_RY, 0, 0, Math.PI*2); ctx.fill();

    // Infield grass
    ctx.fillStyle = '#0d3a1a';
    ctx.beginPath(); ctx.ellipse(CX,CY, INNER_RX, INNER_RY, 0, 0, Math.PI*2); ctx.fill();

    // Rumble strips (alternating red/white dashes on edges)
    const rumbleSteps = 32;
    for(let i=0; i<rumbleSteps; i++){
      const a1 = (i/rumbleSteps)*Math.PI*2;
      const a2 = ((i+0.5)/rumbleSteps)*Math.PI*2;
      ctx.fillStyle = i%2===0 ? 'rgba(255,80,80,0.7)' : 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(CX,CY, OUTER_RX+1, OUTER_RY+1, 0, a1, a2); 
      ctx.ellipse(CX,CY, OUTER_RX+14, OUTER_RY+14, 0, a2, a1, true);
      ctx.fill();
      // Inner rumble
      ctx.fillStyle = i%2===0 ? 'rgba(255,80,80,0.5)' : 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(CX,CY, INNER_RX-1, INNER_RY-1, 0, a1, a2);
      ctx.ellipse(CX,CY, INNER_RX-12, INNER_RY-12, 0, a2, a1, true);
      ctx.fill();
    }

    // Track lane markings (dashed center line)
    ctx.setLineDash([14,14]);
    ctx.strokeStyle = 'rgba(255,255,230,0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(CX,CY, (OUTER_RX+INNER_RX)/2, (OUTER_RY+INNER_RY)/2, 0, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);

    // Track edge lines
    drawEllipse(OUTER_RX, OUTER_RY, 'rgba(255,255,255,0.55)', 2.5);
    drawEllipse(INNER_RX, INNER_RY, 'rgba(255,255,255,0.55)', 2.5);

    // Start/finish line
    const fx1 = trackPoint(0,0), fx2 = trackPoint(0,1);
    ctx.strokeStyle = '#ffc857';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(fx1.x,fx1.y); ctx.lineTo(fx2.x,fx2.y); ctx.stroke();
    ctx.fillStyle = '#ffc857';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('START', (fx1.x+fx2.x)/2, (fx1.y+fx2.y)/2 - 8);

    // Item boxes
    powerups.forEach(pu=>{
      if(!pu.active) return;
      const pulse = 0.7 + Math.sin(frameCount*0.12)*0.3;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffe540';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pu.x, pu.y, 10, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#222';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('?', pu.x, pu.y+4);
      ctx.restore();
    });

    // Shells in flight
    shells.forEach(s=>{
      ctx.save();
      ctx.fillStyle = '#ff3d3d';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.restore();
    });

    // Bananas
    bananas.forEach(b=>{
      ctx.save();
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🍌', b.x, b.y+5);
      ctx.restore();
    });

    drawCar(p1, true, '#2de2c5', 'YOU');
    drawCar(p2, false, '#ff3d8a', mode==='single'?'BOT':'P2');
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
