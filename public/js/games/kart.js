/* =========================================================
   RIFT KART — 3D multiplayer racing
   =========================================================
   Three laps of an oval-with-kinks circuit, up to eight karts, everyone
   seeing everyone else in real time. Your avatar rides the kart, so the
   character you built is the one on the grid.

   The track's checkpoints match the server's KART_CHECKPOINTS: the client
   says "I reached checkpoint N", the server decides whether that's the one
   you were actually due, and only the server counts laps or pays out. */
const KartGame = (function(){
  const canvas = document.getElementById('kart-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const FOCAL = 300;
  const LAPS = 3;
  const CHECKPOINTS = 8;

  // Handling. Deliberately floaty and forgiving — this is a party racer, not
  // a simulator, and drifting into a wall shouldn't end your race.
  const ACCEL = 0.011;
  const BRAKE = 0.020;
  const DRAG = 0.985;
  const MAX_SPEED = 0.42;
  const TURN_RATE = 0.034;
  const OFFTRACK_DRAG = 0.93;

  // The circuit centreline. Checkpoints are evenly spaced around it, and the
  // road is drawn as quads between consecutive points.
  const TRACK_R = 30;
  const NODES = 96;
  let centre = [];
  let trackFaces = [];
  let scenery = [];

  let rafId = null, running = false, paused = false;
  let speed = 0, frame = 0, camYaw = 0;
  let myCheckpoint = 0, myLap = 0, finished = false;
  let raceStart = 0, lastLapAt = 0, bestLap = 0;

  // A closed loop with a couple of kinks, so it isn't a plain circle.
  function trackPoint(t){
    const a = t * Math.PI * 2;
    const wobble = Math.sin(a * 2) * 6 + Math.sin(a * 3) * 3.5;
    const r = TRACK_R + wobble;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  function buildTrack(){
    centre = [];
    for(let i=0;i<NODES;i++) centre.push(trackPoint(i / NODES));

    const half = 5.2;
    trackFaces = [];
    scenery = [];
    for(let i=0;i<NODES;i++){
      const a = centre[i], b = centre[(i+1) % NODES];
      // Road normal, so the surface follows the bends at a constant width.
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz/len, nz = dx/len;
      const shade = i % 2 ? '#232c3c' : '#1e2634';
      trackFaces.push({
        pts: [
          { x: a.x + nx*half, y: 0, z: a.z + nz*half },
          { x: b.x + nx*half, y: 0, z: b.z + nz*half },
          { x: b.x - nx*half, y: 0, z: b.z - nz*half },
          { x: a.x - nx*half, y: 0, z: a.z - nz*half }
        ],
        fill: shade, fog: 90
      });
      // kerbs
      const kerb = i % 2 ? '#ff5454' : '#e8ecf1';
      [1, -1].forEach(side => {
        trackFaces.push({
          pts: [
            { x: a.x + nx*half*side,        y: 0.02, z: a.z + nz*half*side },
            { x: b.x + nx*half*side,        y: 0.02, z: b.z + nz*half*side },
            { x: b.x + nx*(half+0.9)*side,  y: 0.02, z: b.z + nz*(half+0.9)*side },
            { x: a.x + nx*(half+0.9)*side,  y: 0.02, z: a.z + nz*(half+0.9)*side }
          ],
          fill: kerb, fog: 90
        });
      });

      // posts along the outside, every few nodes
      if(i % 6 === 0){
        const c = ['#2de2c5','#ff3d8a','#ffc857','#7dd3ff'][(i/6) % 4];
        const px = a.x + nx*(half+2.4), pz = a.z + nz*(half+2.4);
        scenery.push(...Mini3D.box(px, 1.1, pz, 0.4, 2.2, 0.4, '#0f1626',
                                   { stroke:'rgba(0,0,0,0.3)', fog: 90 }));
        scenery.push(...Mini3D.box(px, 2.4, pz, 0.6, 0.4, 0.6, c,
                                   { glow: c, glowBlur: 14, fog: 90 }));
      }
    }

    // start/finish gantry across the line
    const s = centre[0];
    const s1 = centre[1];
    const dx = s1.x - s.x, dz = s1.z - s.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz/len, nz = dx/len;
    // Built in local space (spanning local X, i.e. across the road) and then
    // turned to match the track's heading at the line. Mini3D.box is
    // axis-aligned, so without this the beam spans world X and lies across
    // the circuit at whatever angle the line happens to sit at.
    const lineYaw = Math.atan2(dx, dz);
    const gantry = [];
    gantry.push(...Mini3D.box(-half, 2.6, 0, 0.6, 5.2, 0.6, '#e8ecf1',
                              { stroke:'rgba(0,0,0,0.3)' }));
    gantry.push(...Mini3D.box( half, 2.6, 0, 0.6, 5.2, 0.6, '#e8ecf1',
                              { stroke:'rgba(0,0,0,0.3)' }));
    gantry.push(...Mini3D.box(0, 5.0, 0, half*2 + 0.6, 0.8, 0.7, '#ffc857',
                              { glow:'#ffc857', glowBlur: 18 }));
    scenery.push(...Mini3D.transform(gantry, { x: s.x, y: 0, z: s.z, yaw: lineYaw }));
    // chequered line on the road
    for(let k=-5;k<5;k++){
      trackFaces.push({
        pts: [
          { x: s.x + nx*k, y: 0.03, z: s.z + nz*k },
          { x: s.x + nx*(k+1), y: 0.03, z: s.z + nz*(k+1) },
          { x: s.x + nx*(k+1) + dx/len*1.4, y: 0.03, z: s.z + nz*(k+1) + dz/len*1.4 },
          { x: s.x + nx*k + dx/len*1.4, y: 0.03, z: s.z + nz*k + dz/len*1.4 }
        ],
        fill: k % 2 ? '#e8ecf1' : '#0b0f17'
      });
    }
  }

  function checkpointPos(i){
    return centre[Math.round((i / CHECKPOINTS) * NODES) % NODES];
  }

  // How far off the centreline we are, used to slow you down on the grass.
  function distanceToTrack(x, z){
    let best = Infinity;
    for(let i=0;i<NODES;i+=2){
      const d = Math.hypot(centre[i].x - x, centre[i].z - z);
      if(d < best) best = d;
    }
    return best;
  }

  function kartFaces(user, p){
    const av = avatarFor(user);
    const edge = { stroke: 'rgba(0,0,0,0.3)', lineWidth: 1 };
    const body = [];
    // chassis in local space, nose toward +z
    body.push(...Mini3D.box(0, 0.26, 0.1, 1.15, 0.30, 1.85, av.shirt, edge));
    body.push(...Mini3D.box(0, 0.48, -0.35, 0.95, 0.22, 0.7, Mini3D.shade(av.shirt, 0.7), edge));
    body.push(...Mini3D.box(0, 0.40, 1.05, 0.75, 0.20, 0.35, av.hatColor, edge));
    // wheels
    [[-0.62, 0.72], [0.62, 0.72], [-0.62, -0.62], [0.62, -0.62]].forEach(([wx, wz]) => {
      body.push(...Mini3D.box(wx, 0.22, wz, 0.26, 0.44, 0.44, '#0d1119', edge));
    });
    const kart = Mini3D.transform(body, { x: p.x, y: p.y || 0, z: p.z, yaw: p.yaw });
    // the driver, sat in the seat
    const driver = Avatar3D.build(av, {
      x: p.x, y: (p.y || 0) + 0.34, z: p.z, yaw: p.yaw, phase: 0, moving: false, scale: 0.68
    });
    return kart.concat(driver);
  }

  function reset(){
    const me = mpLocal();
    speed = 0;
    myCheckpoint = 0; myLap = 0; finished = false;
    bestLap = 0; lastLapAt = 0;
    // Position comes from the server's grid — see needsSpawn in
    // multiplayer.js — so nothing here touches x/z/yaw.
    me.phase = 0; me.moving = false;
    camYaw = me.yaw;
    frame = 0;
  }

  function countdownLeft(){
    return mpStartsAt ? Math.max(0, mpStartsAt - Date.now()) : 0;
  }

  function update(){
    frame++;
    const me = mpLocal();
    const locked = countdownLeft() > 0 || finished;

    if(!locked){
      if(keys.has('w') || keys.has('arrowup')) speed += ACCEL;
      if(keys.has('s') || keys.has('arrowdown')) speed -= BRAKE;
      // Steering bites less at a crawl, so you can't pirouette on the spot.
      const grip = Math.min(1, Math.abs(speed) / 0.12);
      const dir = speed >= 0 ? 1 : -1;
      if(keys.has('a') || keys.has('arrowleft')) me.yaw -= TURN_RATE * grip * dir;
      if(keys.has('d') || keys.has('arrowright')) me.yaw += TURN_RATE * grip * dir;
    }

    speed *= DRAG;
    speed = Math.max(-MAX_SPEED*0.4, Math.min(MAX_SPEED, speed));
    if(locked) speed *= 0.9;

    // Off the tarmac you bog down — a shortcut across the infield costs you.
    const off = distanceToTrack(me.x, me.z);
    if(off > 6.2) speed *= OFFTRACK_DRAG;

    me.x += Math.sin(me.yaw) * speed;
    me.z += Math.cos(me.yaw) * speed;
    me.moving = Math.abs(speed) > 0.02;
    me.phase = 0;

    // Checkpoints. We only ever claim the next one in sequence; the server
    // re-checks that and owns the lap count.
    if(!locked && !finished){
      const target = checkpointPos(myCheckpoint % CHECKPOINTS);
      if(Math.hypot(target.x - me.x, target.z - me.z) < 8){
        Realtime.send({ type: 'mp:checkpoint', index: myCheckpoint % CHECKPOINTS });
        myCheckpoint++;
        Sfx.play('click', 1.4);
        if(myCheckpoint % CHECKPOINTS === 0){
          myLap++;
          const now = Date.now();
          if(lastLapAt){
            const lap = now - lastLapAt;
            if(!bestLap || lap < bestLap) bestLap = lap;
          }
          lastLapAt = now;
          if(myLap >= LAPS){
            finished = true;
            Sfx.play('win');
          } else {
            Sfx.play('perfect');
            toast('Lap ' + myLap, `${LAPS - myLap} to go`, '🏁', 'cyan');
          }
        }
      }
    }

    let d = me.yaw - camYaw;
    while(d > Math.PI) d -= Math.PI*2;
    while(d < -Math.PI) d += Math.PI*2;
    camYaw += d * 0.14;

    mpInterpolate();
  }

  function render(){
    const me = mpLocal();
    // The camera pulls back as you speed up, which sells the pace.
    const dist = 5.0 + Math.abs(speed) * 4;
    const cam = {
      x: me.x - Math.sin(camYaw) * dist,
      y: 2.5,
      z: me.z - Math.cos(camYaw) * dist,
      yaw: camYaw,
      pitch: -0.14
    };

    Mini3D.sky(ctx, W, H, cam, {
      focal: FOCAL,
      skyTop: '#0b0716', skyBottom: '#2a1a3e',
      groundNear: '#123021', groundFar: '#070d0a'
    });

    let faces = trackFaces.concat(scenery);
    const tags = [];
    mpOthers().forEach(({ user, p }) => {
      faces = faces.concat(kartFaces(user, p));
      tags.push({ user, p });
    });
    faces = faces.concat(kartFaces(currentUser, me));

    Mini3D.render(ctx, faces, cam, W, H, FOCAL);

    tags.forEach(({ user, p }) => {
      const head = Mini3D.screenPoint({ x: p.x, y: 2.0, z: p.z }, cam, W, H, FOCAL);
      if(!head) return;
      ctx.save();
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      const label = `${user} · L${Math.min(LAPS, (p.lap || 0) + 1)}`;
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(6,9,15,0.72)';
      ctx.beginPath(); ctx.roundRect(head.x - w/2, head.y - 14, w, 18, 5); ctx.fill();
      ctx.fillStyle = '#e8ecf1';
      ctx.fillText(label, head.x, head.y - 1);
      ctx.restore();
    });

    drawHud();
  }

  function drawHud(){
    const left = countdownLeft();
    ctx.save();
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffc857';
    ctx.fillText(`LAP ${Math.min(LAPS, myLap + 1)}/${LAPS}`, 16, 28);
    ctx.fillStyle = 'rgba(232,236,241,0.7)';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText(`${Math.round(Math.abs(speed) * 240)} km/h`, 16, 46);
    if(bestLap) ctx.fillText(`best ${(bestLap/1000).toFixed(1)}s`, 16, 62);

    // running order, by laps then checkpoint progress
    const order = [...mpPlayers.entries()]
      .map(([user, p]) => ({ user, lap: p.lap || 0 }))
      .sort((a, b) => b.lap - a.lap);
    ctx.textAlign = 'right';
    order.slice(0, 8).forEach((o, i) => {
      ctx.fillStyle = o.user === currentUser ? '#2de2c5' : 'rgba(232,236,241,0.6)';
      ctx.fillText(`${i+1}. ${o.user}`, W - 16, 28 + i*15);
    });

    if(left > 0){
      ctx.textAlign = 'center';
      ctx.font = 'bold 64px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffc857';
      ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 26;
      ctx.fillText(String(Math.ceil(left/1000)), W/2, H/2);
    } else if(frame < 90 && mpStartsAt){
      ctx.textAlign = 'center';
      ctx.font = 'bold 44px "JetBrains Mono", monospace';
      ctx.fillStyle = '#45ffb0';
      ctx.shadowColor = '#45ffb0'; ctx.shadowBlur = 22;
      ctx.fillText('GO', W/2, H/2);
    }

    if(finished){
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffc857';
      ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 20;
      ctx.fillText('FINISHED', W/2, 80);
    }

    ctx.restore();
    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('W accelerate · S brake · A/D steer', 16, H - 14);
    ctx.restore();
  }

  function onKeyPress(){}

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    showScreen('kart-screen');
    if(!centre.length) buildTrack();
    reset();
    raceStart = Date.now();
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

  return { start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning };
})();
