/* =========================================================
   GAME: FLOOD ESCAPE
   =========================================================
   The water never stops rising. Hit the switches to open the exit door,
   then get out before you're under. Each room you clear is faster and
   taller than the last. */
const FloodGame = (function(){
  const canvas = document.getElementById('flood-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const GRAVITY = 0.66;
  const JUMP_VY = -11.6;
  const MOVE = 3.5;
  const PW = 16, PH = 24;
  // What one jump buys you, with margin: apex is JUMP_VY^2/(2*GRAVITY) ~= 102px
  // and airtime carries you about 123px sideways at MOVE.
  const REACH_UP = 84;
  const REACH_ACROSS = 150;

  let rafId=null, running=false, paused=false;
  let player, platforms, switches, door, water, waterRate, room, elapsed, best;
  let particles, frame, shake, escaping;

  function freshRoom(){
    // Every room is generated: a ladder of platforms, switches scattered on
    // them, and an exit near the top. Each rung is placed within one jump of
    // the rung below it, so a room is never impossible to climb — a jump
    // clears about 100px of height and 120px of ground, and `gap` stays
    // inside that.
    platforms = [{ x:0, y:H-24, w:W, h:24 }];
    const rows = 5 + Math.min(4, Math.floor(room/2));
    const gap = Math.min(REACH_UP, (H - 90) / rows);
    const ladder = [];
    let anchor = 60; // the player spawns at the far left of the floor
    for(let r=0;r<rows;r++){
      const w = 90 + Math.random()*110;
      const x = clamp(anchor - w/2 + (Math.random()-0.5) * REACH_ACROSS,
                      20, W - w - 20);
      const step = { x, y: H - 60 - r*gap, w, h: 12 };
      platforms.push(step);
      ladder.push(step);
      anchor = x + w/2;
      // A second platform on the row is scenery — and somewhere else to put a
      // switch — but the climb never depends on it.
      if(Math.random() < 0.55){
        const w2 = 90 + Math.random()*90;
        platforms.push({ x: 20 + Math.random()*(W - w2 - 40), y: step.y, w: w2, h: 12 });
      }
    }

    // Switches go on the climbable rungs only, so every one of them can be
    // reached without a lucky jump onto scenery.
    const switchCount = Math.min(4, 2 + Math.floor(room/3));
    switches = [];
    const pool = ladder.slice();
    for(let i=0;i<switchCount;i++){
      const idx = Math.floor(Math.random()*pool.length);
      const p = pool.length > 1 ? pool.splice(idx,1)[0] : pool[0];
      switches.push({ x: p.x + p.w/2, y: p.y - 14, on:false });
    }

    const top = platforms.reduce((a,b)=> b.y < a.y ? b : a, platforms[1] || platforms[0]);
    door = { x: clamp(top.x + top.w/2 - 14, 20, W-48), y: top.y - 40, w:28, h:40, open:false };

    player = { x: 40, y: H - 60, vx:0, vy:0, onGround:false };
    water = 0;
    waterRate = 0.16 + room * 0.045;
    particles = [];
    escaping = false;
  }

  function freshState(){
    room = 1;
    elapsed = 0;
    frame = 0;
    shake = 0;
    best = 0;
    freshRoom();
    updateHud();
  }

  function updateHud(){
    document.getElementById('flood-room').textContent = room;
    document.getElementById('flood-switches').textContent =
      switches.filter(s=>s.on).length + ' / ' + switches.length;
    const depth = Math.round(water);
    document.getElementById('flood-water').textContent = depth + 'm';
  }

  function rectHit(ax,ay,aw,ah, bx,by,bw,bh){
    return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
  }

  function onKeyPress(name){}

  function update(){
    frame++;
    elapsed += 1/60;
    if(shake > 0) shake = Math.max(0, shake - 0.8);

    // input
    let dx = 0;
    if(keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if(keys.has('d') || keys.has('arrowright')) dx += 1;
    player.vx = dx * MOVE;
    if((keys.has('w') || keys.has('arrowup') || keys.has('space')) && player.onGround){
      player.vy = JUMP_VY;
      player.onGround = false;
      Sfx.play('click');
    }

    player.vy += GRAVITY;
    player.x = clamp(player.x + player.vx, 0, W - PW);
    player.y += player.vy;

    // platform collision — only landing from above
    player.onGround = false;
    platforms.forEach(p=>{
      if(rectHit(player.x, player.y, PW, PH, p.x, p.y, p.w, p.h)){
        if(player.vy > 0 && player.y + PH - player.vy <= p.y + 4){
          player.y = p.y - PH;
          player.vy = 0;
          player.onGround = true;
        }
      }
    });
    if(player.y > H){ drown(); return; }

    // switches
    switches.forEach(s=>{
      if(s.on) return;
      if(Math.hypot((player.x+PW/2)-s.x, (player.y+PH/2)-s.y) < 22){
        s.on = true;
        Sfx.play('perfect');
        for(let i=0;i<12;i++)
          particles.push({ x:s.x, y:s.y, vx:(Math.random()-0.5)*5, vy:(Math.random()-0.5)*5, life:1, color:'#45ffb0' });
        if(switches.every(x=>x.on)){
          door.open = true;
          toast('Exit unlocked', 'Get to the door', '🚪', 'gold');
          Sfx.play('win');
        }
        updateHud();
      }
    });

    // door
    if(door.open && rectHit(player.x, player.y, PW, PH, door.x, door.y, door.w, door.h)){
      escapeRoom();
      return;
    }

    // water
    water += waterRate * 0.14;
    const waterY = H - water * 6;
    if(player.y + PH > waterY){
      // Sinking slows you before it kills you, so there's a moment to react.
      player.vy = Math.min(player.vy, 1.4);
      if(player.y > waterY + 26){ drown(); return; }
    }

    for(let i=particles.length-1;i>=0;i--){
      const q = particles[i];
      q.x += q.vx; q.y += q.vy; q.vy += 0.14; q.life -= 0.03;
      if(q.life <= 0) particles.splice(i,1);
    }
    updateHud();
  }

  function escapeRoom(){
    room++;
    shake = 14;
    Sfx.play('win');
    earnTokens('flood_room', 1);
    for(let i=0;i<24;i++)
      particles.push({ x:door.x+14, y:door.y+20, vx:(Math.random()-0.5)*7, vy:(Math.random()-0.5)*7, life:1, color:'#4cb8ff' });
    freshRoom();
    updateHud();
  }

  function drown(){
    running = false;
    const cleared = room - 1;
    updateStat('flood', [{stat:'bestRooms', type:'max', value:cleared}]);
    zipReactToScore('flood', 'bestRooms', cleared);
    Sfx.play('lose');
    document.getElementById('flood-result-text').textContent = cleared > 0 ? 'THE WATER WON' : 'UNDER IN SECONDS';
    document.getElementById('flood-result-sub').textContent =
      `You escaped ${cleared} room${cleared===1?'':'s'} in ${Math.round(elapsed)}s.`;
    document.getElementById('flood-play').classList.add('hidden');
    document.getElementById('flood-result').classList.remove('hidden');
  }

  function render(){
    ctx.save();
    if(settings.shake && shake > 0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

    const bg = ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0, '#0b1526');
    bg.addColorStop(1, '#050a14');
    ctx.fillStyle = bg;
    ctx.fillRect(-30,-30,W+60,H+60);

    // wall texture
    ctx.strokeStyle = 'rgba(120,180,255,0.05)';
    for(let y=0;y<H;y+=26){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    platforms.forEach(p=>{
      ctx.fillStyle = '#1c2b40';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = 'rgba(125,211,255,0.35)';
      ctx.fillRect(p.x, p.y, p.w, 2);
    });

    // door
    ctx.save();
    ctx.shadowColor = door.open ? '#45ffb0' : '#ff5454';
    ctx.shadowBlur = door.open ? 20 : 8;
    ctx.fillStyle = door.open ? '#173d2f' : '#3a1f24';
    ctx.fillRect(door.x, door.y, door.w, door.h);
    ctx.strokeStyle = door.open ? '#45ffb0' : '#ff5454';
    ctx.lineWidth = 2;
    ctx.strokeRect(door.x, door.y, door.w, door.h);
    ctx.shadowBlur = 0;
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = door.open ? '#45ffb0' : '#ff5454';
    ctx.fillText(door.open ? '↑' : '🔒', door.x + door.w/2, door.y + door.h/2 + 5);
    ctx.restore();

    // switches
    switches.forEach(s=>{
      ctx.save();
      ctx.shadowColor = s.on ? '#45ffb0' : '#ffc857';
      ctx.shadowBlur = 14;
      ctx.fillStyle = s.on ? '#45ffb0' : '#ffc857';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#04070a';
      ctx.fillRect(s.x-3, s.y - (s.on ? 1 : 5), 6, 6);
      ctx.restore();
    });

    // player
    ctx.save();
    ctx.shadowColor = '#4cb8ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#cfe6ff';
    ctx.fillRect(player.x, player.y, PW, PH);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b1526';
    ctx.fillRect(player.x + 4, player.y + 6, 3, 3);
    ctx.fillRect(player.x + PW - 7, player.y + 6, 3, 3);
    ctx.restore();

    particles.forEach(q=>{
      ctx.save();
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2.6, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });

    // water — drawn last so it sits over everything it's swallowed
    const waterY = H - water * 6;
    ctx.save();
    const wg = ctx.createLinearGradient(0, waterY, 0, H);
    wg.addColorStop(0, 'rgba(70,160,255,0.55)');
    wg.addColorStop(1, 'rgba(20,60,140,0.85)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(0, waterY);
    for(let x=0;x<=W;x+=16){
      ctx.lineTo(x, waterY + Math.sin((x*0.03) + frame*0.06) * 4);
    }
    ctx.lineTo(W, H); ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,225,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232,236,241,0.55)';
    ctx.fillText('HIT EVERY SWITCH · THEN REACH THE DOOR', 14, 20);
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    document.getElementById('flood-setup').classList.add('hidden');
    document.getElementById('flood-result').classList.add('hidden');
    document.getElementById('flood-play').classList.remove('hidden');
    freshState();
    paused = false; running = true;
    showZipCompanion('idle');
    loop();
  }
  function stop(){ running=false; paused=false; if(rafId) cancelAnimationFrame(rafId); }
  function reset(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    document.getElementById('flood-setup').classList.remove('hidden');
    document.getElementById('flood-play').classList.add('hidden');
    document.getElementById('flood-result').classList.add('hidden');
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return {start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning};
})();
