/* =========================================================
   ROBOT ARENA — a run built out of scrap
   =========================================================
   You don't pick a loadout, you're handed one. Every part is generated with
   rolled stats and a rarity, and the good ones often come with something
   wrong with them. Win a round and you draft one of three new parts; the
   run is the sequence of those choices.

   Parts are physical. Each one is a box bolted to the chassis and a slice of
   your hit points, and when a slice is gone that part comes off — so losing
   your left thruster genuinely makes you turn worse, and losing a cannon
   costs you the damage it was contributing. What's left is what you fight
   with.

   Certain combinations of parts unlock an ability with a cooldown, listed
   down the left of the screen. */
const RobotGame = (function(){
  const canvas = document.getElementById('robot-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  /* ---- part generation ------------------------------------------------ */

  const RARITIES = {
    common:    { name: 'Common',    colour: '#9aa4b4', mult: 1.00, debuff: 0.15, weight: 46 },
    uncommon:  { name: 'Uncommon',  colour: '#45ffb0', mult: 1.22, debuff: 0.28, weight: 28 },
    rare:      { name: 'Rare',      colour: '#7dd3ff', mult: 1.48, debuff: 0.42, weight: 17 },
    epic:      { name: 'Epic',      colour: '#c084fc', mult: 1.80, debuff: 0.58, weight: 7 },
    legendary: { name: 'Legendary', colour: '#ffc857', mult: 2.25, debuff: 0.72, weight: 2 }
  };

  // Each family says what a part of that kind does and roughly where it
  // bolts on. `tag` is what synergies look for.
  const FAMILIES = {
    cannon:   { name: 'Cannon',    tag: 'gun',     slot: 'arm',   icon: '🔫',
                base: { dps: 9,  fireRate: 0.9, hp: 26 } },
    laser:    { name: 'Laser',     tag: 'gun',     slot: 'arm',   icon: '⚡',
                base: { dps: 6,  fireRate: 1.8, hp: 20 } },
    launcher: { name: 'Launcher',  tag: 'gun',     slot: 'arm',   icon: '🚀',
                base: { dps: 15, fireRate: 0.45, hp: 30 } },
    plating:  { name: 'Plating',   tag: 'armour',  slot: 'body',  icon: '🛡',
                base: { hp: 58, speed: -0.10 } },
    thruster: { name: 'Thruster',  tag: 'engine',  slot: 'leg',   icon: '🔥',
                base: { speed: 0.42, turn: 0.010, hp: 18 } },
    gyro:     { name: 'Gyro',      tag: 'engine',  slot: 'body',  icon: '🌀',
                base: { turn: 0.020, speed: 0.10, hp: 16 } },
    reactor:  { name: 'Reactor',   tag: 'core',    slot: 'body',  icon: '☢',
                base: { dps: 4, fireRate: 0.35, hp: 22 } },
    cooler:   { name: 'Cooler',    tag: 'core',    slot: 'body',  icon: '❄',
                base: { fireRate: 0.7, hp: 20 } },
    scanner:  { name: 'Scanner',   tag: 'optic',   slot: 'head',  icon: '👁',
                base: { dps: 3, range: 90, hp: 14 } }
  };

  // Things that can be wrong with a part. The better the rarity the more
  // likely one is attached — that's the trade, not a stat penalty.
  const DEBUFFS = [
    { id: 'heavy',    label: 'Heavy',        desc: '−18% speed',      apply: s => { s.speed -= 0.18; } },
    { id: 'jammed',   label: 'Jammed',       desc: '−25% fire rate',  apply: s => { s.fireRate *= 0.75; } },
    { id: 'brittle',  label: 'Brittle',      desc: '−30% part HP',    apply: s => { s.hp = Math.round(s.hp * 0.70); } },
    { id: 'unstable', label: 'Unstable',     desc: '−0.012 turn',     apply: s => { s.turn -= 0.012; } },
    { id: 'leaky',    label: 'Leaky',        desc: '−20% damage',     apply: s => { s.dps *= 0.80; } }
  ];

  const ADJECTIVES = ['Scrap', 'Salvaged', 'Field', 'Mk II', 'Prototype', 'Surplus',
                      'Reinforced', 'Overclocked', 'Battered', 'Custom'];

  let partSeq = 0;

  function rollRarity(round){
    // Later rounds tilt toward better scrap, without ever guaranteeing it.
    const bonus = Math.min(2.2, 1 + round * 0.13);
    const pool = [];
    Object.entries(RARITIES).forEach(([id, r]) => {
      const w = id === 'common' ? r.weight / bonus : r.weight * (id === 'uncommon' ? 1 : bonus);
      pool.push([id, w]);
    });
    const total = pool.reduce((a, [, w]) => a + w, 0);
    let roll = Math.random() * total;
    for(const [id, w] of pool){
      roll -= w;
      if(roll <= 0) return id;
    }
    return 'common';
  }

  // `force` pins the family and/or rarity. It has to be applied here rather
  // than patched onto the finished part: stats are rolled *from* the rarity,
  // so setting `part.rarity` afterwards only repaints the card.
  function makePart(round, force){
    const f = force || {};
    const famIds = Object.keys(FAMILIES);
    const famId = f.family || famIds[Math.floor(Math.random() * famIds.length)];
    const fam = FAMILIES[famId];
    const rarId = f.rarity || rollRarity(round);
    const rar = RARITIES[rarId];

    const stats = { dps: 0, fireRate: 0, hp: 0, speed: 0, turn: 0, range: 0 };
    Object.entries(fam.base).forEach(([k, v]) => {
      // ±15% roll on top of the rarity multiplier, so two Rare cannons still
      // differ.
      const jitter = 0.85 + Math.random() * 0.30;
      stats[k] = v * rar.mult * jitter;
    });
    stats.hp = Math.round(stats.hp);

    let debuff = null;
    if(Math.random() < rar.debuff){
      debuff = DEBUFFS[Math.floor(Math.random() * DEBUFFS.length)];
      debuff.apply(stats);
    }

    return {
      id: ++partSeq,
      family: famId, tag: fam.tag, slot: fam.slot, icon: fam.icon,
      rarity: rarId,
      name: `${ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)]} ${fam.name}`,
      stats,
      debuff,
      hp: stats.hp, maxHp: stats.hp,
      broken: false
    };
  }

  /* ---- synergies ------------------------------------------------------ */

  // Each needs a specific mix of part tags. The ability is the payoff for
  // taking parts that fit together instead of always taking the biggest
  // number on the card.
  const SYNERGIES = [
    { id: 'overdrive', name: 'Overdrive', key: '1', icon: '⚡', cooldown: 420,
      needs: { gun: 2, core: 1 },
      desc: 'Two guns + a core. Doubles fire rate for 3s.',
      duration: 180 },
    { id: 'bulwark', name: 'Bulwark', key: '2', icon: '🛡', cooldown: 540,
      needs: { armour: 2 },
      desc: 'Two plates. Halves incoming damage for 4s.',
      duration: 240 },
    { id: 'blink', name: 'Blink', key: '3', icon: '💨', cooldown: 300,
      needs: { engine: 2 },
      desc: 'Two engines. Dash 6 units instantly.',
      duration: 1 },
    { id: 'scattershot', name: 'Scattershot', key: '4', icon: '💥', cooldown: 480,
      needs: { gun: 3 },
      desc: 'Three guns. One salvo in every direction.',
      duration: 1 },
    { id: 'lockon', name: 'Lock-On', key: '5', icon: '🎯', cooldown: 360,
      needs: { optic: 1, gun: 1 },
      desc: 'A scanner + a gun. Next 3s of shots home in.',
      duration: 180 }
  ];

  function activeSynergies(parts){
    const counts = {};
    parts.forEach(p => { if(!p.broken) counts[p.tag] = (counts[p.tag] || 0) + 1; });
    return SYNERGIES.filter(sy =>
      Object.entries(sy.needs).every(([tag, n]) => (counts[tag] || 0) >= n));
  }

  /* ---- derived stats -------------------------------------------------- */

  // Only working parts contribute. This is what makes losing a part matter:
  // the number it was adding simply stops being in the sum.
  function statsOf(parts){
    // The bare chassis. 40 base HP meant a round-one opponent that happened to
    // roll two guns could end the run in about two seconds, before you'd
    // drafted anything — the fight was decided by the roll, not by play.
    const out = { dps: 6, fireRate: 0.7, speed: 1.5, turn: 0.030, range: 240, maxHp: 90 };
    parts.forEach(p => {
      if(p.broken) return;
      out.dps      += p.stats.dps      || 0;
      out.fireRate += p.stats.fireRate || 0;
      out.speed    += p.stats.speed    || 0;
      out.turn     += p.stats.turn     || 0;
      out.range    += p.stats.range    || 0;
      out.maxHp    += p.maxHp;
    });
    out.speed = Math.max(0.35, out.speed);
    out.turn = Math.max(0.008, out.turn);
    out.fireRate = Math.max(0.25, out.fireRate);
    return out;
  }

  /* ---- state ---------------------------------------------------------- */

  const ARENA = 22;
  // The opponent tracks its target every frame. Asking a player to out-twitch
  // that with A/D turns the whole game into an aiming contest and buries the
  // part of it that's actually interesting — the draft. So your gun tracks
  // for you, but only within a cone off the chassis, which keeps positioning
  // as the thing you're actually playing.
  // Wide enough to hold an opponent that's actively circling you at close
  // range — at ±0.55 the gun lost anything that got round your flank and the
  // fight stalled with neither side landing a shot.
  const TURRET_CONE = 1.0;
  const TURRET_SLEW = 0.09;
  let rafId = null, running = false, paused = false;
  let me, foe, shots, particles, round, wins, frame, shake, banner;
  let intermission, grace, drafting, draftCards;
  let cooldowns = {}, buffs = {};
  let camYaw = 0;

  const ROUND_GRACE = 60;

  function makeBot(parts, x, z, facing){
    const s = statsOf(parts);
    return {
      parts, s, x, z, yaw: facing,
      hp: s.maxHp, maxHp: s.maxHp,
      turret: facing,
      cool: 0, hitFlash: 0, think: 0, strafe: 1
    };
  }

  // A fresh run starts with three parts, so there's already something to
  // build on rather than a blank chassis.
  // One gun is guaranteed. Rolling three defensive parts left you unable to
  // meaningfully hurt anything, which isn't a run — it's a loss you have to
  // sit through.
  function startingParts(){
    const guns = ['cannon', 'laser', 'launcher'];
    return [
      makePart(0, { family: guns[Math.floor(Math.random()*guns.length)] }),
      makePart(0),
      makePart(0)
    ];
  }

  function enemyParts(round){
    // Round one is deliberately thin — two parts rolled at the bottom of the
    // table — so the first fight teaches the controls instead of ending the
    // run before you've drafted anything.
    if(round <= 1){
      return [makePart(0, { rarity: 'common' }), makePart(0, { rarity: 'common' })];
    }
    const n = Math.min(8, 2 + Math.floor(round * 0.7));
    const out = [];
    for(let i=0;i<n;i++) out.push(makePart(round - 1));
    return out;
  }

  /* ---- rendering the robot -------------------------------------------- */

  // Parts are drawn where they're bolted, and a broken one leaves a stump —
  // so the robot visibly falls apart as the fight goes on.
  function botFaces(bot, isMe){
    const body = [];
    const edge = { stroke: 'rgba(0,0,0,0.35)', lineWidth: 1 };
    const tint = isMe ? '#4cb8ff' : '#ff5454';
    const flash = bot.hitFlash > 0;

    body.push(...Mini3D.box(0, 0.62, 0, 0.9, 0.85, 0.75,
                            flash ? '#ffffff' : tint, edge));

    const slots = { arm: 0, leg: 0, body: 0, head: 0 };
    bot.parts.forEach(p => {
      const rar = RARITIES[p.rarity];
      const i = slots[p.slot]++;
      const col = p.broken ? '#2a2f3a' : rar.colour;
      const o = p.broken ? { ...edge, alpha: 0.45 } : { ...edge, glow: rar.colour, glowBlur: 10 };
      if(p.slot === 'arm'){
        const side = i % 2 === 0 ? -1 : 1;
        const back = Math.floor(i / 2) * 0.34;
        body.push(...Mini3D.box(side * 0.68, 0.66 - back * 0.1, -back,
                                0.34, 0.30, 0.72, col, o));
      } else if(p.slot === 'leg'){
        const side = i % 2 === 0 ? -1 : 1;
        body.push(...Mini3D.box(side * 0.42, 0.20, -0.32 - Math.floor(i/2)*0.2,
                                0.30, 0.36, 0.42, col, o));
      } else if(p.slot === 'head'){
        body.push(...Mini3D.box(0, 1.18 + i * 0.22, 0.1, 0.34, 0.26, 0.34, col, o));
      } else {
        body.push(...Mini3D.box(0, 0.62, 0.44 + i * 0.14, 0.62, 0.5, 0.16, col, o));
      }
    });

    const chassis = Mini3D.transform(body, { x: bot.x, y: 0, z: bot.z, yaw: bot.yaw });
    // The barrel sits on its own mount so it points where the shot goes.
    const barrel = Mini3D.transform(
      Mini3D.box(0, 0.66, 0.55, 0.16, 0.16, 0.6, '#0b0f17', edge),
      { x: bot.x, y: 0, z: bot.z, yaw: bot.turret == null ? bot.yaw : bot.turret });
    return chassis.concat(barrel);
  }

  /* ---- combat --------------------------------------------------------- */

  function fire(bot, angle, isMe){
    if(bot.cool > 0) return;
    bot.cool = Math.max(8, 60 / bot.s.fireRate);
    const homing = isMe && buffs.lockon > 0;
    shots.push({
      x: bot.x + Math.sin(angle) * 0.8,
      z: bot.z + Math.cos(angle) * 0.8,
      a: angle,
      // Fast enough to actually connect. At 0.42 a frame a shot took most of
      // a second to cross the arena, by which time a strafing opponent had
      // walked out of it — neither side could land anything and fights
      // stalled out.
      speed: 0.85,
      dmg: bot.s.dps / Math.max(0.3, bot.s.fireRate),
      life: bot.s.range / 42,
      mine: isMe,
      homing
    });
    Sfx.play('laser', isMe ? 1 : 0.75);
  }

  // Damage lands on a random working part first, and only spills into the
  // chassis once that part is gone. That's what ties "I'm losing" to "I can
  // see which bit fell off".
  function damage(bot, amount, isMe){
    if(isMe && buffs.bulwark > 0) amount *= 0.5;
    bot.hitFlash = 6;
    const alive = bot.parts.filter(p => !p.broken);
    if(alive.length){
      const p = alive[Math.floor(Math.random() * alive.length)];
      p.hp -= amount;
      if(p.hp <= 0){
        p.broken = true;
        bot.s = statsOf(bot.parts);          // stats drop immediately
        shake = 14;
        Sfx.play('explode', 1.1);
        burst(bot.x, bot.z, RARITIES[p.rarity].colour, 16);
        if(isMe && typeof toast === 'function'){
          toast('Part destroyed', `${p.icon} ${p.name} is gone`, '💥', 'pink');
        }
      }
    }
    bot.hp -= amount;
    if(bot.hp <= 0) endRound(!isMe);
  }

  function burst(x, z, colour, n){
    for(let i=0;i<(n||10);i++){
      const a = Math.random() * Math.PI * 2;
      particles.push({ x, z, y: 0.7,
        vx: Math.cos(a) * 0.12, vz: Math.sin(a) * 0.12, vy: Math.random() * 0.1,
        life: 1, colour });
    }
  }

  /* ---- abilities ------------------------------------------------------ */

  function useAbility(sy){
    if((cooldowns[sy.id] || 0) > 0) return;
    cooldowns[sy.id] = sy.cooldown;
    Sfx.play('perfect');
    if(sy.id === 'blink'){
      me.x = clamp(me.x + Math.sin(me.yaw) * 6, -ARENA, ARENA);
      me.z = clamp(me.z + Math.cos(me.yaw) * 6, -ARENA, ARENA);
      burst(me.x, me.z, '#7dd3ff', 20);
    } else if(sy.id === 'scattershot'){
      for(let i=0;i<12;i++){
        const a = (i / 12) * Math.PI * 2;
        shots.push({ x: me.x, z: me.z, a, speed: 0.72,
                     dmg: me.s.dps / Math.max(0.3, me.s.fireRate) * 0.7,
                     life: 8, mine: true, homing: false });
      }
    } else {
      buffs[sy.id] = sy.duration;
    }
  }

  /* ---- loop ----------------------------------------------------------- */

  function update(){
    frame++;
    if(shake > 0) shake = Math.max(0, shake - 0.8);
    if(drafting || intermission){
      stepParticles();
      return;
    }
    if(grace > 0){ grace--; if(grace === 0) banner = null; }

    Object.keys(cooldowns).forEach(k => { if(cooldowns[k] > 0) cooldowns[k]--; });
    Object.keys(buffs).forEach(k => { if(buffs[k] > 0) buffs[k]--; });
    if(me.cool > 0) me.cool--;
    if(foe.cool > 0) foe.cool--;
    if(me.hitFlash > 0) me.hitFlash--;
    if(foe.hitFlash > 0) foe.hitFlash--;

    // player
    if(keys.has('a') || keys.has('arrowleft')) me.yaw -= me.s.turn;
    if(keys.has('d') || keys.has('arrowright')) me.yaw += me.s.turn;
    let drive = 0;
    if(keys.has('w') || keys.has('arrowup')) drive = 1;
    if(keys.has('s') || keys.has('arrowdown')) drive = -0.6;
    const step = me.s.speed * 0.055 * drive;
    me.x = clamp(me.x + Math.sin(me.yaw) * step, -ARENA, ARENA);
    me.z = clamp(me.z + Math.cos(me.yaw) * step, -ARENA, ARENA);
    // turret tracks the opponent, clamped to the cone
    let bearing = Math.atan2(foe.x - me.x, foe.z - me.z) - me.yaw;
    while(bearing > Math.PI) bearing -= Math.PI*2;
    while(bearing < -Math.PI) bearing += Math.PI*2;
    const goal = me.yaw + clamp(bearing, -TURRET_CONE, TURRET_CONE);
    let slew = goal - me.turret;
    while(slew > Math.PI) slew -= Math.PI*2;
    while(slew < -Math.PI) slew += Math.PI*2;
    me.turret += clamp(slew, -TURRET_SLEW, TURRET_SLEW);

    if(grace <= 0 && keys.has('space') && me.cool <= 0){
      fire(me, me.turret, true);
      if(buffs.overdrive > 0) me.cool /= 2;
    }

    // opponent — closes, circles, shoots
    const dx = me.x - foe.x, dz = me.z - foe.z;
    const dist = Math.hypot(dx, dz) || 1;
    let diff = Math.atan2(dx, dz) - foe.yaw;
    while(diff > Math.PI) diff -= Math.PI*2;
    while(diff < -Math.PI) diff += Math.PI*2;
    foe.yaw += clamp(diff, -foe.s.turn, foe.s.turn);
    foe.turret = foe.yaw;
    foe.think--;
    if(foe.think <= 0){ foe.think = 40 + Math.random()*50; foe.strafe = Math.random() < 0.5 ? 1 : -1; }
    const ideal = Math.max(6, foe.s.range * 0.03);
    const forward = dist > ideal ? 1 : (dist < ideal * 0.6 ? -0.7 : 0);
    const fs = foe.s.speed * 0.055;
    foe.x = clamp(foe.x + Math.sin(foe.yaw)*fs*forward + Math.cos(foe.yaw)*fs*0.45*foe.strafe, -ARENA, ARENA);
    foe.z = clamp(foe.z + Math.cos(foe.yaw)*fs*forward - Math.sin(foe.yaw)*fs*0.45*foe.strafe, -ARENA, ARENA);
    if(grace <= 0 && dist < foe.s.range * 0.05 && Math.abs(diff) < 0.30) fire(foe, foe.yaw, false);

    // shots
    for(let i=shots.length-1;i>=0;i--){
      const b = shots[i];
      const target = b.mine ? foe : me;
      if(b.homing){
        let want = Math.atan2(target.x - b.x, target.z - b.z) - b.a;
        while(want > Math.PI) want -= Math.PI*2;
        while(want < -Math.PI) want += Math.PI*2;
        b.a += clamp(want, -0.06, 0.06);
      }
      b.x += Math.sin(b.a) * b.speed;
      b.z += Math.cos(b.a) * b.speed;
      b.life -= 0.06;
      if(b.life <= 0 || Math.abs(b.x) > ARENA+4 || Math.abs(b.z) > ARENA+4){
        shots.splice(i,1); continue;
      }
      if(Math.hypot(b.x - target.x, b.z - target.z) < 1.35){
        shots.splice(i,1);
        burst(b.x, b.z, b.mine ? '#7dd3ff' : '#ff8a3d', 6);
        damage(target, b.dmg, !b.mine);
        if(!running) return;
      }
    }

    stepParticles();
    updateHud();
  }

  function stepParticles(){
    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.x += p.vx; p.z += p.vz; p.y += p.vy; p.vy -= 0.006;
      p.life -= 0.03;
      if(p.life <= 0 || p.y < 0) particles.splice(i,1);
    }
  }

  function endRound(won){
    if(won){
      wins++;
      round++;
      banner = 'SCRAPPED IT';
      shake = 16;
      Sfx.play('win');
      earnTokens('robot_win', 1);
      burst(foe.x, foe.z, '#ffc857', 30);
      intermission = true;
      shots = [];
      setTimeout(() => { if(running) openDraft(); }, 900);
    } else {
      gameOver();
    }
  }

  /* ---- draft ---------------------------------------------------------- */

  function openDraft(){
    drafting = true;
    intermission = false;
    draftCards = [makePart(round), makePart(round), makePart(round)];
    renderDraft();
    document.getElementById('robot-draft').classList.remove('hidden');
    Sfx.play('perfect');
  }

  function statLine(stats){
    const bits = [];
    const add = (label, v, dp) => {
      if(!v) return;
      const n = dp ? v.toFixed(dp) : Math.round(v);
      bits.push(`<span class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${n} ${label}</span>`);
    };
    add('DPS', stats.dps, 1);
    add('fire rate', stats.fireRate, 2);
    add('HP', stats.hp);
    add('speed', stats.speed, 2);
    add('turn', stats.turn, 3);
    add('range', stats.range);
    return bits.join('');
  }

  function renderDraft(){
    const box = document.getElementById('robot-draft-cards');
    box.innerHTML = draftCards.map((p, i) => {
      const rar = RARITIES[p.rarity];
      return `
        <button class="part-card rar-${p.rarity}" onclick="RobotGame.takePart(${i})">
          <div class="part-rarity" style="color:${rar.colour}">${rar.name}</div>
          <div class="part-icon">${p.icon}</div>
          <div class="part-name">${p.name}</div>
          <div class="part-stats">${statLine(p.stats)}</div>
          ${p.debuff ? `<div class="part-debuff">⚠ ${p.debuff.label} · ${p.debuff.desc}</div>` : ''}
          <div class="part-tag">${p.tag}</div>
        </button>`;
    }).join('');
    // Show what each choice would unlock, so synergies are something you can
    // plan for rather than stumble into.
    const hint = document.getElementById('robot-draft-hint');
    const now = activeSynergies(me.parts).map(s => s.id);
    const gains = draftCards.map((p, i) => {
      const after = activeSynergies(me.parts.concat([p])).filter(s => !now.includes(s.id));
      return after.length ? `Card ${i+1} unlocks ${after.map(s => s.icon + ' ' + s.name).join(', ')}` : null;
    }).filter(Boolean);
    hint.innerHTML = gains.length ? gains.join(' · ') : 'No new synergy from these three.';
  }

  function takePart(i){
    const p = draftCards[i];
    if(!p) return;
    me.parts.push(p);
    me.s = statsOf(me.parts);
    // A new part adds its hit points on top rather than healing you — the
    // run is about accumulating, and a fresh plate genuinely is fresh.
    me.maxHp = me.s.maxHp;
    me.hp = Math.min(me.maxHp, me.hp + p.maxHp);
    drafting = false;
    document.getElementById('robot-draft').classList.add('hidden');
    Sfx.play('win');
    freshFight();
  }

  /* ---- fights --------------------------------------------------------- */

  function freshFight(){
    const parts = me ? me.parts : startingParts();
    const carriedHp = me && round > 1 ? me.hp : null;
    me = makeBot(parts, 0, -10, 0);
    if(carriedHp !== null) me.hp = clamp(carriedHp, 1, me.maxHp);
    foe = makeBot(enemyParts(round), 0, 10, Math.PI);
    shots = []; particles = [];
    intermission = false; drafting = false;
    grace = ROUND_GRACE;
    camYaw = me.yaw;
    banner = 'ROUND ' + round;
    buffs = {};
    updateHud();
  }

  function gameOver(){
    running = false;
    updateStat('robot', [{stat:'bestRound', type:'max', value:wins}]);
    zipReactToScore('robot', 'bestRound', wins);
    Sfx.play('lose');
    document.getElementById('robot-result-text').textContent = wins > 0 ? 'DESTROYED' : 'SCRAPPED';
    const kept = me.parts.filter(p => !p.broken).length;
    document.getElementById('robot-result-sub').textContent =
      `You won ${wins} fight${wins===1?'':'s'} and finished with ${kept} of ${me.parts.length} parts intact.`;
    document.getElementById('robot-play').classList.add('hidden');
    document.getElementById('robot-draft').classList.add('hidden');
    document.getElementById('robot-result').classList.remove('hidden');
  }

  /* ---- HUD ------------------------------------------------------------ */

  function updateHud(){
    document.getElementById('robot-round').textContent = round;
    document.getElementById('robot-hp').style.width = Math.max(0, me.hp/me.maxHp*100) + '%';
    document.getElementById('robot-foe-hp').style.width = Math.max(0, foe.hp/foe.maxHp*100) + '%';
    document.getElementById('robot-foe-build').textContent =
      `${foe.parts.filter(p=>!p.broken).length} parts`;
  }

  function drawAbilities(){
    const list = activeSynergies(me.parts);
    ctx.save();
    list.forEach((sy, i) => {
      const y = 74 + i * 52;
      const cd = cooldowns[sy.id] || 0;
      const ready = cd <= 0;
      ctx.fillStyle = ready ? 'rgba(45,226,197,0.16)' : 'rgba(6,9,15,0.6)';
      ctx.beginPath(); ctx.roundRect(12, y, 46, 46, 9); ctx.fill();
      ctx.strokeStyle = ready ? '#2de2c5' : 'rgba(232,236,241,0.2)';
      ctx.lineWidth = ready ? 2 : 1;
      ctx.stroke();
      if(!ready){
        // cooldown sweeps up the tile
        const frac = 1 - cd / sy.cooldown;
        ctx.fillStyle = 'rgba(45,226,197,0.22)';
        ctx.fillRect(12, y + 46 - 46*frac, 46, 46*frac);
      }
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.globalAlpha = ready ? 1 : 0.5;
      ctx.fillText(sy.icon, 35, y + 30);
      ctx.globalAlpha = 1;
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillStyle = ready ? '#2de2c5' : 'rgba(232,236,241,0.45)';
      ctx.fillText(sy.key, 35, y + 43);
      ctx.textAlign = 'left';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = ready ? 'rgba(232,236,241,0.8)' : 'rgba(232,236,241,0.35)';
      ctx.fillText(sy.name, 64, y + 20);
      if(buffs[sy.id] > 0){
        ctx.fillStyle = '#45ffb0';
        ctx.fillText('ACTIVE', 64, y + 34);
      } else if(!ready){
        ctx.fillText(Math.ceil(cd/60) + 's', 64, y + 34);
      }
    });
    ctx.restore();
  }

  function render(){
    ctx.save();
    if(settings.shake && shake > 0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

    // A chase camera behind your own robot, like the other 3D cabinets. The
    // fixed overhead it had before put the near half of the arena in your
    // face and dropped the far half off the top of the screen — you couldn't
    // see your own robot once you moved.
    let cd = me.yaw - camYaw;
    while(cd > Math.PI) cd -= Math.PI*2;
    while(cd < -Math.PI) cd += Math.PI*2;
    camYaw += cd * 0.12;
    const cam = {
      x: me.x - Math.sin(camYaw) * 9,
      y: 5.4,
      z: me.z - Math.cos(camYaw) * 9,
      yaw: camYaw,
      pitch: -0.32
    };
    Mini3D.sky(ctx, W, H, cam, {
      focal: 300,
      skyTop: '#05070d', skyBottom: '#141d33',
      groundNear: '#0e1524', groundFar: '#05070d'
    });

    let faces = [];
    // arena floor
    for(let gx=-3; gx<3; gx++){
      for(let gz=-3; gz<3; gz++){
        faces.push({
          pts: [
            { x: gx*8, y: 0, z: gz*8 }, { x: gx*8+8, y: 0, z: gz*8 },
            { x: gx*8+8, y: 0, z: gz*8+8 }, { x: gx*8, y: 0, z: gz*8+8 }
          ],
          fill: (gx+gz) % 2 ? '#111a2b' : '#16203400'.slice(0,7)
        });
      }
    }
    // arena wall
    [[-1,0],[1,0],[0,-1],[0,1]].forEach(([sx, sz]) => {
      faces.push(...Mini3D.box(sx*(ARENA+1), 0.6, sz*(ARENA+1),
                               sx ? 0.6 : (ARENA+1)*2, 1.2, sz ? 0.6 : (ARENA+1)*2,
                               '#1d2740', { stroke:'rgba(255,200,87,0.25)' }));
    });

    faces = faces.concat(botFaces(foe, false), botFaces(me, true));
    shots.forEach(b => {
      // Enemy fire is orange rather than the enemy's own red, so a screen full
      // of incoming shots doesn't read as a screen full of enemy.
      const col = b.mine ? '#7dd3ff' : '#ff8a3d';
      faces = faces.concat(Mini3D.box(b.x, 0.6, b.z, 0.16, 0.16, 0.44, col,
                                      { glow: col, glowBlur: 12 }));
    });
    particles.forEach(p => {
      faces = faces.concat(Mini3D.box(p.x, p.y, p.z, 0.16, 0.16, 0.16, p.colour,
                                      { alpha: Math.max(0, p.life), glow: p.colour, glowBlur: 8 }));
    });

    Mini3D.render(ctx, faces, cam, W, H, 300);
    ctx.restore();

    // A chevron over the opponent, so a chase camera never loses it.
    const marker = Mini3D.screenPoint({ x: foe.x, y: 2.2, z: foe.z }, cam, W, H, 300);
    if(marker && marker.x > 0 && marker.x < W){
      ctx.save();
      ctx.fillStyle = 'rgba(255,84,84,0.9)';
      ctx.beginPath();
      ctx.moveTo(marker.x, marker.y);
      ctx.lineTo(marker.x - 7, marker.y - 11);
      ctx.lineTo(marker.x + 7, marker.y - 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawAbilities();

    if(banner){
      ctx.save();
      ctx.font = 'bold 26px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffc857';
      ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 16;
      ctx.fillText(banner, W/2, 52);
      ctx.restore();
    }

    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(232,236,241,0.55)';
    const s = me.s;
    ctx.fillText(`${s.dps.toFixed(0)} dps · ${s.fireRate.toFixed(1)}/s · ${s.speed.toFixed(1)} spd`, W-14, 24);
    ctx.fillText(`${me.parts.filter(p=>!p.broken).length}/${me.parts.length} parts`, W-14, 40);
    ctx.textAlign = 'left';
    ctx.fillText('W/S drive · A/D turn · SPACE fire · 1-5 abilities', 14, H-14);
    ctx.restore();
  }

  function onKeyPress(name){
    if(drafting){
      const n = parseInt(name, 10);
      if(n >= 1 && n <= 3) takePart(n - 1);
      return;
    }
    const sy = activeSynergies(me.parts).find(s => s.key === name);
    if(sy) useAbility(sy);
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('robot-setup').classList.add('hidden');
    document.getElementById('robot-result').classList.add('hidden');
    document.getElementById('robot-draft').classList.add('hidden');
    document.getElementById('robot-play').classList.remove('hidden');
    round = 1; wins = 0; frame = 0;
    me = null;
    cooldowns = {}; buffs = {};
    freshFight();
    paused = false; running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){
    running = false; paused = false;
    if(rafId) cancelAnimationFrame(rafId);
    const d = document.getElementById('robot-draft');
    if(d) d.classList.add('hidden');
  }
  function reset(){
    stop();
    document.getElementById('robot-setup').classList.remove('hidden');
    document.getElementById('robot-play').classList.add('hidden');
    document.getElementById('robot-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return { start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning, takePart };
})();
