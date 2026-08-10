/* =========================================================
   GAME: TAG ARENA
   =========================================================
   One player is "it". Tag the other to pass it on. Whoever spends the
   least time as "it" over the round wins. Local multiplayer or a bot. */
const TagGame = (function(){
  const canvas = document.getElementById('tag-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const R = 18;
  const ACCEL = 0.62;
  const FRICTION = 0.90;
  const MAX_SPEED = 5.2;
  const IT_BOOST = 1.16;          // being "it" is slightly faster, or nobody gets caught
  const TAG_COOLDOWN = 60;        // frames before a tag-back is allowed
  const ROUND_SECONDS = 60;

  const DIFFS = {
    easy:   { label:'EASY',   react:0.5, cut:0.25 },
    medium: { label:'MEDIUM', react:0.8, cut:0.55 },
    hard:   { label:'HARD',   react:1.0, cut:0.85 }
  };
  let mode = 'single';
  let difficulty = 'medium';

  let rafId=null, running=false, paused=false;
  let p1, p2, obstacles, powerups, itIs, cooldown, timeLeft, frame, particles, shake, banner;

  function setMode(m){
    mode = m;
    document.getElementById('tag-mode-single').classList.toggle('selected', m==='single');
    document.getElementById('tag-mode-multi').classList.toggle('selected', m==='multi');
    document.getElementById('tag-diff-section').classList.toggle('hidden', m!=='single');
    document.getElementById('tag-p2-label').textContent = m==='single' ? 'BOT' : 'PLAYER 2';
  }
  function setDifficulty(d){
    difficulty = d;
    ['easy','medium','hard'].forEach(k=>{
      document.getElementById('tag-diff-'+k).classList.toggle('selected', k===d);
    });
  }

  function freshState(){
    p1 = { x: 110, y: H/2, vx:0, vy:0, itTime:0, color:'#2de2c5', dash:0, stam:100 };
    p2 = { x: W-110, y: H/2, vx:0, vy:0, itTime:0, color:'#ff3d8a', dash:0, stam:100 };
    obstacles = [];
    for(let i=0;i<5;i++){
      obstacles.push({
        x: 120 + Math.random()*(W-240),
        y: 60 + Math.random()*(H-120),
        r: 26 + Math.random()*22
      });
    }
    powerups = [];
    itIs = Math.random() < 0.5 ? p1 : p2;
    cooldown = TAG_COOLDOWN;
    timeLeft = ROUND_SECONDS;
    frame = 0;
    particles = [];
    shake = 0;
    banner = 'GO!';
    setTimeout(()=>{ banner = null; }, 900);
    updateHud();
  }

  function updateHud(){
    document.getElementById('tag-time').textContent = Math.max(0, Math.ceil(timeLeft)) + 's';
    document.getElementById('tag-p1-time').textContent = Math.round(p1.itTime/60) + 's';
    document.getElementById('tag-p2-time').textContent = Math.round(p2.itTime/60) + 's';
    document.getElementById('tag-p1-stam').style.width = Math.max(0, p1.stam) + '%';
    document.getElementById('tag-p2-stam').style.width = Math.max(0, p2.stam) + '%';
  }

  function drive(p, ax, ay, dash){
    const isIt = p === itIs;
    const boost = isIt ? IT_BOOST : 1;
    const len = Math.hypot(ax, ay);
    if(len > 0){
      p.vx += (ax/len) * ACCEL * boost;
      p.vy += (ay/len) * ACCEL * boost;
    }
    if(dash && p.stam >= 30 && p.dash <= 0){
      const l = Math.hypot(p.vx, p.vy) || 1;
      p.vx += (p.vx/l) * 8;
      p.vy += (p.vy/l) * 8;
      p.stam -= 30;
      p.dash = 22;
      Sfx.play('whoosh');
    }
    if(p.dash > 0) p.dash--;
    p.stam = Math.min(100, p.stam + 0.32);

    p.vx *= FRICTION; p.vy *= FRICTION;
    const sp = Math.hypot(p.vx, p.vy);
    const cap = MAX_SPEED * boost * (p.dash > 0 ? 2.1 : 1);
    if(sp > cap){ p.vx = p.vx/sp*cap; p.vy = p.vy/sp*cap; }

    p.x += p.vx; p.y += p.vy;

    // walls
    if(p.x < R){ p.x = R; p.vx = Math.abs(p.vx)*0.5; }
    if(p.x > W-R){ p.x = W-R; p.vx = -Math.abs(p.vx)*0.5; }
    if(p.y < R){ p.y = R; p.vy = Math.abs(p.vy)*0.5; }
    if(p.y > H-R){ p.y = H-R; p.vy = -Math.abs(p.vy)*0.5; }

    // obstacles
    obstacles.forEach(o=>{
      const d = Math.hypot(p.x-o.x, p.y-o.y);
      if(d < o.r + R){
        const nx = (p.x-o.x)/d, ny = (p.y-o.y)/d;
        p.x = o.x + nx*(o.r+R);
        p.y = o.y + ny*(o.r+R);
        const dot = p.vx*nx + p.vy*ny;
        p.vx -= 1.6*dot*nx; p.vy -= 1.6*dot*ny;
      }
    });
  }

  function botInput(){
    const cfg = DIFFS[difficulty];
    const chasing = itIs === p2;
    const target = p1;
    let ax = target.x - p2.x, ay = target.y - p2.y;
    if(!chasing){ ax = -ax; ay = -ay; }
    // Lead the target a little when chasing; hug walls less when fleeing.
    if(chasing){
      ax += target.vx * 8 * cfg.cut;
      ay += target.vy * 8 * cfg.cut;
    } else {
      ax += (W/2 - p2.x) * 0.35;
      ay += (H/2 - p2.y) * 0.35;
    }
    const jitter = (1 - cfg.react) * 140;
    ax += (Math.random()-0.5)*jitter;
    ay += (Math.random()-0.5)*jitter;
    const dist = Math.hypot(target.x-p2.x, target.y-p2.y);
    const dash = chasing ? (dist < 130 && Math.random() < cfg.cut*0.08)
                         : (dist < 70 && Math.random() < cfg.cut*0.1);
    return { ax, ay, dash };
  }

  function onKeyPress(name){}

  function update(){
    frame++;
    timeLeft -= 1/60;
    if(shake > 0) shake = Math.max(0, shake - 0.8);
    if(cooldown > 0) cooldown--;
    itIs.itTime++;

    if(timeLeft <= 0){ endMatch(); return; }

    let a1x = 0, a1y = 0;
    if(keys.has('a')) a1x -= 1;
    if(keys.has('d')) a1x += 1;
    if(keys.has('w')) a1y -= 1;
    if(keys.has('s')) a1y += 1;
    drive(p1, a1x, a1y, keys.has('space'));

    if(mode === 'multi'){
      let a2x = 0, a2y = 0;
      if(keys.has('arrowleft')) a2x -= 1;
      if(keys.has('arrowright')) a2x += 1;
      if(keys.has('arrowup')) a2y -= 1;
      if(keys.has('arrowdown')) a2y += 1;
      drive(p2, a2x, a2y, keys.has('enter'));
    } else {
      const b = botInput();
      drive(p2, b.ax, b.ay, b.dash);
    }

    // tag
    const d = Math.hypot(p1.x-p2.x, p1.y-p2.y);
    if(d < R*2 && cooldown <= 0){
      itIs = (itIs === p1) ? p2 : p1;
      cooldown = TAG_COOLDOWN;
      shake = 14;
      banner = 'TAGGED!';
      setTimeout(()=>{ if(banner === 'TAGGED!') banner = null; }, 700);
      for(let i=0;i<20;i++)
        particles.push({ x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2, vx:(Math.random()-0.5)*8, vy:(Math.random()-0.5)*8, life:1, color:'#ffc857' });
      Sfx.play('hit');
      // push them apart so it doesn't instantly re-tag
      const nx = (p2.x-p1.x)/(d||1), ny = (p2.y-p1.y)/(d||1);
      p1.x -= nx*14; p1.y -= ny*14;
      p2.x += nx*14; p2.y += ny*14;
    }

    // power pads restore stamina
    if(powerups.length < 2 && Math.random() < 0.006){
      powerups.push({ x: 60 + Math.random()*(W-120), y: 60 + Math.random()*(H-120), phase: 0 });
    }
    for(let i=powerups.length-1;i>=0;i--){
      const pu = powerups[i];
      pu.phase += 0.08;
      [p1,p2].forEach(p=>{
        if(powerups.indexOf(pu) >= 0 && Math.hypot(pu.x-p.x, pu.y-p.y) < R + 12){
          p.stam = 100;
          powerups.splice(powerups.indexOf(pu), 1);
          Sfx.play('coin');
        }
      });
    }

    for(let i=particles.length-1;i>=0;i--){
      const q = particles[i];
      q.x += q.vx; q.y += q.vy; q.vx *= 0.93; q.vy *= 0.93; q.life -= 0.03;
      if(q.life <= 0) particles.splice(i,1);
    }
    updateHud();
  }

  function endMatch(){
    running = false;
    const p1Won = p1.itTime < p2.itTime;
    updateStat('tag', [{stat:'wins', type:'increment_if', value:1, cond:p1Won}]);
    earnTokens(p1Won ? 'tag_win' : 'tag_loss', 1);
    showZipCompanion(p1Won ? 'win' : 'loss');
    Sfx.play(p1Won ? 'win' : 'lose');
    document.getElementById('tag-result-text').textContent =
      p1Won ? 'YOU STAYED FREE!' : (mode==='single' ? 'THE BOT OUTRAN YOU' : 'PLAYER 2 WINS');
    document.getElementById('tag-result-sub').textContent =
      `Time as "it" — you ${Math.round(p1.itTime/60)}s, ` +
      `${mode==='single'?'bot':'P2'} ${Math.round(p2.itTime/60)}s.`;
    document.getElementById('tag-play').classList.add('hidden');
    document.getElementById('tag-result').classList.remove('hidden');
  }

  function drawPlayer(p, label){
    const isIt = p === itIs;
    ctx.save();
    if(isIt){
      ctx.strokeStyle = '#ffc857';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffc857';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R + 8 + Math.sin(frame*0.2)*2, 0, Math.PI*2);
      ctx.stroke();
    }
    if(p.dash > 0){
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x - p.vx*1.6, p.y - p.vy*1.6, R*0.85, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 18;
    const g = ctx.createRadialGradient(p.x-6, p.y-7, 3, p.x, p.y, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, p.color);
    g.addColorStop(1, Mini3D.shade(p.color, 0.4));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(4,6,10,0.8)';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isIt ? 'IT' : label, p.x, p.y);
    ctx.restore();
  }

  function render(){
    ctx.save();
    if(settings.shake && shake > 0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

    const bg = ctx.createRadialGradient(W/2, H/2, 40, W/2, H/2, W*0.72);
    bg.addColorStop(0, '#141a2e');
    bg.addColorStop(1, '#05070f');
    ctx.fillStyle = bg;
    ctx.fillRect(-30,-30,W+60,H+60);

    ctx.strokeStyle = 'rgba(120,150,220,0.07)';
    for(let x=0;x<W;x+=34){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for(let y=0;y<H;y+=34){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    obstacles.forEach(o=>{
      ctx.save();
      ctx.shadowColor = '#4a5a80';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#22304d';
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(150,190,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    });

    powerups.forEach(pu=>{
      ctx.save();
      ctx.translate(pu.x, pu.y);
      ctx.rotate(pu.phase);
      ctx.shadowColor = '#45ffb0';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#8dffcf';
      ctx.beginPath();
      for(let i=0;i<4;i++){
        const a = (i/4)*Math.PI*2;
        const x = Math.cos(a)*10, y = Math.sin(a)*10;
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    particles.forEach(q=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.shadowColor = q.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    });

    drawPlayer(p1, 'P1');
    drawPlayer(p2, mode==='single' ? 'AI' : 'P2');
    ctx.restore();

    if(banner){
      ctx.save();
      ctx.font = 'bold 30px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffc857';
      ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 18;
      ctx.fillText(banner, W/2, H/2 - 60);
      ctx.restore();
    }

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.fillText('LEAST TIME AS "IT" WINS · SPACE/ENTER to dash', 14, H-12);
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('tag-setup').classList.add('hidden');
    document.getElementById('tag-result').classList.add('hidden');
    document.getElementById('tag-play').classList.remove('hidden');
    freshState();
    paused = false; running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    setMode(mode); setDifficulty(difficulty);
    document.getElementById('tag-setup').classList.remove('hidden');
    document.getElementById('tag-play').classList.add('hidden');
    document.getElementById('tag-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  setMode(mode); setDifficulty(difficulty);
  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning, setMode, setDifficulty};
})();
