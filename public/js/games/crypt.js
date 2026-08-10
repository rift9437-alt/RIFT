/* =========================================================
   GAME 8: CRYPT CRAWLER
   ========================================================= */
const RoguelikeGame = (function(){
  const canvas = document.getElementById('roguelike-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const WALL = 20;

  const PLAYER_RADIUS = 14;
  const BASE_SPEED = 2.6;
  const BASE_MAX_HP = 5;
  const BASE_SWORD_DMG = 2;
  const SWORD_RANGE = 50;
  const SWORD_ARC = 0.62; // half-angle (radians) of the swing cone
  const SWORD_COOLDOWN = 26;
  const SWORD_SWING_FRAMES = 10;
  const BASE_MAGIC_DMG = 3;
  const BASE_MAGIC_COOLDOWN = 55;
  const MAGIC_SPEED = 6.5;
  const MAGIC_LIFE = 70;
  const INVULN_FRAMES = 40;
  const LOOT_RADIUS = 12;

  const ENEMY_BASE = {
    slime:    { hp: 3, speed: 1.3, dmg: 1, radius: 14, color: '#45ffb0' },
    skeleton: { hp: 5, speed: 1.7, dmg: 1, radius: 15, color: '#e8ecf1' },
    mage:     { hp: 3, speed: 1.0, dmg: 1, radius: 13, color: '#c9a6ff', ranged: true, atkCooldownMax: 95, boltSpeed: 3.4 },
    bat:      { hp: 2, speed: 2.6, dmg: 1, radius: 10, color: '#ff8a5c', erratic: true, knockback: 6 },
    brute:    { hp: 9, speed: 0.9, dmg: 2, radius: 19, color: '#c97b3f', knockback: 20 },
  };
  const ELITE_HP_MULT = 2.2;
  const ELITE_DMG_MULT = 1.5;
  const ELITE_RADIUS_BONUS = 3;

  let rafId = null;
  let running = false;
  let paused = false;

  // Upgrade levels, re-read from the wallet at the start of each run.
  let maxHp = BASE_MAX_HP;
  let swordDmgMult = 1;
  let magicDmgMult = 1;
  let magicCooldownMult = 1;
  let speedMult = 1;

  // Equipment rune pickups — temporary buffs found during a run, on top of
  // permanent upgrades. Reset every new run, persist for the whole run once
  // found (not just the current floor).
  let runBuffs = { sword: 0, magicCooldown: 0, speed: 0 };

  function applyUpgrades(){
    const up = (wallet && wallet.roguelikeUpgrades) || {};
    maxHp = BASE_MAX_HP + (up.extraHp || 0);
    swordDmgMult = 1 + 0.2 * (up.swordDamage || 0);
    magicDmgMult = 1 + 0.2 * (up.magicPower || 0);
    magicCooldownMult = 1 - 0.1 * (up.magicPower || 0);
    speedMult = 1 + 0.1 * (up.swiftBoots || 0);
  }

  let player, floorNum, kills, lootCollected, obstacles, enemies, lootItems, stairs, floorCleared;
  let swordBolts, magicBolts, enemyBolts, swordSwingTimer, frameCount;

  function collidesObstacles(x, y, r){
    if(x - r < WALL || x + r > W - WALL || y - r < WALL || y + r > H - WALL) return true;
    for(const o of obstacles){
      if(x + r > o.x && x - r < o.x + o.w && y + r > o.y && y - r < o.y + o.h) return true;
    }
    return false;
  }

  function moveEntity(e, dx, dy, radius){
    const nx = e.x + dx, ny = e.y + dy;
    if(!collidesObstacles(nx, ny, radius)){ e.x = nx; e.y = ny; return; }
    if(!collidesObstacles(e.x + dx, e.y, radius)){ e.x += dx; return; }
    if(!collidesObstacles(e.x, e.y + dy, radius)){ e.y += dy; return; }
  }

  function buildObstacles(){
    const arr = [];
    const count = 2 + Math.floor(Math.random() * 3);
    for(let i=0;i<count;i++){
      const w = 50 + Math.random()*60, h = 40 + Math.random()*50;
      const x = WALL + 40 + Math.random() * (W - WALL*2 - 80 - w);
      const y = WALL + 40 + Math.random() * (H - WALL*2 - 140 - h);
      arr.push({x, y, w, h});
    }
    return arr;
  }

  function randomClearSpot(minDistFromPlayerStart){
    for(let tries=0; tries<40; tries++){
      const x = WALL + 30 + Math.random() * (W - WALL*2 - 60);
      const y = WALL + 30 + Math.random() * (H - WALL*2 - 60);
      if(collidesObstacles(x, y, 20)) continue;
      if(minDistFromPlayerStart && Math.hypot(x - W/2, y - (H-50)) < minDistFromPlayerStart) continue;
      return {x, y};
    }
    return { x: W/2, y: H/2 };
  }

  function makeEnemy(type, forceElite){
    const base = ENEMY_BASE[type];
    const spot = randomClearSpot(160);
    const scale = 1 + floorNum * 0.14;
    const eliteChance = forceElite ? 1 : clamp(0.04 + floorNum * 0.015, 0, 0.35);
    const isElite = Math.random() < eliteChance;
    let hp = Math.round(base.hp * scale);
    let dmg = base.dmg;
    let radius = base.radius;
    if(isElite){
      hp = Math.round(hp * ELITE_HP_MULT);
      dmg = Math.round(dmg * ELITE_DMG_MULT);
      radius = radius + ELITE_RADIUS_BONUS;
    }
    return {
      type,
      x: spot.x, y: spot.y,
      hp, maxHp: hp,
      speed: base.speed,
      dmg,
      radius,
      color: base.color,
      ranged: !!base.ranged,
      atkCooldown: base.atkCooldownMax || 0,
      atkCooldownMax: base.atkCooldownMax || 0,
      boltSpeed: base.boltSpeed || 0,
      erratic: !!base.erratic,
      knockback: base.knockback || 8,
      wobbleSeed: Math.random() * 1000,
      isElite,
      isBoss: false,
      hitFlash: 0
    };
  }

  function makeBoss(){
    const spot = randomClearSpot(200);
    const scale = 1 + floorNum * 0.12;
    return {
      type: 'boss',
      x: spot.x, y: spot.y,
      hp: Math.round(28 * scale),
      maxHp: Math.round(28 * scale),
      speed: 1.15,
      dmg: 2,
      radius: 27,
      color: '#ff5454',
      ranged: true,
      atkCooldown: 100,
      atkCooldownMax: 100,
      boltSpeed: 3.8,
      knockback: 14,
      isBoss: true,
      hitFlash: 0
    };
  }

  function spawnEnemies(){
    const arr = [];
    const isBossFloor = floorNum % 5 === 0;
    if(isBossFloor){
      arr.push(makeBoss());
      const minions = Math.min(2, Math.floor(floorNum / 10));
      for(let i=0;i<minions;i++) arr.push(makeEnemy(Math.random()<0.5 ? 'slime' : 'skeleton'));
    } else {
      const count = clamp(2 + Math.floor(floorNum / 2), 2, 8);
      const types = floorNum >= 3 ? ['slime','skeleton','mage','bat','brute'] : ['slime','skeleton','mage'];
      for(let i=0;i<count;i++) arr.push(makeEnemy(types[Math.floor(Math.random()*types.length)]));
    }
    return arr;
  }

  const EQUIPMENT_RUNES = ['sword', 'magicCooldown', 'speed'];

  function rollLootKind(){
    const r = Math.random();
    if(r < 0.42) return 'coin';
    if(r < 0.72) return 'potion';
    if(r < 0.90) return 'rare';
    return 'equipment';
  }

  function spawnLoot(){
    const arr = [];
    const count = 1 + Math.floor(Math.random()*2);
    for(let i=0;i<count;i++){
      const spot = randomClearSpot(0);
      const item = { x: spot.x, y: spot.y, kind: rollLootKind() };
      if(item.kind === 'equipment') item.rune = EQUIPMENT_RUNES[Math.floor(Math.random()*EQUIPMENT_RUNES.length)];
      arr.push(item);
    }
    return arr;
  }

  function generateFloor(n){
    floorNum = n;
    obstacles = buildObstacles();
    enemies = spawnEnemies();
    lootItems = spawnLoot();
    stairs = null;
    floorCleared = false;
    player.x = W/2;
    player.y = H - 50;
    swordBolts = [];
  }

  function updateHud(){
    document.getElementById('roguelike-floor').textContent = floorNum;
    document.getElementById('roguelike-kills').textContent = kills;
    const hearts = Math.ceil(player.hp);
    document.getElementById('roguelike-hp-hud').textContent = '❤️'.repeat(Math.max(hearts,0)) + '🖤'.repeat(Math.max(maxHp-hearts,0));

    const bossBar = document.getElementById('roguelike-boss-bar');
    const boss = enemies.find(e => e.isBoss && !e.dead);
    if(boss){
      bossBar.classList.remove('hidden');
      document.getElementById('roguelike-boss-hp-text').textContent = `${Math.max(0,boss.hp)}/${boss.maxHp}`;
      document.getElementById('roguelike-boss-hp-fill').style.width = (clamp(boss.hp/boss.maxHp,0,1) * 100) + '%';
    } else {
      bossBar.classList.add('hidden');
    }
  }

  function freshState(){
    applyUpgrades();
    runBuffs = { sword: 0, magicCooldown: 0, speed: 0 };
    frameCount = 0;
    player = {
      x: W/2, y: H-50,
      hp: maxHp,
      facingX: 0, facingY: -1,
      swordCooldown: 0,
      magicCooldown: 0,
      invuln: 0
    };
    floorNum = 1;
    kills = 0;
    lootCollected = 0;
    magicBolts = [];
    enemyBolts = [];
    swordSwingTimer = 0;
    generateFloor(1);
    updateHud();
  }

  function playerInput(){
    let dx = 0, dy = 0;
    if(keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if(keys.has('d') || keys.has('arrowright')) dx += 1;
    if(keys.has('w') || keys.has('arrowup')) dy -= 1;
    if(keys.has('s') || keys.has('arrowdown')) dy += 1;
    if(dx !== 0 && dy !== 0){ dx *= 0.7071; dy *= 0.7071; }
    return { dx, dy };
  }

  function trySwordSwing(){
    if(player.swordCooldown > 0) return;
    player.swordCooldown = SWORD_COOLDOWN;
    swordSwingTimer = SWORD_SWING_FRAMES;
    const dmg = BASE_SWORD_DMG * swordDmgMult * (1 + runBuffs.sword);
    enemies.forEach(e=>{
      const ex = e.x - player.x, ey = e.y - player.y;
      const dist = Math.hypot(ex, ey);
      if(dist > SWORD_RANGE + e.radius) return;
      const ang = Math.atan2(ey, ex) - Math.atan2(player.facingY, player.facingX);
      let a = Math.atan2(Math.sin(ang), Math.cos(ang));
      if(Math.abs(a) <= SWORD_ARC) hitEnemy(e, dmg, player.x, player.y, 16);
    });
  }

  function tryMagicBolt(){
    if(player.magicCooldown > 0) return;
    player.magicCooldown = BASE_MAGIC_COOLDOWN * magicCooldownMult * (1 - runBuffs.magicCooldown);
    magicBolts.push({
      x: player.x, y: player.y,
      vx: player.facingX * MAGIC_SPEED,
      vy: player.facingY * MAGIC_SPEED,
      life: MAGIC_LIFE
    });
  }

  function hitEnemy(e, dmg, fromX, fromY, force){
    e.hp -= dmg;
    e.hitFlash = 8;
    if(fromX !== undefined && force){
      const kx = e.x - fromX, ky = e.y - fromY;
      const klen = Math.hypot(kx, ky) || 1;
      moveEntity(e, (kx/klen) * force, (ky/klen) * force, e.radius);
    }
    if(e.hp <= 0){
      e.dead = true;
      kills++;
      if(e.isElite){
        const spot = { x: e.x, y: e.y };
        const item = { x: spot.x, y: spot.y, kind: Math.random() < 0.5 ? 'rare' : 'equipment' };
        if(item.kind === 'equipment') item.rune = EQUIPMENT_RUNES[Math.floor(Math.random()*EQUIPMENT_RUNES.length)];
        lootItems.push(item);
      } else if(Math.random() < 0.35){
        lootItems.push({ x: e.x, y: e.y, kind: rollLootKind() === 'coin' ? 'coin' : 'potion' });
      }
    }
    if(e.isBoss) updateHud();
  }

  function damagePlayer(amount, knockX, knockY, knockForce){
    if(player.invuln > 0) return;
    player.hp -= amount;
    player.invuln = INVULN_FRAMES;
    if(knockX !== undefined && knockForce){
      moveEntity(player, knockX*knockForce, knockY*knockForce, PLAYER_RADIUS);
    }
    updateHud();
    if(player.hp <= 0) gameOver();
  }

  function gameOver(){
    running = false;
    updateStat('roguelike', [{stat:'deepestFloor', type:'max', value:floorNum}]);
    zipReactToScore('roguelike', 'deepestFloor', floorNum);
    if(kills > 0) earnTokens('roguelike_kill', kills);
    if(floorNum > 1) earnTokens('roguelike_floor', floorNum - 1);
    if(lootCollected > 0) earnTokens('roguelike_loot', lootCollected);
    document.getElementById('roguelike-result-text').textContent = 'YOU DIED';
    document.getElementById('roguelike-result-sub').textContent =
      `Reached floor ${floorNum} with ${kills} kill${kills===1?'':'s'} and ${lootCollected} loot pickup${lootCollected===1?'':'s'}.`;
    document.getElementById('roguelike-play').classList.add('hidden');
    document.getElementById('roguelike-result').classList.remove('hidden');
  }

  function update(){
    if(player.swordCooldown > 0) player.swordCooldown--;
    if(player.magicCooldown > 0) player.magicCooldown--;
    if(player.invuln > 0) player.invuln--;
    if(swordSwingTimer > 0) swordSwingTimer--;

    const { dx, dy } = playerInput();
    if(dx !== 0 || dy !== 0){
      player.facingX = dx; player.facingY = dy;
      const effSpeed = BASE_SPEED * speedMult * (1 + runBuffs.speed);
      moveEntity(player, dx*effSpeed, dy*effSpeed, PLAYER_RADIUS);
    }
    if(keys.has('space')) trySwordSwing();
    if(keys.has('shift')) tryMagicBolt();

    // magic bolts
    for(let i=magicBolts.length-1; i>=0; i--){
      const b = magicBolts[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      let removed = false;
      if(b.life <= 0 || collidesObstacles(b.x, b.y, 4)){ magicBolts.splice(i,1); continue; }
      for(const e of enemies){
        if(e.dead) continue;
        if(Math.hypot(e.x-b.x, e.y-b.y) < e.radius + 5){
          hitEnemy(e, BASE_MAGIC_DMG * magicDmgMult, b.x, b.y, 10);
          magicBolts.splice(i,1);
          removed = true;
          break;
        }
      }
      if(removed) continue;
    }

    // enemy bolts
    for(let i=enemyBolts.length-1; i>=0; i--){
      const b = enemyBolts[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if(b.life <= 0 || collidesObstacles(b.x, b.y, 4)){ enemyBolts.splice(i,1); continue; }
      if(Math.hypot(player.x-b.x, player.y-b.y) < PLAYER_RADIUS + 5){
        damagePlayer(b.dmg);
        enemyBolts.splice(i,1);
      }
    }

    // enemies
    frameCount++;
    enemies.forEach(e=>{
      if(e.dead) return;
      if(e.hitFlash > 0) e.hitFlash--;
      const ex = player.x - e.x, ey = player.y - e.y;
      const dist = Math.hypot(ex, ey) || 1;
      let nx = ex/dist, ny = ey/dist;
      if(e.erratic){
        const wobble = Math.sin((frameCount + e.wobbleSeed) * 0.15) * 0.9;
        const perpX = -ny, perpY = nx;
        nx += perpX * wobble;
        ny += perpY * wobble;
        const norm = Math.hypot(nx, ny) || 1;
        nx /= norm; ny /= norm;
      }
      moveEntity(e, nx*e.speed, ny*e.speed, e.radius);

      if(dist < e.radius + PLAYER_RADIUS + 4){
        damagePlayer(e.dmg, -ex/dist, -ey/dist, e.knockback);
      }

      if(e.ranged){
        if(e.atkCooldown > 0) e.atkCooldown--;
        else if(dist < 420){
          e.atkCooldown = e.atkCooldownMax;
          const nx = ex/dist, ny = ey/dist;
          if(e.isBoss){
            [-0.3, 0, 0.3].forEach(off=>{
              const ang = Math.atan2(ny, nx) + off;
              enemyBolts.push({ x:e.x, y:e.y, vx:Math.cos(ang)*e.boltSpeed, vy:Math.sin(ang)*e.boltSpeed, life:110, dmg:e.dmg });
            });
          } else {
            enemyBolts.push({ x:e.x, y:e.y, vx:nx*e.boltSpeed, vy:ny*e.boltSpeed, life:110, dmg:e.dmg });
          }
        }
      }
    });
    enemies = enemies.filter(e => !e.dead);

    // loot pickups
    for(let i=lootItems.length-1; i>=0; i--){
      const l = lootItems[i];
      if(Math.hypot(player.x-l.x, player.y-l.y) < PLAYER_RADIUS + LOOT_RADIUS){
        if(l.kind === 'potion'){
          player.hp = Math.min(maxHp, player.hp + 1.5);
        } else if(l.kind === 'rare'){
          lootCollected += 3;
        } else if(l.kind === 'equipment'){
          if(l.rune === 'sword') runBuffs.sword += 0.15;
          else if(l.rune === 'magicCooldown') runBuffs.magicCooldown += 0.1;
          else if(l.rune === 'speed') runBuffs.speed += 0.1;
        } else {
          lootCollected++;
        }
        lootItems.splice(i,1);
        updateHud();
      }
    }

    // floor clear -> stairs
    if(!floorCleared && enemies.length === 0){
      floorCleared = true;
      stairs = randomClearSpot(120);
    }
    if(floorCleared && stairs && Math.hypot(player.x-stairs.x, player.y-stairs.y) < PLAYER_RADIUS + 18){
      player.hp = Math.min(maxHp, player.hp + 1);
      generateFloor(floorNum + 1);
      updateHud();
    }
  }

  function drawHeartlessBar(e){
    if(e.hp >= e.maxHp) return;
    const w = e.radius * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - w/2, e.y - e.radius - 12, w, 5);
    ctx.fillStyle = '#ff5454';
    ctx.fillRect(e.x - w/2, e.y - e.radius - 12, w * clamp(e.hp/e.maxHp,0,1), 5);
  }

  function render(){
    ctx.fillStyle = '#0d0a14';
    ctx.fillRect(0,0,W,H);

    // walls
    ctx.fillStyle = '#1a1428';
    ctx.fillRect(0,0,W,WALL);
    ctx.fillRect(0,H-WALL,W,WALL);
    ctx.fillRect(0,0,WALL,H);
    ctx.fillRect(W-WALL,0,WALL,H);

    // obstacles
    ctx.fillStyle = '#241c33';
    ctx.strokeStyle = '#3a2d4d';
    obstacles.forEach(o=>{
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    });

    // loot
    lootItems.forEach(l=>{
      ctx.beginPath();
      if(l.kind === 'potion'){
        ctx.fillStyle = '#ff5b7a';
        ctx.arc(l.x, l.y, 8, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(l.x-1.5, l.y-5, 3, 10);
        ctx.fillRect(l.x-5, l.y-1.5, 10, 3);
      } else if(l.kind === 'rare'){
        ctx.fillStyle = '#7dd3ff';
        ctx.shadowColor = '#7dd3ff';
        ctx.shadowBlur = 10;
        ctx.moveTo(l.x, l.y-9);
        ctx.lineTo(l.x+7, l.y);
        ctx.lineTo(l.x, l.y+9);
        ctx.lineTo(l.x-7, l.y);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if(l.kind === 'equipment'){
        ctx.fillStyle = '#c9a6ff';
        ctx.shadowColor = '#c9a6ff';
        ctx.shadowBlur = 10;
        ctx.arc(l.x, l.y, 8, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = '#0d0a14';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = '#ffc857';
        ctx.shadowColor = '#ffc857';
        ctx.shadowBlur = 6;
        ctx.arc(l.x, l.y, 7, 0, Math.PI*2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    // stairs
    if(stairs){
      ctx.fillStyle = '#8b6dff';
      ctx.shadowColor = '#8b6dff';
      ctx.shadowBlur = 10;
      ctx.fillRect(stairs.x-16, stairs.y-16, 32, 32);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0d0a14';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('↓', stairs.x, stairs.y+6);
      ctx.textAlign = 'left';
    }

    // enemies
    enemies.forEach(e=>{
      ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = e.isBoss ? 14 : 6;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if(e.isElite){
        ctx.strokeStyle = '#ffc857';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 3, 0, Math.PI*2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      drawHeartlessBar(e);
    });

    // enemy bolts
    ctx.fillStyle = '#ff5454';
    enemyBolts.forEach(b=>{
      ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI*2); ctx.fill();
    });

    // magic bolts
    ctx.fillStyle = '#7dd3ff';
    ctx.shadowColor = '#7dd3ff';
    ctx.shadowBlur = 8;
    magicBolts.forEach(b=>{
      ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI*2); ctx.fill();
    });
    ctx.shadowBlur = 0;

    // sword swing arc
    if(swordSwingTimer > 0){
      const baseAng = Math.atan2(player.facingY, player.facingX);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(player.x, player.y, SWORD_RANGE, baseAng - SWORD_ARC, baseAng + SWORD_ARC);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // player
    ctx.fillStyle = player.invuln > 0 && Math.floor(player.invuln/4)%2===0 ? 'rgba(255,255,255,0.5)' : '#2de2c5';
    ctx.shadowColor = '#2de2c5';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // facing indicator
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(player.x + player.facingX*10, player.y + player.facingY*10, 3, 0, Math.PI*2);
    ctx.fill();

    drawMinimap();
  }

  function drawMinimap(){
    const mmW = 130, mmH = 90, mmX = W - mmW - 12, mmY = 12;
    const sx = mmW / W, sy = mmH / H;

    ctx.fillStyle = 'rgba(10,8,16,0.75)';
    ctx.fillRect(mmX, mmY, mmW, mmH);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(mmX, mmY, mmW, mmH);

    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    obstacles.forEach(o=>{
      ctx.fillRect(mmX + o.x*sx, mmY + o.y*sy, Math.max(2,o.w*sx), Math.max(2,o.h*sy));
    });

    lootItems.forEach(l=>{
      ctx.fillStyle = l.kind === 'potion' ? '#ff5b7a' : (l.kind === 'equipment' ? '#c9a6ff' : '#ffc857');
      ctx.beginPath();
      ctx.arc(mmX + l.x*sx, mmY + l.y*sy, 1.6, 0, Math.PI*2);
      ctx.fill();
    });

    if(stairs){
      ctx.fillStyle = '#8b6dff';
      ctx.fillRect(mmX + stairs.x*sx - 2, mmY + stairs.y*sy - 2, 4, 4);
    }

    enemies.forEach(e=>{
      ctx.fillStyle = e.isBoss ? '#ff5454' : (e.isElite ? '#ffc857' : e.color);
      ctx.beginPath();
      ctx.arc(mmX + e.x*sx, mmY + e.y*sy, e.isBoss ? 3 : 2, 0, Math.PI*2);
      ctx.fill();
    });

    ctx.fillStyle = '#2de2c5';
    ctx.beginPath();
    ctx.arc(mmX + player.x*sx, mmY + player.y*sy, 2.5, 0, Math.PI*2);
    ctx.fill();
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function onKeyPress(name){ /* handled via continuous key checks in update() */ }

  function start(){
    document.getElementById('roguelike-setup').classList.add('hidden');
    document.getElementById('roguelike-result').classList.add('hidden');
    document.getElementById('roguelike-play').classList.remove('hidden');
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
    document.getElementById('roguelike-setup').classList.remove('hidden');
    document.getElementById('roguelike-play').classList.add('hidden');
    document.getElementById('roguelike-result').classList.add('hidden');
    renderRoguelikeUpgrades();
  }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
