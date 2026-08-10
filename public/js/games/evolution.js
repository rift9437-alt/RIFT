/* =========================================================
   GAME: EVOLUTION
   =========================================================
   Start as a speck. Eat DNA to grow, evolve through stages, and avoid
   anything currently bigger than you. Which upgrades you pick at each
   evolution shapes the run — speed, size or appetite. */
const EvolutionGame = (function(){
  const canvas = document.getElementById('evolution-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const STAGES = [
    { name:'Microbe',   radius:7,  color:'#45ffb0', need:6 },
    { name:'Amoeba',    radius:11, color:'#2de2c5', need:14 },
    { name:'Larva',     radius:15, color:'#4cb8ff', need:26 },
    { name:'Crawler',   radius:20, color:'#8b6dff', need:42 },
    { name:'Prowler',   radius:26, color:'#c9a6ff', need:64 },
    { name:'Hunter',    radius:32, color:'#ff6ad5', need:92 },
    { name:'Apex',      radius:40, color:'#ffc857', need:Infinity }
  ];

  const TRAITS = [
    { id:'speed',    icon:'⚡', name:'Fast Twitch', desc:'+18% movement speed' },
    { id:'appetite', icon:'🍽', name:'Appetite',    desc:'DNA is worth +1 each' },
    { id:'armour',   icon:'🛡', name:'Carapace',    desc:'Survive one predator hit' },
    { id:'reach',    icon:'🧲', name:'Cilia',       desc:'Pull nearby DNA toward you' }
  ];

  let rafId=null, running=false, paused=false;
  const SPAWN_SAFE_RADIUS = 210; // predators never appear this close to you
  const SPAWN_GRACE = 150;       // ~2.5s of invulnerability on a fresh run
  let me, dna, predators, particles, stage, eaten, traits, shields, evolving, choiceTraits;
  let frame, best, shake, grace;

  function freshState(){
    me = { x:W/2, y:H/2, vx:0, vy:0 };
    dna = [];
    predators = [];
    particles = [];
    stage = 0;
    eaten = 0;
    traits = [];
    shields = 0;
    evolving = false;
    choiceTraits = [];
    frame = 0;
    shake = 0;
    grace = SPAWN_GRACE;
    for(let i=0;i<26;i++) spawnDna();
    // Only two to start, and neither may outsize a fresh microbe — the first
    // stage is for learning to feed, not for dodging three predators at once.
    for(let i=0;i<2;i++) spawnPredator(true);
    updateHud();
  }

  function radius(){
    return STAGES[stage].radius * (traits.includes('armour') ? 1.05 : 1);
  }
  function speed(){
    return (2.9 - stage*0.16) * (traits.includes('speed') ? 1.18 : 1);
  }

  function spawnDna(){
    dna.push({ x: 20 + Math.random()*(W-40), y: 20 + Math.random()*(H-40),
               phase: Math.random()*Math.PI*2 });
  }

  function spawnPredator(harmless){
    // Predators are sized around the player's current stage — some edible,
    // some lethal, so the threat changes as you grow. `harmless` forces a
    // smaller-than-you roll, used to seed a survivable opening.
    const step = harmless ? -1 : (Math.random()<0.5 ? -1 : 1);
    const s = Math.max(0, Math.min(STAGES.length-1, stage + step));
    let x, y, tries = 0;
    do {
      const edge = Math.floor(Math.random()*4);
      x = edge===0?-20 : edge===1?W+20 : Math.random()*W;
      y = edge===2?-20 : edge===3?H+20 : Math.random()*H;
    } while(me && Math.hypot(x-me.x, y-me.y) < SPAWN_SAFE_RADIUS && ++tries < 12);
    predators.push({
      x, y,
      r: STAGES[s].radius * (0.85 + Math.random()*0.4) * (harmless ? 0.8 : 1),
      color: STAGES[s].color,
      vx:0, vy:0,
      wander: Math.random()*Math.PI*2
    });
  }

  function updateHud(){
    document.getElementById('evolution-stage').textContent = STAGES[stage].name;
    document.getElementById('evolution-dna').textContent = eaten;
    const need = STAGES[stage].need;
    document.getElementById('evolution-next').textContent =
      need === Infinity ? 'MAX' : (need - eaten) + ' to evolve';
  }

  function burst(x,y,color,n){
    for(let i=0;i<(n||10);i++){
      particles.push({ x, y, vx:(Math.random()-0.5)*5, vy:(Math.random()-0.5)*5, life:1, color });
    }
  }

  /* ---- evolution choice ---- */
  function offerEvolution(){
    evolving = true;
    const pool = TRAITS.filter(t => !traits.includes(t.id));
    if(!pool.length){ finishEvolution(); return; }
    choiceTraits = pool.sort(()=>Math.random()-0.5).slice(0, Math.min(3, pool.length));
    const box = document.getElementById('evolution-choice');
    box.innerHTML = `<div class="evo-title">EVOLVED — ${STAGES[stage].name}</div>` +
      choiceTraits.map((t,i)=>
        `<button class="evo-card" onclick="EvolutionGame.pickTrait(${i})">
           <span class="evo-icon">${t.icon}</span>
           <span><b>${t.name}</b><br><span class="evo-desc">${t.desc}</span></span>
           <span class="evo-key">${i+1}</span>
         </button>`).join('');
    box.classList.remove('hidden');
    Sfx.play('perfect');
  }

  function pickTrait(i){
    const t = choiceTraits[i];
    if(t){
      traits.push(t.id);
      if(t.id === 'armour') shields++;
      toast('Evolved', t.name + ' — ' + t.desc, t.icon, 'gold');
    }
    finishEvolution();
  }

  function finishEvolution(){
    evolving = false;
    document.getElementById('evolution-choice').classList.add('hidden');
    burst(me.x, me.y, STAGES[stage].color, 30);
    shake = 12;
    // The world gets more dangerous with each stage.
    for(let i=0;i<(stage < 3 ? 1 : 2);i++) spawnPredator();
  }

  function onKeyPress(name){
    if(evolving){
      const n = parseInt(name, 10);
      if(n >= 1 && n <= choiceTraits.length) pickTrait(n-1);
    }
  }

  function update(){
    frame++;
    if(shake > 0) shake = Math.max(0, shake - 0.7);
    if(grace > 0) grace--;
    if(evolving) return;

    // movement
    let dx = 0, dy = 0;
    if(keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if(keys.has('d') || keys.has('arrowright')) dx += 1;
    if(keys.has('w') || keys.has('arrowup')) dy -= 1;
    if(keys.has('s') || keys.has('arrowdown')) dy += 1;
    const len = Math.hypot(dx, dy) || 1;
    me.vx += (dx/len) * speed() * 0.35;
    me.vy += (dy/len) * speed() * 0.35;
    me.vx *= 0.86; me.vy *= 0.86;
    me.x = clamp(me.x + me.vx, radius(), W - radius());
    me.y = clamp(me.y + me.vy, radius(), H - radius());

    // DNA
    for(let i=dna.length-1;i>=0;i--){
      const d = dna[i];
      if(traits.includes('reach')){
        const dist = Math.hypot(d.x-me.x, d.y-me.y);
        if(dist < 90){
          d.x += (me.x-d.x) * 0.06;
          d.y += (me.y-d.y) * 0.06;
        }
      }
      if(Math.hypot(d.x-me.x, d.y-me.y) < radius() + 9){
        dna.splice(i,1);
        eaten += traits.includes('appetite') ? 2 : 1;
        burst(d.x, d.y, '#45ffb0', 6);
        Sfx.play('coin', 1.4);
        spawnDna();
        if(eaten >= STAGES[stage].need && stage < STAGES.length-1){
          stage++;
          offerEvolution();
        }
        updateHud();
      }
    }

    // predators — walked backwards because eating one removes it mid-loop
    for(let pi=predators.length-1; pi>=0; pi--){
      const p = predators[pi];
      const toMe = Math.atan2(me.y-p.y, me.x-p.x);
      const iAmBigger = radius() > p.r;
      // Bigger things chase you; smaller things flee.
      const dir = iAmBigger ? toMe + Math.PI : toMe;
      p.wander += (Math.random()-0.5)*0.3;
      const drive = Math.hypot(p.x-me.x, p.y-me.y) < 220 ? dir : p.wander;
      p.vx += Math.cos(drive) * 0.14;
      p.vy += Math.sin(drive) * 0.14;
      p.vx *= 0.94; p.vy *= 0.94;
      p.x = clamp(p.x + p.vx, -40, W+40);
      p.y = clamp(p.y + p.vy, -40, H+40);

      const d = Math.hypot(p.x-me.x, p.y-me.y);
      if(d < radius() + p.r*0.7){
        if(iAmBigger){
          eaten += 3;
          burst(p.x, p.y, p.color, 18);
          Sfx.play('explode', 1.2);
          shake = 8;
          predators.splice(pi, 1);
          spawnPredator();
          if(eaten >= STAGES[stage].need && stage < STAGES.length-1){ stage++; offerEvolution(); }
          updateHud();
        } else if(grace > 0){
          // Shove it away rather than killing during the opening grace.
          p.x += Math.cos(toMe)*140; p.y += Math.sin(toMe)*140;
        } else if(shields > 0){
          shields--;
          burst(me.x, me.y, '#ffc857', 20);
          shake = 14;
          Sfx.play('hit');
          p.x += Math.cos(toMe)*120; p.y += Math.sin(toMe)*120;
          toast('Carapace held', 'One hit absorbed', '🛡', 'gold');
        } else {
          gameOver();
          return;
        }
      }
    }

    for(let i=particles.length-1;i>=0;i--){
      const q = particles[i];
      q.x += q.vx; q.y += q.vy; q.vx *= 0.94; q.vy *= 0.94; q.life -= 0.035;
      if(q.life <= 0) particles.splice(i,1);
    }
  }

  function gameOver(){
    running = false;
    updateStat('evolution', [{stat:'bestStage', type:'max', value:stage+1}]);
    zipReactToScore('evolution', 'bestStage', stage+1);
    if(eaten > 0) earnTokens('evolution_dna', eaten);
    Sfx.play('lose');
    document.getElementById('evolution-result-text').textContent = 'CONSUMED';
    document.getElementById('evolution-result-sub').textContent =
      `You reached ${STAGES[stage].name} on ${eaten} DNA` +
      (traits.length ? ` with ${traits.length} trait${traits.length===1?'':'s'}.` : '.');
    document.getElementById('evolution-play').classList.add('hidden');
    document.getElementById('evolution-result').classList.remove('hidden');
    document.getElementById('evolution-choice').classList.add('hidden');
  }

  function render(){
    ctx.save();
    if(settings.shake && shake > 0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

    const g = ctx.createRadialGradient(W/2, H/2, 30, W/2, H/2, W*0.7);
    g.addColorStop(0, '#0a1a16');
    g.addColorStop(1, '#04070a');
    ctx.fillStyle = g;
    ctx.fillRect(-30,-30,W+60,H+60);

    // drifting motes
    ctx.fillStyle = 'rgba(120,220,190,0.10)';
    for(let i=0;i<40;i++){
      const x = (i*137 + frame*0.3) % W, y = (i*79 + Math.sin(frame*0.01+i)*20) % H;
      ctx.fillRect(x, y, 2, 2);
    }

    dna.forEach(d=>{
      const pulse = 3 + Math.sin(frame*0.08 + d.phase)*1.2;
      ctx.save();
      ctx.shadowColor = '#45ffb0';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#8dffcf';
      ctx.beginPath();
      ctx.arc(d.x, d.y, pulse, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });

    predators.forEach(p=>{
      const bigger = radius() > p.r;
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = bigger ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = bigger ? 'rgba(255,255,255,0.35)' : '#ffffff';
      ctx.lineWidth = bigger ? 1 : 2;
      ctx.stroke();
      // eyes point at the player
      const a = Math.atan2(me.y-p.y, me.x-p.x);
      ctx.fillStyle = '#04070a';
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a)*p.r*0.4, p.y + Math.sin(a)*p.r*0.4, Math.max(1.5, p.r*0.17), 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });

    // player
    ctx.save();
    ctx.shadowColor = STAGES[stage].color;
    ctx.shadowBlur = 22;
    const pg = ctx.createRadialGradient(me.x-radius()*0.3, me.y-radius()*0.3, 2, me.x, me.y, radius());
    pg.addColorStop(0, '#ffffff');
    pg.addColorStop(0.5, STAGES[stage].color);
    pg.addColorStop(1, Mini3D.shade(STAGES[stage].color, 0.45));
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(me.x, me.y, radius(), 0, Math.PI*2);
    ctx.fill();
    if(grace > 0){
      // Opening grace — visible so it's obvious when it runs out.
      ctx.strokeStyle = 'rgba(125,211,255,' + (0.35 + 0.35*Math.sin(frame*0.25)).toFixed(2) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(me.x, me.y, radius()+12, 0, Math.PI*2);
      ctx.stroke();
    }
    if(shields > 0){
      ctx.strokeStyle = '#ffc857';
      ctx.lineWidth = 2;
      ctx.setLineDash([5,5]);
      ctx.beginPath();
      ctx.arc(me.x, me.y, radius()+7, 0, Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    particles.forEach(q=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.shadowColor = q.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2.6, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('EAT SMALLER · AVOID BIGGER · ' + (traits.length ? traits.join(' · ').toUpperCase() : 'NO TRAITS'), 14, H-14);
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('evolution-setup').classList.add('hidden');
    document.getElementById('evolution-result').classList.add('hidden');
    document.getElementById('evolution-play').classList.remove('hidden');
    freshState();
    paused = false; running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('evolution-setup').classList.remove('hidden');
    document.getElementById('evolution-play').classList.add('hidden');
    document.getElementById('evolution-result').classList.add('hidden');
    document.getElementById('evolution-choice').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning, pickTrait};
})();
