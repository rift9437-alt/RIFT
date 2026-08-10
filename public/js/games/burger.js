/* =========================================================
   GAME: BURGER RUSH
   =========================================================
   Orders queue up with a patience timer. Build each one bottom-up in the
   right order, serve it before the customer walks, and don't let three
   walk out. */
const BurgerGame = (function(){
  const canvas = document.getElementById('burger-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // key -> ingredient. Bottom bun is automatic; top bun serves the order.
  const ING = {
    '1': { id:'patty',   name:'Patty',   color:'#8b5a2b', h:12 },
    '2': { id:'cheese',  name:'Cheese',  color:'#ffc857', h:6  },
    '3': { id:'lettuce', name:'Lettuce', color:'#45ffb0', h:7  },
    '4': { id:'tomato',  name:'Tomato',  color:'#ff5454', h:7  },
    '5': { id:'onion',   name:'Onion',   color:'#c9a6ff', h:6  },
    '6': { id:'bacon',   name:'Bacon',   color:'#ff8a3d', h:6  }
  };
  const ORDER_POOL = Object.values(ING).map(i=>i.id);
  const MAX_LIVES = 3;

  let rafId=null, running=false, paused=false;
  let orders, stack, served, lives, combo, bestCombo, frame, message, messageTimer;
  let spawnTimer, difficulty, particles, shake;

  function freshState(){
    orders = [];
    stack = [];
    served = 0;
    lives = MAX_LIVES;
    combo = 0; bestCombo = 0;
    frame = 0;
    spawnTimer = 0;
    difficulty = 1;
    particles = [];
    shake = 0;
    message = ''; messageTimer = 0;
    for(let i=0;i<2;i++) addOrder();
    updateHud();
  }

  function addOrder(){
    const size = Math.min(5, 2 + Math.floor(Math.random() * (1 + difficulty/2)));
    const want = [];
    for(let i=0;i<size;i++) want.push(ORDER_POOL[Math.floor(Math.random()*ORDER_POOL.length)]);
    const patience = Math.max(560, 1500 - difficulty*90);
    orders.push({ want, patience, maxPatience: patience, id: frame + Math.random() });
  }

  function updateHud(){
    document.getElementById('burger-served').textContent = served;
    document.getElementById('burger-lives').textContent = '❤'.repeat(Math.max(0, lives));
    document.getElementById('burger-combo').textContent = '×' + (1 + combo);
  }

  function say(t){ message = t; messageTimer = 80; }

  function pop(x, y, color, n){
    for(let i=0;i<(n||10);i++)
      particles.push({ x, y, vx:(Math.random()-0.5)*6, vy:(Math.random()-0.5)*6-1, life:1, color });
  }

  function onKeyPress(name){
    if(!running || paused) return;
    if(ING[name]){
      if(stack.length >= 6){ say('TOO TALL'); Sfx.play('alarm'); return; }
      stack.push(ING[name].id);
      Sfx.play('click');
      return;
    }
    if(name === 'backspace' || name === 'x'){
      stack.pop();
      Sfx.play('hit', 1.6);
      return;
    }
    if(name === 'enter' || name === 'space') serve();
  }

  // Matches against the oldest order that fits, so building a simple burger
  // while a complex one waits still pays out.
  function serve(){
    if(!stack.length) return;
    const idx = orders.findIndex(o =>
      o.want.length === stack.length && o.want.every((w, i) => w === stack[i]));
    if(idx >= 0){
      const o = orders[idx];
      orders.splice(idx, 1);
      served++;
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      const bonus = Math.round(o.patience / o.maxPatience * 10);
      say(`SERVED +${combo + bonus}`);
      Sfx.play('perfect');
      pop(120, H - 90, '#45ffb0', 18);
      earnTokens('burger_order', 1);
      if(typeof scorePop === 'function') scorePop('SERVED', combo >= 4 ? 'big' : 'normal');
      difficulty += 0.35;
    } else {
      // A wrong plate costs you the combo and burns the queue's patience —
      // lives are only lost when a customer actually walks out.
      combo = 0;
      shake = 14;
      say('WRONG ORDER');
      Sfx.play('explode');
      pop(120, H - 90, '#ff5454', 14);
      orders.forEach(o => { o.patience = Math.max(30, o.patience - 90); });
    }
    stack = [];
    updateHud();
  }

  function update(){
    frame++;
    if(shake > 0) shake = Math.max(0, shake - 0.8);
    if(messageTimer > 0) messageTimer--;

    spawnTimer--;
    if(spawnTimer <= 0 && orders.length < 4){
      addOrder();
      spawnTimer = Math.max(90, 260 - difficulty*12);
    }

    for(let i=orders.length-1;i>=0;i--){
      orders[i].patience--;
      if(orders[i].patience <= 0){
        orders.splice(i,1);
        lives--;
        combo = 0;
        shake = 12;
        say('CUSTOMER LEFT');
        Sfx.play('lose', 1.3);
        updateHud();
        if(lives <= 0){ gameOver(); return; }
      }
    }

    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life -= 0.03;
      if(p.life <= 0) particles.splice(i,1);
    }
  }

  function gameOver(){
    running = false;
    updateStat('burger', [{stat:'highScore', type:'max', value:served}]);
    zipReactToScore('burger', 'highScore', served);
    Sfx.play('lose');
    document.getElementById('burger-result-text').textContent = 'KITCHEN CLOSED';
    document.getElementById('burger-result-sub').textContent =
      `${served} order${served===1?'':'s'} served · best streak ×${bestCombo}.`;
    document.getElementById('burger-play').classList.add('hidden');
    document.getElementById('burger-result').classList.remove('hidden');
  }

  function drawBurger(x, baseY, list, scale){
    const s = scale || 1;
    // bottom bun
    ctx.fillStyle = '#d99b52';
    ctx.beginPath();
    ctx.roundRect(x - 34*s, baseY - 10*s, 68*s, 12*s, 4*s);
    ctx.fill();
    let y = baseY - 10*s;
    list.forEach(id=>{
      const ing = Object.values(ING).find(i => i.id === id);
      if(!ing) return;
      y -= ing.h * s + 1;
      ctx.fillStyle = ing.color;
      ctx.beginPath();
      ctx.roundRect(x - 32*s, y, 64*s, ing.h*s, 3*s);
      ctx.fill();
    });
    // top bun
    y -= 15*s;
    ctx.fillStyle = '#e8b06a';
    ctx.beginPath();
    ctx.ellipse(x, y + 8*s, 35*s, 13*s, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for(let i=0;i<4;i++) ctx.fillRect(x - 18*s + i*10*s, y + 1*s, 3*s, 2*s);
  }

  function render(){
    ctx.save();
    if(settings.shake && shake > 0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

    const bg = ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0, '#2a1a0e');
    bg.addColorStop(1, '#120a05');
    ctx.fillStyle = bg;
    ctx.fillRect(-30,-30,W+60,H+60);

    // counter
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(0, H-58, W, 58);
    ctx.fillStyle = 'rgba(255,220,180,0.18)';
    ctx.fillRect(0, H-58, W, 3);

    // orders queue
    orders.forEach((o, i)=>{
      const x = 90 + i*150;
      const frac = o.patience / o.maxPatience;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.roundRect(x-62, 28, 124, 150, 8); ctx.fill();
      ctx.strokeStyle = frac < 0.3 ? '#ff5454' : 'rgba(255,220,180,0.3)';
      ctx.lineWidth = frac < 0.3 ? 2 : 1;
      ctx.stroke();

      drawBurger(x, 152, o.want, 0.72);

      // patience bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x-46, 162, 92, 6);
      ctx.fillStyle = frac < 0.3 ? '#ff5454' : (frac < 0.6 ? '#ffc857' : '#45ffb0');
      ctx.fillRect(x-46, 162, 92*frac, 6);
      ctx.restore();
    });

    // your build
    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,220,180,0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('YOUR BUILD', 120, H-190);
    drawBurger(120, H-70, stack, 1);
    ctx.restore();

    // ingredient keys
    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    Object.entries(ING).forEach(([key, ing], i)=>{
      const x = 300, y = H - 210 + i*26;
      ctx.fillStyle = ing.color;
      ctx.fillRect(x, y, 22, 12);
      ctx.fillStyle = 'rgba(255,235,215,0.85)';
      ctx.fillText(`[${key}] ${ing.name}`, x + 30, y + 11);
    });
    ctx.fillStyle = 'rgba(255,235,215,0.55)';
    ctx.fillText('[X] undo   [ENTER] serve', 300, H - 40);
    ctx.restore();

    particles.forEach(p=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    });

    if(messageTimer > 0){
      ctx.save();
      ctx.font = 'bold 20px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = message.startsWith('SERVED') ? '#45ffb0' : '#ff5454';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fillText(message, W/2, H - 250);
      ctx.restore();
    }
    ctx.restore();
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('burger-setup').classList.add('hidden');
    document.getElementById('burger-result').classList.add('hidden');
    document.getElementById('burger-play').classList.remove('hidden');
    freshState();
    paused = false; running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('burger-setup').classList.remove('hidden');
    document.getElementById('burger-play').classList.add('hidden');
    document.getElementById('burger-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
