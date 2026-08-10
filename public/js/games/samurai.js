/* =========================================================
   GAME: SAMURAI SHOWDOWN
   ========================================================= */
const SamuraiGame = (function(){
  const canvas = document.getElementById('samurai-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const GROUND_Y = H - 70;
  const GRAVITY = 0.72;
  const JUMP_VY = -13;
  const MOVE_SPEED = 3.4;
  const FIGHTER_W = 30, FIGHTER_H = 78;

  const MAX_HP = 100;
  const MAX_STAM = 100;
  const SLASH_COST = 18;
  const BLOCK_DRAIN = 42;        // per second while holding guard
  const STAM_REGEN = 26;         // per second
  const SLASH_DAMAGE = 19;
  const BLOCKED_DAMAGE = 4;
  const COUNTER_DAMAGE = 32;
  const PARRY_WINDOW = 9;        // frames after pressing guard that count as a parry
  const SLASH_WINDUP = 8;        // frames before the blade is live
  const SLASH_ACTIVE = 7;        // frames the blade can connect
  const SLASH_RECOVER = 13;
  const STAGGER_FRAMES = 42;     // how long a parried attacker is helpless
  const REACH = 74;
  const ROUNDS_TO_WIN = 3;

  const DIFFS = {
    easy:   { label:'EASY',   react:0.30, aggression:0.5, guard:0.25, spacing:78 },
    medium: { label:'MEDIUM', react:0.55, aggression:0.8, guard:0.5,  spacing:72 },
    hard:   { label:'HARD',   react:0.82, aggression:1.1, guard:0.75, spacing:66 }
  };
  let mode = 'single';
  let difficulty = 'medium';

  let rafId = null, running = false, paused = false;
  let p1, p2, roundWins, oppWins, roundState, roundTimer, banner;
  let sparks, slashArcs, shake, frame, botTimer, botPlan;

  function setMode(m){
    mode = m;
    document.getElementById('samurai-mode-single').classList.toggle('selected', m==='single');
    document.getElementById('samurai-mode-multi').classList.toggle('selected', m==='multi');
    document.getElementById('samurai-diff-section').classList.toggle('hidden', m!=='single');
    document.getElementById('samurai-p2-label').textContent = m==='single' ? 'RONIN' : 'PLAYER 2';
  }
  function setDifficulty(d){
    difficulty = d;
    ['easy','medium','hard'].forEach(k=>{
      document.getElementById('samurai-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  function makeFighter(x, facing, color){
    return {
      x, y: GROUND_Y, vx:0, vy:0, facing,
      hp: MAX_HP, stam: MAX_STAM,
      onGround: true,
      guarding: false,
      guardPressedAt: -999,
      guardBroken: 0,
      attack: null,          // { phase, timer, hasHit }
      stagger: 0,
      counterWindow: 0,
      hitFlash: 0,
      color
    };
  }

  function freshRound(){
    p1 = makeFighter(W*0.28, 1, '#6b8cff');
    p2 = makeFighter(W*0.72, -1, '#ff4d4d');
    sparks = [];
    slashArcs = [];
    shake = 0;
    botTimer = 0;
    botPlan = 'approach';
    roundState = 'intro';
    roundTimer = 90;
    showBanner('READY');
    updateHud();
  }

  function freshState(){
    roundWins = 0;
    oppWins = 0;
    frame = 0;
    freshRound();
  }

  function showBanner(text){
    banner = text;
    const el = document.getElementById('samurai-banner');
    el.textContent = text;
    el.classList.remove('hidden');
  }
  function hideBanner(){
    banner = null;
    document.getElementById('samurai-banner').classList.add('hidden');
  }

  function updateHud(){
    document.getElementById('samurai-score-hud').textContent = roundWins + ' : ' + oppWins;
    document.getElementById('samurai-p1-hp').style.width = Math.max(0, p1.hp/MAX_HP*100) + '%';
    document.getElementById('samurai-p2-hp').style.width = Math.max(0, p2.hp/MAX_HP*100) + '%';
    document.getElementById('samurai-p1-stam').style.width = Math.max(0, p1.stam/MAX_STAM*100) + '%';
    document.getElementById('samurai-p2-stam').style.width = Math.max(0, p2.stam/MAX_STAM*100) + '%';
  }

  function spark(x, y, color, n){
    for(let i=0;i<(n||10);i++){
      sparks.push({
        x, y,
        vx: (Math.random()-0.5)*7,
        vy: (Math.random()-0.5)*7 - 1.5,
        life: 1,
        color
      });
    }
  }

  /* ---------------- combat ---------------- */
  function trySlash(f){
    if(f.attack || f.stagger > 0) return;
    // A counter off a parry is free; otherwise a slash costs stamina.
    const free = f.counterWindow > 0;
    if(!free && f.stam < SLASH_COST) return;
    if(!free) f.stam -= SLASH_COST;
    f.attack = { phase:'windup', timer: SLASH_WINDUP, hasHit:false, counter: free };
    f.guarding = false;
    if(free) f.counterWindow = 0;
    Sfx.play('whoosh');
  }

  function pressGuard(f){
    if(f.stagger > 0 || f.guardBroken > 0) return;
    f.guarding = true;
    // Only the first frames of a guard count as a parry, which is what makes
    // tapping it on reaction different from just holding it down.
    f.guardPressedAt = frame;
  }

  function releaseGuard(f){ f.guarding = false; }

  function facingTarget(a, b){ return b.x > a.x ? 1 : -1; }

  function resolveHit(attacker, defender){
    const parrying = defender.guarding && (frame - defender.guardPressedAt) <= PARRY_WINDOW;
    const blocking = defender.guarding && defender.stam > 0;

    if(parrying){
      // Parry: attacker is staggered wide open, defender gets a free counter.
      attacker.stagger = STAGGER_FRAMES;
      attacker.attack = null;
      defender.counterWindow = 50;
      defender.stam = Math.min(MAX_STAM, defender.stam + 20);
      spark((attacker.x + defender.x)/2, GROUND_Y - 46, '#ffd23f', 22);
      shake = 14;
      showBanner('PARRY!');
      setTimeout(()=>{ if(roundState === 'fight') hideBanner(); }, 700);
      Sfx.play('perfect');
      return;
    }

    if(blocking){
      defender.hp -= BLOCKED_DAMAGE;
      defender.stam -= 34;
      defender.vx += attacker.facing * 3.2;
      spark(defender.x - defender.facing*18, GROUND_Y - 44, '#9fb8ff', 10);
      shake = 5;
      Sfx.play('hit', 1.5);
      if(defender.stam <= 0){
        // Guard break: no blocking at all for a moment.
        defender.stam = 0;
        defender.guarding = false;
        defender.guardBroken = 46;
        defender.stagger = 26;
        showBanner('GUARD BROKEN!');
        setTimeout(()=>{ if(roundState === 'fight') hideBanner(); }, 800);
        Sfx.play('alarm');
      }
      return;
    }

    const dmg = attacker.attack && attacker.attack.counter ? COUNTER_DAMAGE : SLASH_DAMAGE;
    defender.hp -= dmg;
    defender.hitFlash = 10;
    defender.vx += attacker.facing * 5.5;
    spark(defender.x, GROUND_Y - 46, '#ff4d4d', 18);
    shake = dmg > SLASH_DAMAGE ? 16 : 9;
    Sfx.play(dmg > SLASH_DAMAGE ? 'explode' : 'thud');
    if(dmg > SLASH_DAMAGE){
      showBanner('COUNTER!');
      setTimeout(()=>{ if(roundState === 'fight') hideBanner(); }, 700);
    }
  }

  function stepFighter(f, foe, input){
    if(f.hitFlash > 0) f.hitFlash--;
    if(f.guardBroken > 0) f.guardBroken--;
    if(f.counterWindow > 0) f.counterWindow--;

    if(f.stagger > 0){
      f.stagger--;
      f.guarding = false;
      f.attack = null;
    } else {
      // movement is locked once a slash starts
      if(!f.attack){
        let dir = 0;
        if(input.left) dir -= 1;
        if(input.right) dir += 1;
        const speed = f.guarding ? MOVE_SPEED*0.45 : MOVE_SPEED;
        f.vx = dir * speed;
        if(input.jump && f.onGround){
          f.vy = JUMP_VY;
          f.onGround = false;
          Sfx.play('click');
        }
      } else {
        f.vx *= 0.6;
      }
      if(input.guardDown && !f.guarding) pressGuard(f);
      if(!input.guardDown && f.guarding) releaseGuard(f);
      if(input.slash) trySlash(f);
    }

    // stamina: guarding drains, everything else regenerates
    const dt = 1/60;
    if(f.guarding) f.stam = Math.max(0, f.stam - BLOCK_DRAIN*dt);
    else f.stam = Math.min(MAX_STAM, f.stam + STAM_REGEN*dt);
    if(f.guarding && f.stam <= 0){
      f.guarding = false;
      f.guardBroken = 40;
    }

    // physics
    f.x += f.vx;
    f.vx *= 0.82;
    f.vy += GRAVITY;
    f.y += f.vy;
    if(f.y >= GROUND_Y){ f.y = GROUND_Y; f.vy = 0; f.onGround = true; }
    f.x = clamp(f.x, FIGHTER_W, W - FIGHTER_W);
    f.facing = facingTarget(f, foe);

    // attack state machine
    if(f.attack){
      f.attack.timer--;
      if(f.attack.timer <= 0){
        if(f.attack.phase === 'windup'){
          f.attack.phase = 'active';
          f.attack.timer = SLASH_ACTIVE;
          slashArcs.push({ x: f.x, y: f.y, facing: f.facing, life: 1, color: f.color });
        } else if(f.attack.phase === 'active'){
          f.attack.phase = 'recover';
          f.attack.timer = SLASH_RECOVER;
        } else {
          f.attack = null;
        }
      }
      if(f.attack && f.attack.phase === 'active' && !f.attack.hasHit){
        const dx = (foe.x - f.x) * f.facing;
        const dy = Math.abs(foe.y - f.y);
        if(dx > 0 && dx < REACH && dy < 60){
          f.attack.hasHit = true;
          resolveHit(f, foe);
        }
      }
    }
  }

  /* ---------------- bot ---------------- */
  function botInput(){
    const cfg = DIFFS[difficulty];
    const dist = Math.abs(p1.x - p2.x);
    const input = { left:false, right:false, jump:false, slash:false, guardDown:false };

    botTimer--;
    if(botTimer <= 0){
      botTimer = Math.round(6 + (1 - cfg.react) * 22);
      const r = Math.random();
      // React to a telegraphed slash: guard (which may parry) or back off.
      if(p1.attack && p1.attack.phase === 'windup' && dist < REACH + 26 && r < cfg.guard){
        botPlan = 'guard';
      } else if(p2.counterWindow > 0){
        botPlan = 'attack';
      } else if(p1.stagger > 0 && dist < REACH + 30){
        botPlan = 'attack';
      } else if(dist > cfg.spacing + 26){
        botPlan = 'approach';
      } else if(dist < cfg.spacing - 24){
        botPlan = 'retreat';
      } else {
        botPlan = r < cfg.aggression*0.5 ? 'attack' : 'approach';
      }
    }

    const toward = p1.x < p2.x ? -1 : 1;
    if(botPlan === 'approach'){
      if(toward < 0) input.left = true; else input.right = true;
    } else if(botPlan === 'retreat'){
      if(toward < 0) input.right = true; else input.left = true;
    } else if(botPlan === 'guard'){
      input.guardDown = true;
    } else if(botPlan === 'attack'){
      if(dist > REACH){ if(toward < 0) input.left = true; else input.right = true; }
      else if(p2.stam >= SLASH_COST || p2.counterWindow > 0) input.slash = true;
    }
    return input;
  }

  function readInputs(){
    const i1 = {
      left: keys.has('a'),
      right: keys.has('d'),
      jump: keys.has('w'),
      slash: keys.has('s'),
      guardDown: keys.has('space')
    };
    let i2;
    if(mode === 'multi'){
      i2 = {
        left: keys.has('arrowleft'),
        right: keys.has('arrowright'),
        jump: keys.has('arrowup'),
        slash: keys.has('arrowdown'),
        guardDown: keys.has('enter')
      };
    } else {
      i2 = botInput();
    }
    return [i1, i2];
  }

  /* ---------------- round flow ---------------- */
  function endRound(p1Won){
    roundState = 'over';
    roundTimer = 80;
    if(p1Won) roundWins++; else oppWins++;
    updateHud();
    showBanner(p1Won ? 'ROUND WON' : 'ROUND LOST');
    Sfx.play(p1Won ? 'win' : 'lose');
  }

  function matchOver(){
    running = false;
    const won = roundWins >= ROUNDS_TO_WIN;
    updateStat('samurai', [{stat: won ? 'wins' : 'losses', type:'increment', value:1}]);
    zipReactToScore('samurai', 'wins', roundWins);
    earnTokens(won ? 'samurai_win' : 'samurai_loss', 1);
    showZipCompanion(won ? 'win' : 'loss');
    document.getElementById('samurai-result-text').textContent = won ? 'THE DUEL IS YOURS' : 'DEFEATED';
    document.getElementById('samurai-result-sub').textContent =
      'Final rounds ' + roundWins + ' : ' + oppWins +
      (mode === 'single' ? ' on ' + DIFFS[difficulty].label + '.' : ' in local multiplayer.');
    document.getElementById('samurai-play').classList.add('hidden');
    document.getElementById('samurai-result').classList.remove('hidden');
    document.getElementById('samurai-banner').classList.add('hidden');
  }

  function update(){
    frame++;
    if(shake > 0) shake = Math.max(0, shake - 0.9);

    for(let i=sparks.length-1;i>=0;i--){
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vy += 0.28; s.life -= 0.035;
      if(s.life <= 0) sparks.splice(i,1);
    }
    for(let i=slashArcs.length-1;i>=0;i--){
      slashArcs[i].life -= 0.09;
      if(slashArcs[i].life <= 0) slashArcs.splice(i,1);
    }

    if(roundState === 'intro'){
      roundTimer--;
      if(roundTimer === 40) showBanner('FIGHT!');
      if(roundTimer <= 0){ roundState = 'fight'; hideBanner(); }
      return;
    }
    if(roundState === 'over'){
      roundTimer--;
      if(roundTimer <= 0){
        if(roundWins >= ROUNDS_TO_WIN || oppWins >= ROUNDS_TO_WIN){ matchOver(); return; }
        freshRound();
      }
      return;
    }

    const [i1, i2] = readInputs();
    stepFighter(p1, p2, i1);
    stepFighter(p2, p1, i2);

    // keep the two from occupying the same space
    const gap = Math.abs(p1.x - p2.x);
    if(gap < FIGHTER_W){
      const push = (FIGHTER_W - gap) / 2;
      const dir = p1.x < p2.x ? -1 : 1;
      p1.x += dir * push;
      p2.x -= dir * push;
    }

    updateHud();
    if(p1.hp <= 0 || p2.hp <= 0) endRound(p2.hp <= 0);
  }

  /* ---------------- render ---------------- */
  function drawFighter(f, isP1){
    const bodyH = FIGHTER_H;
    const x = f.x, y = f.y;
    ctx.save();

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(x, GROUND_Y + 6, 22, 6, 0, 0, Math.PI*2);
    ctx.fill();

    const flash = f.hitFlash > 0 && f.hitFlash % 4 < 2;
    const body = flash ? '#ffffff' : f.color;

    // guard aura
    if(f.guarding){
      ctx.strokeStyle = 'rgba(159,184,255,0.85)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#9fb8ff';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(x + f.facing*12, y - bodyH*0.55, 34, -Math.PI/2, Math.PI/2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if(f.counterWindow > 0){
      ctx.strokeStyle = 'rgba(255,210,63,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4,4]);
      ctx.beginPath();
      ctx.arc(x, y - bodyH*0.5, 40, 0, Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // legs
    ctx.strokeStyle = body;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    const stride = f.onGround ? Math.sin(frame*0.25) * (Math.abs(f.vx) > 0.6 ? 9 : 0) : 6;
    ctx.beginPath();
    ctx.moveTo(x, y - bodyH*0.42);
    ctx.lineTo(x - stride, y);
    ctx.moveTo(x, y - bodyH*0.42);
    ctx.lineTo(x + stride, y);
    ctx.stroke();

    // torso
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(x, y - bodyH*0.42);
    ctx.lineTo(x, y - bodyH*0.82);
    ctx.stroke();

    // head
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y - bodyH*0.94, 11, 0, Math.PI*2);
    ctx.fill();
    // helmet crest
    ctx.strokeStyle = isP1 ? '#cfe0ff' : '#ffc0c0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - bodyH*1.02);
    ctx.quadraticCurveTo(x, y - bodyH*1.18, x + 10, y - bodyH*1.02);
    ctx.stroke();

    // sword — angle depends on what the fighter is doing
    let swordAngle = -0.5;
    if(f.stagger > 0) swordAngle = 1.2;
    else if(f.guarding) swordAngle = -1.5;
    else if(f.attack){
      if(f.attack.phase === 'windup') swordAngle = -2.1;
      else if(f.attack.phase === 'active') swordAngle = 0.45;
      else swordAngle = 0.9;
    }
    ctx.save();
    ctx.translate(x + f.facing*10, y - bodyH*0.66);
    ctx.rotate(swordAngle * f.facing);
    ctx.strokeStyle = f.attack && f.attack.phase === 'active' ? '#ffffff' : '#d7dee8';
    ctx.lineWidth = 4;
    ctx.shadowColor = f.attack && f.attack.phase === 'active' ? '#ffffff' : 'transparent';
    ctx.shadowBlur = f.attack && f.attack.phase === 'active' ? 14 : 0;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(f.facing * 54, 0);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  function render(){
    ctx.save();
    if(settings.shake && shake > 0){
      ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
    }

    // dojo backdrop
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1a0d14');
    sky.addColorStop(0.55, '#2a1119');
    sky.addColorStop(1, '#0a0608');
    ctx.fillStyle = sky;
    ctx.fillRect(-30, -30, W+60, H+60);

    // big red sun
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ff4d4d';
    ctx.shadowColor = '#ff4d4d';
    ctx.shadowBlur = 60;
    ctx.beginPath();
    ctx.arc(W*0.5, H*0.32, 84, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // bamboo silhouettes
    ctx.strokeStyle = 'rgba(10,6,8,0.85)';
    ctx.lineWidth = 9;
    for(let i=0;i<9;i++){
      const bx = 40 + i*95 + Math.sin(i*1.7)*14;
      ctx.beginPath();
      ctx.moveTo(bx, GROUND_Y);
      ctx.lineTo(bx + Math.sin(i)*10, H*0.16);
      ctx.stroke();
    }

    // ground
    ctx.fillStyle = '#140a0e';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = 'rgba(255,77,77,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.stroke();

    // slash arcs
    slashArcs.forEach(a=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, a.life);
      ctx.translate(a.x, a.y - FIGHTER_H*0.6);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5 * a.life;
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, REACH*0.8, a.facing > 0 ? -1.1 : Math.PI+1.1, a.facing > 0 ? 1.1 : Math.PI-1.1, a.facing < 0);
      ctx.stroke();
      ctx.restore();
    });

    drawFighter(p1, true);
    drawFighter(p2, false);

    sparks.forEach(s=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.6, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });

    ctx.restore();

    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('FIRST TO ' + ROUNDS_TO_WIN + ' ROUNDS' + (mode==='single' ? ' · ' + DIFFS[difficulty].label : ''), 14, H-14);
    if(p1.guardBroken > 0){
      ctx.fillStyle = 'rgba(255,77,77,0.9)';
      ctx.fillText('GUARD BROKEN', 14, H-30);
    }
    ctx.restore();
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function onKeyPress(name){ /* handled through continuous key state in update() */ }

  function start(){
    document.getElementById('samurai-setup').classList.add('hidden');
    document.getElementById('samurai-result').classList.add('hidden');
    document.getElementById('samurai-play').classList.remove('hidden');
    freshState();
    paused = false;
    running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    setMode(mode);
    setDifficulty(difficulty);
    document.getElementById('samurai-setup').classList.remove('hidden');
    document.getElementById('samurai-play').classList.add('hidden');
    document.getElementById('samurai-result').classList.add('hidden');
    document.getElementById('samurai-banner').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  frame = 0;
  setMode(mode);
  setDifficulty(difficulty);
  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning, setMode, setDifficulty};
})();
