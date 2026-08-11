/* =========================================================
   THE HUB — a shared 3D space
   =========================================================
   Walk around as your avatar and see everyone else in the room walking
   around as theirs. Third-person chase camera, blocky scenery, name tags
   over heads, and emotes that pop above you.

   Movement is local and immediate — you never wait on the network to move —
   and your position is relayed to everyone else on a timer. That's why it
   stays responsive on a free-tier server on the other side of the world. */
const HubWorld = (function(){
  const canvas = document.getElementById('hub-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const FOCAL = 330;
  const SPEED = 0.085;
  const TURN = 0.045;
  const GRAVITY = 0.012;
  const JUMP = 0.20;
  const WORLD_R = 26;        // you can't walk off the edge of the plaza

  let rafId = null, running = false, paused = false;
  let camYaw = 0, camDist = 5.6, camHeight = 2.6;
  let frame = 0;
  let props = [];
  let coins = [];
  let collected = 0;
  // Speech bubbles keyed by player, fed from the chat room so what you say
  // in chat also appears over your head in here.
  const bubbles = new Map();
  const BUBBLE_MS = 6000;

  // The scenery, built once. Everything is boxes, so it costs nothing to
  // keep around and can be sorted with the players in one pass.
  function buildProps(){
    const out = [];
    const edge = { stroke: 'rgba(0,0,0,0.25)', lineWidth: 1 };

    // plaza floor, chequered so movement reads
    for(let gx=-6; gx<6; gx++){
      for(let gz=-6; gz<6; gz++){
        const dark = (gx + gz) % 2 === 0;
        out.push({
          pts: [
            { x: gx*4,     y: 0, z: gz*4 },
            { x: gx*4 + 4, y: 0, z: gz*4 },
            { x: gx*4 + 4, y: 0, z: gz*4 + 4 },
            { x: gx*4,     y: 0, z: gz*4 + 4 }
          ],
          fill: dark ? '#1b2740' : '#243352',
          fog: 55
        });
      }
    }

    // a ring of neon pillars around the plaza
    const colors = ['#2de2c5', '#ff3d8a', '#ffc857', '#7dd3ff', '#c084fc', '#45ffb0'];
    for(let i=0;i<12;i++){
      const a = (i/12) * Math.PI*2;
      const x = Math.cos(a) * 18, z = Math.sin(a) * 18;
      const c = colors[i % colors.length];
      out.push(...Mini3D.box(x, 2.0, z, 0.7, 4.0, 0.7, '#0f1626', edge));
      out.push(...Mini3D.box(x, 4.3, z, 0.9, 0.5, 0.9, c, { glow: c, glowBlur: 18 }));
    }

    // a stepped podium in the middle to stand on
    out.push(...Mini3D.box(0, 0.15, 0, 7, 0.3, 7, '#1c2b40', edge));
    out.push(...Mini3D.box(0, 0.45, 0, 5, 0.3, 5, '#22344d', edge));
    out.push(...Mini3D.box(0, 0.75, 0, 3, 0.3, 3, '#2a3f5c', edge));
    out.push(...Mini3D.box(0, 1.6, 0, 0.5, 1.4, 0.5, '#0f1626', edge));
    out.push(...Mini3D.box(0, 2.5, 0, 1.2, 0.5, 1.2, '#ffc857', { glow: '#ffc857', glowBlur: 22 }));

    // scattered blocks to jump on
    const spots = [[-9,5],[8,-6],[11,7],[-12,-8],[5,12],[-6,-13]];
    spots.forEach(([x,z], i) => {
      const c = colors[i % colors.length];
      out.push(...Mini3D.box(x, 0.5, z, 2.2, 1.0, 2.2, '#1a2740', edge));
      out.push(...Mini3D.box(x, 1.1, z, 2.3, 0.12, 2.3, c, { glow: c, glowBlur: 12 }));
    });

    return out;
  }

  // Tokens scattered round the plaza. They respawn on a timer rather than
  // being a one-off, so there's always something to chase, and they pay
  // through the normal earn path so the caps still apply.
  function spawnCoins(){
    coins = [];
    for(let i=0;i<10;i++){
      const a = (i/10) * Math.PI*2 + Math.random()*0.4;
      const r = 8 + Math.random()*13;
      coins.push({ x: Math.cos(a)*r, z: Math.sin(a)*r, taken: 0 });
    }
  }

  function reset(){
    const me = mpLocal();
    me.x = 6; me.y = 0; me.z = 6; me.yaw = -Math.PI * 0.75;
    me.vy = 0;
    me.phase = 0; me.moving = false;
    camYaw = me.yaw;
    frame = 0;
  }

  function update(){
    frame++;
    const me = mpLocal();

    // turn
    if(keys.has('a') || keys.has('arrowleft')) me.yaw -= TURN;
    if(keys.has('d') || keys.has('arrowright')) me.yaw += TURN;

    // walk, with shift to sprint
    let drive = 0;
    if(keys.has('w') || keys.has('arrowup')) drive = 1;
    if(keys.has('s') || keys.has('arrowdown')) drive = -0.55;
    const sprint = keys.has('shift') ? 1.7 : 1;
    const step = SPEED * drive * sprint;

    me.x += Math.sin(me.yaw) * step;
    me.z += Math.cos(me.yaw) * step;

    // keep everyone on the plaza
    const dist = Math.hypot(me.x, me.z);
    if(dist > WORLD_R){
      me.x = me.x / dist * WORLD_R;
      me.z = me.z / dist * WORLD_R;
    }

    // jump + gravity
    if((keys.has(' ') || keys.has('space')) && me.y <= 0.001){
      me.vy = JUMP;
      Sfx.play('click');
    }
    me.vy = (me.vy || 0) - GRAVITY;
    me.y += me.vy;
    if(me.y < 0){ me.y = 0; me.vy = 0; }

    me.moving = Math.abs(step) > 0.001;
    if(me.moving) me.phase += 0.22 * sprint;

    // The camera trails behind rather than snapping, which keeps quick turns
    // from whipping the whole view around.
    let d = me.yaw - camYaw;
    while(d > Math.PI) d -= Math.PI*2;
    while(d < -Math.PI) d += Math.PI*2;
    camYaw += d * 0.12;

    // coins
    coins.forEach(c => {
      if(c.taken){
        if(frame - c.taken > 600) c.taken = 0;   // ten seconds, then it's back
        return;
      }
      if(Math.hypot(c.x - me.x, c.z - me.z) < 1.2){
        c.taken = frame;
        collected++;
        Sfx.play('coin', 1.4);
        earnTokens('hub_coin', 1);
      }
    });

    // expire speech bubbles
    const now = Date.now();
    bubbles.forEach((b, user) => { if(now - b.at > BUBBLE_MS) bubbles.delete(user); });

    mpInterpolate();
  }

  function render(){
    const me = mpLocal();
    const cam = {
      x: me.x - Math.sin(camYaw) * camDist,
      y: me.y + camHeight,
      z: me.z - Math.cos(camYaw) * camDist,
      yaw: camYaw,
      pitch: -0.20
    };

    Mini3D.sky(ctx, W, H, cam, {
      focal: FOCAL,
      skyTop: '#070a12', skyBottom: '#1a2540',
      groundNear: '#16223a', groundFar: '#070a12'
    });

    // Everyone in one face list so players and scenery sort against each
    // other correctly — a player behind a pillar is drawn behind it.
    let faces = props.slice();
    const tags = [];

    const draw = (user, p) => {
      faces = faces.concat(Avatar3D.build(avatarFor(user), {
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, phase: p.phase || 0, moving: !!p.moving
      }));
      tags.push({ user, p });
    };
    coins.forEach(c => {
      if(c.taken) return;
      const spin = frame * 0.05;
      faces = faces.concat(Mini3D.transform(
        Mini3D.box(0, 0, 0, 0.5, 0.5, 0.12, '#ffc857', { glow: '#ffc857', glowBlur: 14 }),
        { x: c.x, y: 0.9 + Math.sin(frame*0.06 + c.x) * 0.12, z: c.z, yaw: spin }));
    });

    mpOthers().forEach(o => draw(o.user, o.p));
    draw(currentUser, me);

    Mini3D.render(ctx, faces, cam, W, H, FOCAL);

    // Name tags and emotes, drawn in 2D over the scene so they stay legible
    // whatever the geometry is doing behind them.
    tags.forEach(({ user, p }) => {
      const head = Mini3D.screenPoint(
        { x: p.x, y: p.y + Avatar3D.TOTAL_H + 0.45, z: p.z }, cam, W, H, FOCAL);
      if(!head) return;
      const mine = user === currentUser;
      ctx.save();
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      const label = (typeof clanTagFor === 'function' && clanTagFor(user))
        ? `[${clanTagFor(user)}] ${user}` : user;
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(6,9,15,0.72)';
      ctx.beginPath();
      ctx.roundRect(head.x - w/2, head.y - 14, w, 18, 5);
      ctx.fill();
      ctx.fillStyle = mine ? '#2de2c5' : '#e8ecf1';
      ctx.fillText(label, head.x, head.y - 1);
      if(p.emote){
        ctx.font = '24px sans-serif';
        ctx.fillText(p.emote, head.x, head.y - 22);
      }
      const bubble = bubbles.get(user);
      if(bubble){
        ctx.font = '11px "JetBrains Mono", monospace';
        const bw = Math.min(220, ctx.measureText(bubble.text).width + 16);
        const by = head.y - (p.emote ? 46 : 22);
        ctx.fillStyle = 'rgba(232,236,241,0.94)';
        ctx.beginPath(); ctx.roundRect(head.x - bw/2, by - 16, bw, 21, 7); ctx.fill();
        ctx.fillStyle = '#0b0f17';
        ctx.fillText(bubble.text.slice(0, 34), head.x, by - 2);
      }
      ctx.restore();
    });

    // HUD
    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.55)';
    ctx.textAlign = 'left';
    ctx.fillText('WASD move · SHIFT sprint · SPACE jump · 1-4 emote', 14, H - 14);
    ctx.textAlign = 'right';
    ctx.fillText(`${mpPlayers.size} here · room ${mpRoom ? mpRoom.code : '—'}`, W - 14, H - 14);
    ctx.fillStyle = '#ffc857';
    ctx.fillText(`🪙 ${collected} collected`, W - 14, H - 30);
    ctx.restore();

    drawHubMap();
  }

  // Top-down plaza so you can find the others without wandering.
  function drawHubMap(){
    const size = 96, pad = 14;
    const cx = W - size/2 - pad, cy = pad + size/2;
    const scale = (size/2 - 6) / WORLD_R;
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,15,0.5)';
    ctx.beginPath(); ctx.arc(cx, cy, size/2, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(232,236,241,0.25)';
    ctx.beginPath(); ctx.arc(cx, cy, size/2 - 4, 0, Math.PI*2); ctx.stroke();
    coins.forEach(c => {
      if(c.taken) return;
      ctx.fillStyle = 'rgba(255,200,87,0.85)';
      ctx.fillRect(cx + c.x*scale - 1, cy + c.z*scale - 1, 2, 2);
    });
    mpPlayers.forEach((p, user) => {
      ctx.fillStyle = user === currentUser ? '#2de2c5' : '#ff3d8a';
      ctx.beginPath();
      ctx.arc(cx + p.x*scale, cy + p.z*scale, user === currentUser ? 3.5 : 2.5, 0, Math.PI*2);
      ctx.fill();
    });
    ctx.restore();
  }

  // Chat lands over people's heads in here as well as in the dock.
  function sayInWorld(user, text){
    bubbles.set(user, { text, at: Date.now() });
  }

  function onKeyPress(name){
    const emotes = { '1': '👋', '2': '😂', '3': '🔥', '4': '❤️' };
    if(emotes[name]){
      const me = mpLocal();
      me.emote = emotes[name];
      Realtime.send({ type: 'mp:emote', emote: emotes[name] });
      Sfx.play('coin', 1.3);
    }
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    showScreen('hub-screen');
    if(!props.length) props = buildProps();
    spawnCoins();
    collected = 0;
    bubbles.clear();
    reset();
    paused = false; running = true;
    loop();
  }
  function stop(){
    running = false; paused = false;
    if(rafId) cancelAnimationFrame(rafId);
  }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return { start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning, sayInWorld };
})();
