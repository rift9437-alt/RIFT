/* =========================================================
   GAME 5: WILD DUEL
   ========================================================= */
const WildDuelGame = (function(){
  const canvas = document.getElementById('wildduel-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const GROUND_Y = 440;
  const GRAVITY = 0.6;
  const JUMP_VY = -11;
  const BASE_MOVE_SPEED = 3.6;
  const PW = 22, PH = 46;
  const BULLET_SPEED = 10;
  const BULLET_RADIUS = 4;
  const BULLET_LIFE = 90;
  const BASE_SHOOT_COOLDOWN = 34;
  const HIT_INVULN = 30;
  const BASE_MAX_HP = 4;
  const SIMULTANEOUS_WINDOW = 8; // frames — shots this close count as a tie

  // Wild Duel upgrades boost Player 1 (whoever's logged in) only, in both
  // Single Player and Local Multiplayer — the bot / local Player 2 always
  // plays at base stats. Re-read from the wallet at the start of each duel.
  let p1MaxHp = BASE_MAX_HP;
  let p1MoveSpeed = BASE_MOVE_SPEED;
  let p1ShootCooldown = BASE_SHOOT_COOLDOWN;
  const p2MaxHp = BASE_MAX_HP;

  function applyUpgrades(){
    const up = (wallet && wallet.wildduelUpgrades) || {};
    p1MaxHp = BASE_MAX_HP + (up.extraHp || 0);
    p1MoveSpeed = BASE_MOVE_SPEED * (1 + 0.10 * (up.fasterMovement || 0));
    p1ShootCooldown = Math.round(BASE_SHOOT_COOLDOWN * (1 - 0.12 * (up.fasterReload || 0)));
  }

  const PLATFORM_SETS = {
    easy: [
      {x:140, y:350, w:150, h:18},
      {x:510, y:350, w:150, h:18}
    ],
    medium: [
      {x:100, y:370, w:130, h:16},
      {x:335, y:270, w:130, h:16},
      {x:570, y:370, w:130, h:16}
    ],
    hard: [
      {x:70,  y:382, w:110, h:16},
      {x:250, y:300, w:110, h:16},
      {x:440, y:300, w:110, h:16},
      {x:620, y:382, w:110, h:16},
      {x:345, y:205, w:110, h:16}
    ]
  };

  let mode = 'single';
  let difficulty = 'medium';
  let rafId = null;
  let running = false;
  let paused = false;

  let phase, drawFrame, signalFrame, p1ShotAt, p2ShotAt, resolveDeadline, botReactionFrame;
  let p1, p2, bullets, hp1, hp2, fightBannerTimer, fightBannerText, tooSoonTimer;
  let shotBullet, shotTimer, pendingBannerText;

  function platforms(){ return PLATFORM_SETS[difficulty] || PLATFORM_SETS.medium; }

  function setMode(m){
    mode = m;
    document.getElementById('wildduel-mode-single').classList.toggle('selected', m==='single');
    document.getElementById('wildduel-mode-multi').classList.toggle('selected', m==='multi');
    document.getElementById('wildduel-diff-section').classList.toggle('hidden', m!=='single');
  }
  function setDifficulty(d){
    difficulty = d;
    ['easy','medium','hard'].forEach(k=>{
      document.getElementById('wildduel-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  function botReactionDelay(){
    if(difficulty === 'easy') return 42 + Math.random()*34;
    if(difficulty === 'hard') return 5 + Math.random()*14;
    return 20 + Math.random()*22;
  }

  function freshDrawState(){
    applyUpgrades();
    phase = 'draw';
    drawFrame = 0;
    signalFrame = 70 + Math.floor(Math.random()*90);
    p1ShotAt = null; p2ShotAt = null;
    resolveDeadline = null;
    botReactionFrame = signalFrame + botReactionDelay();
    tooSoonTimer = 0;
    p1 = {x:150, y:GROUND_Y-PH, vx:0, vy:0, onGround:true, facing:1, cooldown:0, invuln:0, muzzle:0, hitFlash:0};
    p2 = {x:650, y:GROUND_Y-PH, vx:0, vy:0, onGround:true, facing:-1, cooldown:0, invuln:0, muzzle:0, hitFlash:0};
    bullets = [];
    shotBullet = null; shotTimer = 0;
    hp1 = p1MaxHp; hp2 = p2MaxHp;
    fightBannerTimer = 0; fightBannerText = '';
    updateHud();
    updateBanner('WAIT FOR IT...');
  }

  function updateHud(){
    const p1box = document.getElementById('wildduel-p1-hp');
    const p2box = document.getElementById('wildduel-p2-hp');
    let h1 = '', h2 = '';
    for(let i=0;i<p1MaxHp;i++) h1 += `<div class="hp-pip ${i<hp1?'full':''}"></div>`;
    for(let i=0;i<p2MaxHp;i++) h2 += `<div class="hp-pip ${i<hp2?'full p2':''}"></div>`;
    p1box.innerHTML = h1;
    p2box.innerHTML = h2;
    document.getElementById('wildduel-phase-label').textContent = phase === 'draw' ? 'QUICK DRAW' : (phase === 'shot' ? 'FIRST SHOT!' : 'FIGHT!');
  }

  function updateBanner(text){
    const b = document.getElementById('wildduel-banner');
    if(text){
      b.textContent = text;
      b.classList.remove('hidden');
    } else {
      b.classList.add('hidden');
    }
  }

  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('wildduel-setup').classList.remove('hidden');
    document.getElementById('wildduel-play').classList.add('hidden');
    document.getElementById('wildduel-result').classList.add('hidden');
    setMode(mode);
    setDifficulty(difficulty);
    renderWildDuelUpgrades();
  }

  function start(){
    document.getElementById('wildduel-setup').classList.add('hidden');
    document.getElementById('wildduel-result').classList.add('hidden');
    document.getElementById('wildduel-play').classList.remove('hidden');
    freshDrawState();
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
    if(phase === 'draw'){
      if(name === 's') registerShot(true);
      if(mode === 'multi' && name === 'arrowdown') registerShot(false);
      return;
    }
    if(phase === 'fight'){
      if(name === 'w' && p1.onGround){ p1.vy = JUMP_VY; p1.onGround = false; }
      if(name === 's') fireBullet(p1, true);
      if(mode === 'multi'){
        if(name === 'arrowup' && p2.onGround){ p2.vy = JUMP_VY; p2.onGround = false; }
        if(name === 'arrowdown') fireBullet(p2, false);
      }
    }
  }

  function registerShot(isP1){
    if(phase !== 'draw') return;
    if(isP1 ? p1ShotAt !== null : p2ShotAt !== null) return;
    if(drawFrame < signalFrame){
      tooSoonTimer = 40;
      updateBanner('TOO SOON!');
      return;
    }
    if(isP1) p1ShotAt = drawFrame; else p2ShotAt = drawFrame;
    if(resolveDeadline === null) resolveDeadline = drawFrame + 20;
  }

  function resolveDraw(){
    let winnerText, winner;
    if(p1ShotAt !== null && p2ShotAt !== null){
      const diff = Math.abs(p1ShotAt - p2ShotAt);
      if(diff <= SIMULTANEOUS_WINDOW){
        hp1 = p1MaxHp; hp2 = p2MaxHp;
        winnerText = 'DEAD EVEN — FULL HEALTH!';
        winner = null;
      } else if(p1ShotAt < p2ShotAt){
        hp1 = p1MaxHp; hp2 = p2MaxHp - 1;
        winnerText = 'PLAYER 1 DRAWS FIRST!';
        winner = 'p1';
      } else {
        hp2 = p2MaxHp; hp1 = p1MaxHp - 1;
        winnerText = (mode==='single' ? 'BOT' : 'PLAYER 2') + ' DRAWS FIRST!';
        winner = 'p2';
      }
    } else if(p1ShotAt !== null){
      hp1 = p1MaxHp; hp2 = p2MaxHp - 1;
      winnerText = 'PLAYER 1 DRAWS FIRST!';
      winner = 'p1';
    } else {
      hp2 = p2MaxHp; hp1 = p1MaxHp - 1;
      winnerText = (mode==='single' ? 'BOT' : 'PLAYER 2') + ' DRAWS FIRST!';
      winner = 'p2';
    }
    beginShotAnimation(winner, winnerText);
  }

  // The winner of the quick-draw actually fires a real bullet across the
  // stand-off before the fight begins — the draw isn't just a number
  // comparison, it's a shot that visibly travels and lands.
  function beginShotAnimation(winner, bannerText){
    pendingBannerText = bannerText;
    if(!winner){
      // dead-even tie: nobody gets a clean shot off, go straight to the fight.
      updateHud();
      startFight(bannerText);
      return;
    }
    phase = 'shot';
    updateBanner(null);
    const shooter = winner === 'p1' ? p1 : p2;
    const target  = winner === 'p1' ? p2 : p1;
    shooter.facing = winner === 'p1' ? 1 : -1;
    target.facing  = winner === 'p1' ? -1 : 1;
    shooter.muzzle = 8;
    shotBullet = {
      x: shooter.x + (shooter.facing>0 ? PW+2 : -2),
      y: shooter.y + PH*0.42,
      vx: BULLET_SPEED * shooter.facing,
      target
    };
    shotTimer = 0;
  }

  function startFight(bannerText){
    phase = 'fight';
    const plats = platforms();
    p1 = {x:90, y:GROUND_Y-PH, vx:0, vy:0, onGround:true, facing:1, cooldown:0, invuln:0, muzzle:0, hitFlash:0};
    p2 = {x:W-90-PW, y:GROUND_Y-PH, vx:0, vy:0, onGround:true, facing:-1, cooldown:0, invuln:0, muzzle:0, hitFlash:0};
    bullets = [];
    shotBullet = null;
    fightBannerTimer = 90;
    fightBannerText = bannerText + '  FIGHT!';
    updateHud();
    updateBanner(fightBannerText);
  }

  function fireBullet(p, isP1){
    if(p.cooldown > 0) return;
    p.cooldown = isP1 ? p1ShootCooldown : BASE_SHOOT_COOLDOWN;
    p.muzzle = 8;
    bullets.push({
      x: p.x + (p.facing>0 ? PW+2 : -2),
      y: p.y + PH*0.42,
      vx: BULLET_SPEED * p.facing,
      owner: isP1 ? 'p1' : 'p2',
      life: BULLET_LIFE
    });
  }

  function rectsOverlap(ax,ay,aw,ah, bx,by,bw,bh){
    return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
  }

  function applyPhysics(p){
    p.x = clamp(p.x + p.vx, 10, W-10-PW);
    const prevBottom = p.y + PH;
    p.vy += GRAVITY;
    p.y += p.vy;
    let landed = false;
    if(p.y + PH >= GROUND_Y){
      p.y = GROUND_Y - PH;
      p.vy = 0;
      landed = true;
    }
    if(!landed && p.vy > 0){
      for(const plat of platforms()){
        const newBottom = p.y + PH;
        const withinX = p.x + PW > plat.x && p.x < plat.x + plat.w;
        if(withinX && prevBottom <= plat.y + 2 && newBottom >= plat.y){
          p.y = plat.y - PH;
          p.vy = 0;
          landed = true;
          break;
        }
      }
    }
    p.onGround = landed;
    if(p.cooldown > 0) p.cooldown--;
    if(p.invuln > 0) p.invuln--;
    if(p.muzzle > 0) p.muzzle--;
    if(p.hitFlash > 0) p.hitFlash--;
  }

  function p1Input(){
    if(keys.has('a')){ p1.facing = -1; return -p1MoveSpeed; }
    if(keys.has('d')){ p1.facing = 1; return p1MoveSpeed; }
    return 0;
  }
  function p2Input(){
    if(keys.has('arrowleft')){ p2.facing = -1; return -BASE_MOVE_SPEED; }
    if(keys.has('arrowright')){ p2.facing = 1; return BASE_MOVE_SPEED; }
    return 0;
  }

  function botFightUpdate(){
    let speed, jumpChance, shootChance, accuracyRange;
    if(difficulty === 'easy'){ speed=2.0; jumpChance=0.010; shootChance=0.10; accuracyRange=130; }
    else if(difficulty === 'hard'){ speed=3.2; jumpChance=0.035; shootChance=0.26; accuracyRange=90; }
    else { speed=2.6; jumpChance=0.020; shootChance=0.17; accuracyRange=110; }

    const dx = p1.x - p2.x;
    if(Math.abs(dx) > 14){
      p2.vx = dx > 0 ? speed : -speed;
      p2.facing = dx > 0 ? 1 : -1;
    } else {
      p2.vx = 0;
    }

    if(p2.onGround && Math.random() < jumpChance){
      // jump more readily if the player is above us, otherwise just occasionally hop
      const playerAbove = p1.y < p2.y - 16;
      if(playerAbove || Math.random() < 0.5){ p2.vy = JUMP_VY; p2.onGround = false; }
    }

    const distX = Math.abs(dx);
    const distY = Math.abs(p1.y - p2.y);
    if(distX < accuracyRange && distY < 50 && Math.random() < shootChance){
      fireBullet(p2, false);
    }
  }

  function updateBullets(){
    for(let i=bullets.length-1; i>=0; i--){
      const b = bullets[i];
      b.x += b.vx; b.life--;
      let remove = (b.x < 0 || b.x > W || b.life <= 0);
      if(!remove){
        for(const plat of platforms()){
          if(b.x > plat.x && b.x < plat.x+plat.w && b.y > plat.y && b.y < plat.y+plat.h){ remove = true; break; }
        }
      }
      if(!remove){
        const target = b.owner === 'p1' ? p2 : p1;
        if(target.invuln <= 0 && b.x > target.x && b.x < target.x+PW && b.y > target.y && b.y < target.y+PH){
          remove = true;
          target.invuln = HIT_INVULN;
          target.hitFlash = 16;
          if(b.owner === 'p1'){ hp2--; } else { hp1--; }
          updateHud();
          if(hp1 <= 0 || hp2 <= 0){
            endMatch(hp2 <= 0);
            return;
          }
        }
      }
      if(remove) bullets.splice(i,1);
    }
  }

  function endMatch(p1Won){
    running = false;
    updateStat('wildduel', [{stat:'wins', type:'increment_if', value:1, cond:p1Won}]);
    showZipCompanion(p1Won ? 'win' : 'loss');
    earnTokens(p1Won ? 'wildduel_win' : 'wildduel_loss', 1);
    document.getElementById('wildduel-result-text').textContent = p1Won ? 'YOU WIN THE DUEL!' : (mode==='single' ? 'BOT WINS THE DUEL' : 'PLAYER 2 WINS THE DUEL');
    document.getElementById('wildduel-result-sub').textContent = 'Final HP ' + Math.max(hp1,0) + ' : ' + Math.max(hp2,0) + '.';
    document.getElementById('wildduel-play').classList.add('hidden');
    document.getElementById('wildduel-result').classList.remove('hidden');
    updateBanner(null);
  }

  function update(){
    if(phase === 'draw'){
      drawFrame++;
      if(tooSoonTimer > 0){
        tooSoonTimer--;
        if(tooSoonTimer === 0) updateBanner(drawFrame >= signalFrame ? 'DRAW!!' : 'WAIT FOR IT...');
      } else if(drawFrame === signalFrame){
        updateBanner('DRAW!!');
      }
      if(mode === 'single' && drawFrame >= signalFrame && drawFrame >= botReactionFrame){
        registerShot(false);
      }
      if(resolveDeadline !== null && drawFrame >= resolveDeadline){
        resolveDraw();
      } else if(p1ShotAt !== null && p2ShotAt !== null){
        resolveDraw();
      }
      return;
    }

    if(phase === 'shot'){
      shotTimer++;
      if(p1.muzzle > 0) p1.muzzle--;
      if(p2.muzzle > 0) p2.muzzle--;
      if(shotBullet){
        shotBullet.x += shotBullet.vx;
        const t = shotBullet.target;
        if(shotBullet.x > t.x && shotBullet.x < t.x+PW){
          t.hitFlash = 18;
          updateHud();
          shotBullet = null;
        }
      }
      if(shotTimer > 75) startFight(pendingBannerText);
      return;
    }

    // fight phase
    if(fightBannerTimer > 0){
      fightBannerTimer--;
      if(fightBannerTimer === 0) updateBanner(null);
    }

    applyPhysics(Object.assign(p1, {vx: p1Input()}));
    if(mode === 'multi'){
      applyPhysics(Object.assign(p2, {vx: p2Input()}));
    } else {
      botFightUpdate();
      applyPhysics(p2);
    }

    updateBullets();
  }

  function drawBackground(){
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0, '#3a2a1f');
    grad.addColorStop(1, '#1a1209');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(0,GROUND_Y); ctx.lineTo(W,GROUND_Y); ctx.stroke();
    ctx.fillStyle = '#241a10';
    ctx.fillRect(0, GROUND_Y, W, H-GROUND_Y);
  }

  function drawPlatforms(){
    ctx.fillStyle = '#5a4530';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    platforms().forEach(p=>{
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    });
  }

  function drawPlayer(p, isP1, label){
    const img = SPRITES[isP1 ? 'cowboyRed' : 'cowboyBlue'];
    const footX = p.x + PW/2, footY = p.y + PH;
    const drawn = drawFacingSprite(ctx, img, footX, footY, p.facing, 1.5, 7, 3, 7, 6.4);
    if(!drawn){
      ctx.fillStyle = isP1 ? '#ff3d8a' : '#2de2c5';
      ctx.fillRect(p.x, p.y, PW, PH);
    }

    // Held gun, anchored at hand height. The sprite's art is drawn barrel-left,
    // grip-right (the mirror of the body sprite's facing-right convention), so
    // we anchor on the grip and flip the opposite way to point the muzzle
    // out in front of the player instead of back into their own hand.
    const gunImg = SPRITES.cowboyGun;
    const handX = footX + p.facing*9;
    const handY = footY - PH*0.56;
    drawFacingSprite(ctx, gunImg, handX, handY, -p.facing, 3, 1, 4, 2, 4.2);
    if(p.muzzle > 0){
      ctx.fillStyle = 'rgba(255,220,120,0.9)';
      ctx.beginPath();
      ctx.arc(handX + p.facing*15, handY, 5, 0, Math.PI*2);
      ctx.fill();
    }

    if(p.hitFlash > 0){
      ctx.fillStyle = 'rgba(255,40,40,' + (p.hitFlash/18*0.55) + ')';
      ctx.fillRect(p.x-2, p.y-2, PW+4, PH+4);
    }
    if(p.invuln > 0 && Math.floor(p.invuln/4)%2===0){
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(p.x, p.y, PW, PH);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, p.x+PW/2, p.y-6);
  }

  function render(){
    drawBackground();
    if(phase === 'fight'){
      drawPlatforms();
      drawPlayer(p1, true, 'P1');
      drawPlayer(p2, false, mode==='single' ? 'BOT' : 'P2');
      ctx.fillStyle = '#ffe27a';
      bullets.forEach(b=>{
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI*2);
        ctx.fill();
      });
    } else {
      drawPlayer(p1, true, 'P1');
      drawPlayer(p2, false, mode==='single' ? 'BOT' : 'P2');
      if(phase === 'shot' && shotBullet){
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath();
        ctx.arc(shotBullet.x, shotBullet.y, BULLET_RADIUS, 0, Math.PI*2);
        ctx.fill();
      }
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
