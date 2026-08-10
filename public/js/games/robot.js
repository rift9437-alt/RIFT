/* =========================================================
   GAME: ROBOT ARENA
   =========================================================
   Build a robot from three parts, then fight with it. The parts you pick
   genuinely change how it plays — a heavy chassis with a hammer handles
   nothing like a light frame with a laser. */
const RobotGame = (function(){
  const canvas = document.getElementById('robot-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const CHASSIS = {
    light:  { name:'Light Frame',  hp:70,  speed:3.4, turn:0.085, color:'#45ffb0', size:20 },
    medium: { name:'Medium Frame', hp:100, speed:2.6, turn:0.066, color:'#4cb8ff', size:24 },
    heavy:  { name:'Heavy Frame',  hp:145, speed:1.9, turn:0.046, color:'#ffc857', size:29 }
  };
  const WEAPONS = {
    laser:  { name:'Laser',   dmg:7,  cool:26, range:280, speed:9,  spread:0,    color:'#ff6ad5' },
    cannon: { name:'Cannon',  dmg:19, cool:62, range:230, speed:6,  spread:0.04, color:'#ffc857' },
    shotgun:{ name:'Scatter', dmg:5,  cool:54, range:150, speed:7,  spread:0.28, pellets:4, color:'#ff8a3d' }
  };
  const CORES = {
    power:  { name:'Power Core',  dmgMult:1.35, hpMult:1,    speedMult:1,    color:'#ff5454' },
    guard:  { name:'Guard Core',  dmgMult:1,    hpMult:1.4,  speedMult:0.92, color:'#4cb8ff' },
    turbo:  { name:'Turbo Core',  dmgMult:0.9,  hpMult:0.9,  speedMult:1.35, color:'#45ffb0' }
  };

  // Same shape as Tank Duel's difficulty table: the opponent's reflexes and
  // aim are what scale, not its stat sheet.
  const DIFFS = {
    easy:   { cool:1.9, aimWindow:0.20, speed:0.72, turn:0.60, lead:0,    jitter:0.13, buff:0.10 },
    medium: { cool:1.3, aimWindow:0.30, speed:0.88, turn:0.82, lead:0.5,  jitter:0.06, buff:0.14 },
    hard:   { cool:1.0, aimWindow:0.42, speed:1.00, turn:1.00, lead:1,    jitter:0.02, buff:0.20 }
  };
  let difficulty = 'easy';

  let build = { chassis:'medium', weapon:'laser', core:'power' };

  let rafId=null, running=false, paused=false;
  const ROUND_GRACE = 50;      // frames before either bot may fire
  const TURRET_TRAVERSE = 0.5; // rad the gun can swing off the chassis line
  const TURRET_SLEW = 0.085;   // rad/frame the gun tracks at
  let me, foe, shots, particles, round, wins, frame, shake, banner;
  let intermission, grace;

  function setPart(kind, id){
    build[kind] = id;
    ['chassis','weapon','core'].forEach(k=>{
      const table = k === 'chassis' ? CHASSIS : (k === 'weapon' ? WEAPONS : CORES);
      Object.keys(table).forEach(optId=>{
        const el = document.getElementById(`robot-${k}-${optId}`);
        if(el) el.classList.toggle('selected', build[k] === optId);
      });
    });
    renderPreview();
    Sfx.play('click');
  }

  function setDifficulty(d){
    if(!DIFFS[d]) return;
    difficulty = d;
    Object.keys(DIFFS).forEach(k=>{
      const el = document.getElementById('robot-diff-' + k);
      if(el) el.classList.toggle('selected', k === d);
    });
    Sfx.play('click');
  }

  function statsFor(b){
    const c = CHASSIS[b.chassis], w = WEAPONS[b.weapon], k = CORES[b.core];
    return {
      hp: Math.round(c.hp * k.hpMult),
      speed: c.speed * k.speedMult,
      turn: c.turn,
      size: c.size,
      color: c.color,
      dmg: w.dmg * k.dmgMult,
      cool: w.cool,
      range: w.range,
      bulletSpeed: w.speed,
      spread: w.spread,
      pellets: w.pellets || 1,
      bulletColor: w.color,
      coreColor: k.color
    };
  }

  function renderPreview(){
    const s = statsFor(build);
    const box = document.getElementById('robot-preview');
    if(!box) return;
    box.innerHTML = `
      <div class="td-stat"><span>Hull</span><b>${s.hp}</b></div>
      <div class="td-stat"><span>Speed</span><b>${s.speed.toFixed(2)}</b></div>
      <div class="td-stat"><span>Damage</span><b>${s.dmg.toFixed(1)}${s.pellets>1?' ×'+s.pellets:''}</b></div>
      <div class="td-stat"><span>Fire rate</span><b>${(60/s.cool).toFixed(2)}/s</b></div>
      <div class="td-stat"><span>Range</span><b>${s.range}</b></div>`;
  }

  function makeRobot(x, y, b, facing){
    const s = statsFor(b);
    return { x, y, a: facing, turret: facing, hp: s.hp, maxHp: s.hp, cool: 0, s, hitFlash:0, think:0, strafe:1 };
  }

  function randomBuild(){
    const pick = o => Object.keys(o)[Math.floor(Math.random()*Object.keys(o).length)];
    return { chassis: pick(CHASSIS), weapon: pick(WEAPONS), core: pick(CORES) };
  }

  function freshFight(){
    // Damage carries between rounds — the +25% repair on a win is the only
    // healing you get, so a sloppy round costs you later. Round 1 always
    // starts at full hull, whatever the previous run left behind.
    const carriedHp = (round > 1 && me) ? me.hp : null;
    me = makeRobot(90, H/2, build, 0);
    if(carriedHp !== null) me.hp = clamp(carriedHp, 1, me.maxHp);
    // Round 1 is always the same readable opponent — a light laser scout —
    // so the opening fight teaches the controls instead of rolling a
    // point-blank scatter build that ends the run in four seconds. From
    // round 2 the build is random and gets a flat buff each win.
    const foeBuild = round === 1
      ? { chassis:'light', weapon:'laser', core:'guard' }
      : randomBuild();
    foe = makeRobot(W-90, H/2, foeBuild, Math.PI);
    const D = DIFFS[difficulty];
    const buff = 1 + (round-1) * D.buff;
    foe.maxHp = Math.round(foe.maxHp * buff);
    foe.hp = foe.maxHp;
    foe.s.dmg *= buff;
    foe.s.speed *= D.speed;
    foe.s.turn *= D.turn;
    // Reflexes, not raw stats: a slower trigger early on means the first
    // fights are about learning to aim rather than out-DPSing a machine.
    const reaction = round === 1 ? 1.4 : (round === 2 ? 1.15 : 1);
    foe.s.cool = Math.round(foe.s.cool * D.cool * reaction);
    foe.aimWindow = D.aimWindow;
    foe.lead = D.lead;
    foe.jitter = D.jitter;
    shots = [];
    particles = [];
    shake = 0;
    intermission = false;
    grace = ROUND_GRACE;
    banner = 'ROUND ' + round;
    updateHud(foeBuild);
  }

  function updateHud(foeBuild){
    document.getElementById('robot-round').textContent = round;
    document.getElementById('robot-hp').style.width = Math.max(0, me.hp/me.maxHp*100) + '%';
    document.getElementById('robot-foe-hp').style.width = Math.max(0, foe.hp/foe.maxHp*100) + '%';
    if(foeBuild){
      document.getElementById('robot-foe-build').textContent =
        `${CHASSIS[foeBuild.chassis].name} · ${WEAPONS[foeBuild.weapon].name} · ${CORES[foeBuild.core].name}`;
    }
  }

  // Signed angle from `from` to the bearing of t as seen from r, wrapped to
  // [-PI, PI]. `from` defaults to the chassis heading.
  function angleTo(r, t, from){
    return wrap(Math.atan2(t.y - r.y, t.x - r.x) - (from === undefined ? r.a : from));
  }
  function wrap(d){
    while(d > Math.PI) d -= Math.PI*2;
    while(d < -Math.PI) d += Math.PI*2;
    return d;
  }

  function fire(r, targetA){
    if(r.cool > 0) return;
    r.cool = r.s.cool;
    for(let i=0;i<r.s.pellets;i++){
      const a = targetA + (Math.random()-0.5) * r.s.spread * 2;
      shots.push({
        x: r.x + Math.cos(a)*r.s.size,
        y: r.y + Math.sin(a)*r.s.size,
        vx: Math.cos(a)*r.s.bulletSpeed,
        vy: Math.sin(a)*r.s.bulletSpeed,
        dmg: r.s.dmg,
        owner: r,
        life: r.s.range / r.s.bulletSpeed,
        color: r.s.bulletColor
      });
    }
    Sfx.play(r.s.pellets > 1 ? 'shoot' : 'laser', r === me ? 1 : 0.8);
  }

  function onKeyPress(name){}

  function update(){
    frame++;
    if(shake > 0) shake = Math.max(0, shake - 0.8);
    // Between rounds the wreck burns and nothing else moves — a dead
    // opponent must not keep shooting while the next fight spins up.
    if(intermission){
      for(let i=particles.length-1;i>=0;i--){
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vx *= 0.93; p.vy *= 0.93; p.life -= 0.04;
        if(p.life <= 0) particles.splice(i,1);
      }
      return;
    }
    if(grace > 0){
      grace--;
      if(grace === 0) banner = null;
    }
    if(me.cool > 0) me.cool--;
    if(foe.cool > 0) foe.cool--;
    if(me.hitFlash > 0) me.hitFlash--;
    if(foe.hitFlash > 0) foe.hitFlash--;

    // player
    if(keys.has('a') || keys.has('arrowleft')) me.a -= me.s.turn;
    if(keys.has('d') || keys.has('arrowright')) me.a += me.s.turn;
    let drive = 0;
    if(keys.has('w') || keys.has('arrowup')) drive = 1;
    if(keys.has('s') || keys.has('arrowdown')) drive = -0.6;
    const px = me.x, py = me.y;
    me.x = clamp(me.x + Math.cos(me.a)*me.s.speed*drive, me.s.size, W-me.s.size);
    me.y = clamp(me.y + Math.sin(me.a)*me.s.speed*drive, me.s.size, H-me.s.size);
    me.lastVx = me.x - px; me.lastVy = me.y - py;

    // The gun tracks the enemy on its own, but only within a cone off the
    // chassis line — so keeping the body pointed the right way is the skill,
    // not out-twitching a machine that can aim perfectly every frame.
    const goal = me.a + clamp(angleTo(me, foe), -TURRET_TRAVERSE, TURRET_TRAVERSE);
    me.turret = wrap(me.turret + clamp(wrap(goal - me.turret), -TURRET_SLEW, TURRET_SLEW));
    if(grace <= 0 && keys.has('space')) fire(me, me.turret);

    // opponent AI — closes to its own weapon range, then circles and shoots
    const dx = me.x - foe.x, dy = me.y - foe.y;
    const dist = Math.hypot(dx, dy);
    // Only the higher skill tiers lead the shot; easy fires at where you were.
    const travel = dist / foe.s.bulletSpeed * foe.lead;
    const want = Math.atan2(dy + (me.lastVy||0)*travel, dx + (me.lastVx||0)*travel);
    const diff = wrap(want - foe.a);
    foe.a += clamp(diff, -foe.s.turn, foe.s.turn);
    foe.turret = foe.a; // the opponent's gun is bolted to its chassis

    foe.think--;
    if(foe.think <= 0){ foe.think = 40 + Math.random()*50; foe.strafe = Math.random() < 0.5 ? 1 : -1; }
    // Never hug the player — a scatter bot at zero range is unbeatable.
    const ideal = Math.max(120, foe.s.range * 0.62);
    const forward = dist > ideal ? 1 : (dist < ideal*0.6 ? -0.7 : 0);
    foe.x = clamp(foe.x + Math.cos(foe.a)*foe.s.speed*forward
                        + Math.cos(foe.a + Math.PI/2)*foe.s.speed*0.5*foe.strafe, foe.s.size, W-foe.s.size);
    foe.y = clamp(foe.y + Math.sin(foe.a)*foe.s.speed*forward
                        + Math.sin(foe.a + Math.PI/2)*foe.s.speed*0.5*foe.strafe, foe.s.size, H-foe.s.size);
    if(grace <= 0 && dist < foe.s.range && Math.abs(diff) < foe.aimWindow)
      fire(foe, foe.a + (Math.random()-0.5) * foe.jitter * 2);

    // bullets
    for(let i=shots.length-1;i>=0;i--){
      const b = shots[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if(b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H){ shots.splice(i,1); continue; }
      const target = b.owner === me ? foe : me;
      if(Math.hypot(b.x-target.x, b.y-target.y) < target.s.size){
        target.hp -= b.dmg;
        target.hitFlash = 6;
        shake = b.dmg > 12 ? 10 : 5;
        for(let k=0;k<8;k++)
          particles.push({ x:b.x, y:b.y, vx:(Math.random()-0.5)*5, vy:(Math.random()-0.5)*5, life:1, color:b.color });
        shots.splice(i,1);
        Sfx.play('hit', 1.2);
        updateHud();
        if(target.hp <= 0){ endRound(target === foe); return; }
      }
    }

    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.93; p.vy *= 0.93; p.life -= 0.04;
      if(p.life <= 0) particles.splice(i,1);
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
      for(let i=0;i<30;i++)
        particles.push({ x:foe.x, y:foe.y, vx:(Math.random()-0.5)*9, vy:(Math.random()-0.5)*9, life:1, color:'#ffc857' });
      // Freeze the fight while the wreck burns, then rebuild the arena.
      intermission = true;
      shots = [];
      me.hp = Math.min(me.maxHp, me.hp + me.maxHp*0.25);
      updateHud();
      setTimeout(()=>{ if(running) freshFight(); }, 900);
    } else {
      gameOver();
    }
  }

  function gameOver(){
    running = false;
    updateStat('robot', [{stat:'bestRound', type:'max', value:wins}]);
    zipReactToScore('robot', 'bestRound', wins);
    Sfx.play('lose');
    document.getElementById('robot-result-text').textContent = wins > 0 ? 'DESTROYED' : 'SCRAPPED';
    document.getElementById('robot-result-sub').textContent =
      `You won ${wins} fight${wins===1?'':'s'} with a ${CHASSIS[build.chassis].name.toLowerCase()} / ${WEAPONS[build.weapon].name.toLowerCase()} / ${CORES[build.core].name.toLowerCase()} build.`;
    document.getElementById('robot-play').classList.add('hidden');
    document.getElementById('robot-result').classList.remove('hidden');
  }

  function drawRobot(r, isMe){
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.a);
    ctx.shadowColor = r.s.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = r.hitFlash > 0 ? '#ffffff' : r.s.color;
    ctx.beginPath();
    ctx.roundRect(-r.s.size*0.8, -r.s.size*0.7, r.s.size*1.6, r.s.size*1.4, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
    // core glow
    ctx.fillStyle = r.s.coreColor;
    ctx.beginPath(); ctx.arc(0, 0, r.s.size*0.28, 0, Math.PI*2); ctx.fill();
    // treads
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-r.s.size*0.8, -r.s.size*0.85, r.s.size*1.6, 5);
    ctx.fillRect(-r.s.size*0.8, r.s.size*0.6, r.s.size*1.6, 5);
    ctx.restore();

    // The barrel sits on its own mount, so it reads as pointing where the
    // shot will actually go.
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.turret === undefined ? r.a : r.turret);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(r.s.size*0.2, -3.5, r.s.size*1.2, 7);
    ctx.restore();

    // hp pip
    const w = r.s.size*2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(r.x-w/2, r.y-r.s.size-14, w, 4);
    ctx.fillStyle = isMe ? '#45ffb0' : '#ff5454';
    ctx.fillRect(r.x-w/2, r.y-r.s.size-14, w*Math.max(0, r.hp/r.maxHp), 4);
  }

  function render(){
    ctx.save();
    if(settings.shake && shake > 0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(-30,-30,W+60,H+60);
    ctx.strokeStyle = 'rgba(120,150,220,0.08)';
    for(let x=0;x<W;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for(let y=0;y<H;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    // arena ring
    ctx.strokeStyle = 'rgba(255,200,87,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, W-28, H-28);

    shots.forEach(b=>{
      ctx.save();
      ctx.shadowColor = b.color; ctx.shadowBlur = 12;
      ctx.strokeStyle = b.color; ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx*1.6, b.y - b.vy*1.6);
      ctx.stroke();
      ctx.restore();
    });

    // Aim ray — the shot goes exactly where this line points, and it lights
    // up when the barrel is actually on target.
    if(me.hp > 0){
      const onTarget = Math.abs(angleTo(me, foe, me.turret)) <
                       Math.atan2(foe.s.size, Math.hypot(foe.x-me.x, foe.y-me.y));
      ctx.save();
      ctx.setLineDash([6, 7]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = onTarget ? 'rgba(255,200,87,0.8)' : 'rgba(232,236,241,0.22)';
      ctx.beginPath();
      ctx.moveTo(me.x + Math.cos(me.turret)*me.s.size, me.y + Math.sin(me.turret)*me.s.size);
      ctx.lineTo(me.x + Math.cos(me.turret)*(me.s.size + me.s.range),
                 me.y + Math.sin(me.turret)*(me.s.size + me.s.range));
      ctx.stroke();
      ctx.restore();
      if(onTarget && grace <= 0){
        ctx.save();
        ctx.strokeStyle = 'rgba(255,200,87,0.95)';
        ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 10;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(foe.x, foe.y, foe.s.size + 8, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }
    }

    drawRobot(foe, false);
    drawRobot(me, true);

    particles.forEach(p=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    });
    ctx.restore();

    if(grace > 0){
      ctx.save();
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(232,236,241,0.7)';
      ctx.fillText('WEAPONS HOT IN ' + Math.ceil(grace/60*10)/10 + 's', W/2, 92);
      ctx.restore();
    }

    if(banner){
      ctx.save();
      ctx.font = 'bold 26px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffc857';
      ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 16;
      ctx.fillText(banner, W/2, 62);
      ctx.restore();
    }

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.fillText('W/S drive · A/D turn · SPACE fire', 14, H-12);
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
    document.getElementById('robot-play').classList.remove('hidden');
    round = 1; wins = 0; frame = 0;
    freshFight();
    paused = false; running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    setPart('chassis', build.chassis);
    document.getElementById('robot-setup').classList.remove('hidden');
    document.getElementById('robot-play').classList.add('hidden');
    document.getElementById('robot-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning, setPart, setDifficulty};
})();
