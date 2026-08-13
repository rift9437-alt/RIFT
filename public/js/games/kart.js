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
  // Leaving the tarmac should cost you a place, not end your race. At 0.93 a
  // frame it compounded into a hard stop — a kart that wandered off settled
  // at under a third of its top speed and never recovered.
  const OFFTRACK_DRAG = 0.972;
  // Drift: hold SHIFT while turning to slide wide, and the longer you hold a
  // clean slide the bigger the kick when you let go. It's the one mechanic
  // that rewards taking a corner well rather than just holding throttle.
  const DRIFT_TURN = 1.75;        // steering multiplier while sliding
  // Scrubbing 3.5% a frame compounded to losing ~80% of your speed over a
  // tier-1 slide — you paid more than the boost ever gave back, so drifting
  // was strictly worse than just holding the throttle. It's a light cost now.
  const DRIFT_GRIP = 0.997;
  const MINI_TURBO_AT = [45, 90]; // frames of clean drift for each tier
  // A boost is a burst you can feel: an immediate kick past the normal top
  // speed, then a window where the ceiling stays raised. Trickling extra
  // acceleration in was indistinguishable from just holding the throttle.
  const BOOST_FRAMES = [70, 100]; // how long the raised ceiling lasts
  const BOOST_KICK = [1.20, 1.38];// multiple of MAX_SPEED applied instantly
  const BOOST_CAP = 1.45;         // ceiling while a boost is live

  // Items. The layout has to match the server's kartBoxes() exactly, because
  // the server decides who picked up what by comparing positions — a box drawn
  // somewhere else is a box you can't collect. Everything else about items
  // (what's in a box, whether a shell landed) is the server's call; this file
  // only draws it and asks.
  const BOX_STATIONS = 6;
  const BOX_LANES = [-2.6, 0, 2.6];
  const ITEM_ICONS = { boost:'🍄', banana:'🍌', shell:'🐢', bolt:'⚡', shield:'🛡' };
  const ITEM_NAMES = { boost:'Turbo Cap', banana:'Banana', shell:'Homing Shell',
                       bolt:'Rift Bolt', shield:'Shield' };
  const SPIN_MS = 1500;

  // The circuit centreline. Checkpoints are evenly spaced around it, and the
  // road is drawn as quads between consecutive points.
  // The layout is the server's — it judges checkpoints and places the grid
  // against this exact curve, so a client drawing a different one would be
  // racing a track nobody else can see. mpRoom.track says which.
  const TRACKS = {
    loop:   { r: 30, a: 6,   b: 3.5 },
    spiral: { r: 28, a: 9.5, b: 1.5 },
    ribbon: { r: 33, a: 3,   b: 7   }
  };
  let TRACK_R = 30, TRACK_A = 6, TRACK_B = 3.5;
  let builtTrack = null;
  const NODES = 96;
  let centre = [];
  let trackFaces = [];
  let scenery = [];

  let rafId = null, running = false, paused = false;
  let speed = 0, frame = 0, camYaw = 0;
  let myCheckpoint = 0, myLap = 0, finished = false;
  let raceStart = 0, lastLapAt = 0, bestLap = 0;
  let drift = 0, driftDir = 0, boost = 0, boostPads = [];
  let lapTimes = [];
  let itemBoxes = [], myItem = null, spinUntil = 0, itemFlash = 0, canFire = false;
  // Ghost: a translucent kart replaying your own best lap on this track. It's
  // recorded as you drive and only replaces the stored one when you actually
  // go quicker, so what you're chasing is always your personal best. Kept per
  // track — a Coil lap is meaningless on the Ribbon.
  const GHOST_KEY = 'level7_kart_ghost';
  const GHOST_STEP = 3;            // record every third frame; plenty at 60fps
  let ghostRec = [], ghostBest = null, ghostFrame = 0;

  // A closed loop with a couple of kinks, so it isn't a plain circle.
  function trackPoint(t){
    const a = t * Math.PI * 2;
    const r = TRACK_R + Math.sin(a * 2) * TRACK_A + Math.sin(a * 3) * TRACK_B;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  // Adopt whichever layout the room is racing, and rebuild if it changed.
  function useTrack(id){
    const T = TRACKS[id] || TRACKS.loop;
    if(builtTrack === (id || 'loop') && centre.length) return;
    TRACK_R = T.r; TRACK_A = T.a; TRACK_B = T.b;
    builtTrack = id || 'loop';
    buildTrack();
    buildItemBoxes();
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

    // Boost pads on the racing line, spaced so there's one to aim for on
    // most straights rather than a carpet of them.
    boostPads = [];
    for(let i=8;i<NODES;i+=16){
      const a = centre[i], b = centre[(i+1) % NODES];
      const dxp = b.x - a.x, dzp = b.z - a.z;
      const lp = Math.hypot(dxp, dzp) || 1;
      const nxp = -dzp/lp, nzp = dxp/lp;
      boostPads.push({ x: a.x, z: a.z });
      trackFaces.push({
        pts: [
          { x: a.x + nxp*2.2, y: 0.04, z: a.z + nzp*2.2 },
          { x: a.x - nxp*2.2, y: 0.04, z: a.z - nzp*2.2 },
          { x: a.x - nxp*2.2 + dxp/lp*3.4, y: 0.04, z: a.z - nzp*2.2 + dzp/lp*3.4 },
          { x: a.x + nxp*2.2 + dxp/lp*3.4, y: 0.04, z: a.z + nzp*2.2 + dzp/lp*3.4 }
        ],
        fill: '#45ffb0', glow: '#45ffb0', glowBlur: 16, alpha: 0.75, fog: 90
      });
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

  function loadGhost(){
    ghostBest = null;
    try{
      const raw = localStorage.getItem(GHOST_KEY + ':' + (builtTrack || 'loop'));
      if(raw){
        const g = JSON.parse(raw);
        if(g && Array.isArray(g.path) && g.path.length > 4) ghostBest = g;
      }
    }catch(e){ /* no storage — you just race without a ghost */ }
  }

  function saveGhost(ms, path){
    if(!path || path.length < 4) return;
    if(ghostBest && ghostBest.ms <= ms) return;
    ghostBest = { ms, path };
    try{
      localStorage.setItem(GHOST_KEY + ':' + (builtTrack || 'loop'), JSON.stringify(ghostBest));
    }catch(e){}
  }

  // Where the ghost was this far into its lap. Interpolated, because the
  // recording is every third frame and a ghost that steps is worse than none.
  function ghostAt(ms){
    if(!ghostBest) return null;
    const path = ghostBest.path;
    const per = ghostBest.ms / (path.length - 1);
    const f = Math.min(path.length - 1.001, Math.max(0, ms / per));
    const i = Math.floor(f), frac = f - i;
    const a = path[i], b = path[Math.min(path.length - 1, i + 1)];
    let dy = b[2] - a[2];
    while(dy > Math.PI) dy -= Math.PI*2;
    while(dy < -Math.PI) dy += Math.PI*2;
    return { x: a[0] + (b[0]-a[0])*frac, y: 0, z: a[1] + (b[1]-a[1])*frac, yaw: a[2] + dy*frac };
  }

  function checkpointPos(i){
    return centre[Math.round((i / CHECKPOINTS) * NODES) % NODES];
  }

  // Heading along the circuit at t, matching the server's kartTrackYaw.
  function trackYaw(t){
    const a = trackPoint(t), b = trackPoint(t + 0.002);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  // Rows of item boxes across the road. Built once and in the same order as
  // the server, since the state snapshot identifies them by index.
  function buildItemBoxes(){
    itemBoxes = [];
    for(let s = 0; s < BOX_STATIONS; s++){
      const t = (s + 0.5) / BOX_STATIONS;
      const p = trackPoint(t);
      const yaw = trackYaw(t);
      const sx = Math.cos(yaw), sz = -Math.sin(yaw);
      BOX_LANES.forEach(lane => {
        itemBoxes.push({ x: p.x + sx * lane, z: p.z + sz * lane });
      });
    }
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
    hideKartResults();
    speed = 0;
    drift = 0; driftDir = 0; boost = 0;
    lapTimes = [];
    myCheckpoint = 0; myLap = 0; finished = false;
    bestLap = 0; lastLapAt = 0;
    myItem = null; spinUntil = 0; itemFlash = 0; canFire = true;
    mpHazards = []; mpShells = []; mpBoxMask = 0;
    loadGhost();
    ghostRec = []; ghostFrame = 0;
    // Position comes from the server's grid — see needsSpawn in
    // multiplayer.js — so nothing here touches x/z/yaw.
    me.phase = 0; me.moving = false;
    camYaw = me.yaw;
    frame = 0;
  }

  /* ---- items ----------------------------------------------------------
     Called from the socket handlers in multiplayer.js. Not one of these
     decides anything — they're the server's word arriving, and the kart's job
     is to make it visible. */

  function gotItem(item){
    myItem = item;
    itemFlash = 40;
    Sfx.play('coin', 1.2);
    if(typeof toast === 'function'){
      toast(ITEM_NAMES[item] || 'Item', 'SPACE to use it', ITEM_ICONS[item] || '🎁', 'gold');
    }
  }

  function fizzled(){
    // A shell or a bolt with nobody ahead. You still spent it.
    if(typeof toast === 'function') toast('Nothing ahead', 'Wasted', '💨', 'cyan');
  }

  function itemBoost(){
    applyBoost(1);
  }

  function droppedNearby(x, z){
    const me = mpLocal();
    if(Math.hypot(x - me.x, z - me.z) < 40) Sfx.play('click', 0.8);
  }

  function struck(user, by){
    if(user === currentUser){
      spinUntil = Date.now() + SPIN_MS;
      Sfx.play('lose', 1.2);
      if(typeof toast === 'function'){
        toast('Spun out', by ? `${by} got you` : 'You hit something', '💥', 'pink');
      }
    } else {
      Sfx.play('hit', 0.7);
    }
  }

  // Cashing in a slide. Two tiers, so a long committed drift out of a hairpin
  // is worth more than a flick.
  function releaseDrift(){
    let tier = -1;
    if(drift >= MINI_TURBO_AT[1]) tier = 1;
    else if(drift >= MINI_TURBO_AT[0]) tier = 0;
    if(tier >= 0){
      applyBoost(tier);
      Sfx.play(tier === 1 ? 'perfect' : 'coin', 1.3);
    }
    drift = 0; driftDir = 0;
  }

  // tier 0 = pad or short drift, tier 1 = long drift
  function applyBoost(tier){
    const frames = BOOST_FRAMES[tier] || BOOST_FRAMES[0];
    if(boost <= 0) Sfx.play('whoosh');
    boost = Math.max(boost, frames);
    speed = Math.max(speed, MAX_SPEED * (BOOST_KICK[tier] || BOOST_KICK[0]));
  }

  function countdownLeft(){
    return mpStartsAt ? Math.max(0, mpStartsAt - Date.now()) : 0;
  }

  function update(){
    frame++;
    const me = mpLocal();
    if(itemFlash > 0) itemFlash--;

    // Spun out. The server decides this — being hit is not something a client
    // gets a say in — but the local clock runs it out so the spin starts on
    // impact rather than on the next 17Hz snapshot.
    const spinning = Date.now() < spinUntil || me.spun;
    const locked = countdownLeft() > 0 || finished || spinning;

    if(spinning){
      me.yaw += 0.30;
      speed *= 0.88;
      drift = 0; boost = 0;
    }

    if(!locked){
      if(keys.has('w') || keys.has('arrowup')) speed += ACCEL;
      if(keys.has('s') || keys.has('arrowdown')) speed -= BRAKE;
      // Steering bites less at a crawl, so you can't pirouette on the spot.
      const grip = Math.min(1, Math.abs(speed) / 0.12);
      const dir = speed >= 0 ? 1 : -1;
      const turning = (keys.has('a') || keys.has('arrowleft')) ? -1
                    : (keys.has('d') || keys.has('arrowright')) ? 1 : 0;
      const wantDrift = keys.has('shift') && turning !== 0 && Math.abs(speed) > 0.16;

      if(wantDrift){
        // A slide only counts while you keep turning the same way, so
        // flicking left-right doesn't farm boost.
        if(drift === 0 || driftDir === turning){
          driftDir = turning;
          drift++;
        } else {
          drift = 0; driftDir = turning;
        }
        me.yaw += TURN_RATE * DRIFT_TURN * turning * dir;
        speed *= DRIFT_GRIP;
      } else {
        if(drift > 0) releaseDrift();
        me.yaw += TURN_RATE * grip * turning * dir;
      }
    } else {
      drift = 0;
    }

    speed *= DRAG;
    if(boost > 0) boost--;
    const cap = boost > 0 ? MAX_SPEED * BOOST_CAP : MAX_SPEED;
    speed = Math.max(-MAX_SPEED*0.4, Math.min(cap, speed));
    if(locked) speed *= 0.9;

    canFire = !spinning;

    // Boost pads
    if(!locked){
      for(const pad of boostPads){
        if(Math.hypot(pad.x - me.x, pad.z - me.z) < 2.8){
          applyBoost(0);
          break;
        }
      }
    }

    // Off the tarmac you bog down — a shortcut across the infield costs you.
    const off = distanceToTrack(me.x, me.z);
    if(off > 6.2) speed *= OFFTRACK_DRAG;

    me.x += Math.sin(me.yaw) * speed;
    me.z += Math.cos(me.yaw) * speed;
    // Published on the shared player record so anything that cares how fast
    // a kart is going — the HUD, engine pitch — reads one number.
    me.speed = speed;
    me.boosting = boost > 0;
    // Sample the line for the ghost. Rounded hard — this ends up in
    // localStorage and centimetre precision buys nothing.
    if(!locked && !finished && (ghostFrame++ % GHOST_STEP === 0)){
      ghostRec.push([Math.round(me.x*10)/10, Math.round(me.z*10)/10, Math.round(me.yaw*100)/100]);
    }
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
            lapTimes.push(lap);
            if(!bestLap || lap < bestLap) bestLap = lap;
            saveGhost(lap, ghostRec);
          }
          lastLapAt = now;
          ghostRec = []; ghostFrame = 0;
          if(myLap >= LAPS){
            finished = true;
            // Nothing left to use it on, and an item still showing in the
            // slot invites a press that quietly does nothing.
            myItem = null;
            Sfx.play('win');
            showKartResults();
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

    let faces = trackFaces.concat(scenery, itemFaces());
    // Your own best lap, running alongside. Faint and wireless-looking so it
    // can never be mistaken for another player.
    const gp = (ghostBest && lastLapAt) ? ghostAt(Date.now() - lastLapAt) : null;
    if(gp){
      const gk = [];
      gk.push(...Mini3D.box(0, 0.26, 0.1, 1.15, 0.30, 1.85, '#7dd3ff', { alpha: 0.22 }));
      gk.push(...Mini3D.box(0, 0.62, -0.2, 0.5, 0.7, 0.5, '#7dd3ff', { alpha: 0.22 }));
      faces = faces.concat(Mini3D.transform(gk, { x: gp.x, y: 0, z: gp.z, yaw: gp.yaw }));
    }
    const tags = [];
    mpOthers().forEach(({ user, p }) => {
      faces = faces.concat(kartFaces(user, p));
      tags.push({ user, p });
    });
    faces = faces.concat(kartFaces(currentUser, me));

    Mini3D.render(ctx, faces, cam, W, H, FOCAL);
    drawShields(cam);

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

  // Boxes, bananas and shells in flight, all placed from the snapshot the
  // server just sent. A box the server says is taken simply isn't drawn.
  function itemFaces(){
    const out = [];
    const spin = frame * 0.045;
    itemBoxes.forEach((b, i) => {
      if(!(mpBoxMask & (1 << i))) return;
      const bob = Math.sin(frame * 0.06 + i) * 0.18;
      const cube = Mini3D.box(0, 1.15 + bob, 0, 1.15, 1.15, 1.15, '#ffc857',
                              { glow: '#ffc857', glowBlur: 16, alpha: 0.82,
                                stroke: 'rgba(0,0,0,0.35)', fog: 90 });
      out.push(...Mini3D.transform(cube, { x: b.x, y: 0, z: b.z, yaw: spin }));
    });
    mpHazards.forEach(([x, z]) => {
      out.push(...Mini3D.box(x, 0.28, z, 0.7, 0.5, 0.7, '#ffe066',
                             { stroke: 'rgba(0,0,0,0.4)', fog: 90 }));
    });
    const now = Date.now();
    mpShells = mpShells.filter(s => now - s.at < s.ms + 200);
    mpShells.forEach(s => {
      const a = mpPlayers.get(s.from), b = mpPlayers.get(s.to);
      if(!a || !b) return;
      const t = Math.min(1, (now - s.at) / Math.max(1, s.ms));
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      out.push(...Mini3D.box(x, 0.55, z, 0.7, 0.7, 0.7, '#45ffb0',
                             { glow: '#45ffb0', glowBlur: 18, fog: 90 }));
    });
    return out;
  }

  // A shield is a ring drawn over the kart rather than geometry around it —
  // a translucent sphere in a painter's-algorithm renderer sorts badly and
  // ends up swallowing the driver.
  function drawShields(cam){
    ctx.save();
    mpPlayers.forEach((p, user) => {
      if(!p.shield) return;
      const pt = Mini3D.screenPoint({ x: p.x, y: 0.9, z: p.z }, cam, W, H, FOCAL);
      if(!pt) return;
      const r = Math.max(10, 900 / Math.max(2, Math.hypot(p.x - cam.x, p.z - cam.z)));
      ctx.strokeStyle = user === currentUser ? 'rgba(45,226,197,0.85)' : 'rgba(125,211,255,0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -frame * 0.6;
      ctx.beginPath();
      ctx.ellipse(pt.x, pt.y, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  // The item you're carrying, front and centre where you'll see it without
  // taking your eyes off the road.
  function drawItemSlot(){
    const x = W/2, y = 42, size = 46;
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,15,0.6)';
    ctx.strokeStyle = myItem ? 'rgba(255,200,87,0.9)' : 'rgba(232,236,241,0.18)';
    ctx.lineWidth = itemFlash > 0 && (frame >> 2) % 2 ? 3 : 1.5;
    ctx.beginPath();
    ctx.roundRect(x - size/2, y - size/2, size, size, 10);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    if(myItem){
      ctx.font = '26px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(ITEM_ICONS[myItem] || '🎁', x, y + 1);
      ctx.textBaseline = 'alphabetic';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(255,200,87,0.9)';
      ctx.fillText('SPACE', x, y + size/2 + 12);
    } else {
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(232,236,241,0.3)';
      ctx.textBaseline = 'middle';
      ctx.fillText('ITEM', x, y + 1);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
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
    if(boost > 0){
      ctx.fillStyle = '#45ffb0';
      ctx.fillText('BOOST', 16, 78);
    }
    if(bestLap) ctx.fillText(`best ${(bestLap/1000).toFixed(1)}s`, 16, 62);
    if(ghostBest){
      // The time you're chasing, and whether you're up or down on it right
      // now — a ghost you can't measure yourself against is just decoration.
      const into = lastLapAt ? Date.now() - lastLapAt : 0;
      const gp = ghostAt(into);
      let delta = '';
      if(gp && lastLapAt){
        // drawHud has no local kart — the shared record is where "me" lives.
        const me = mpLocal();
        const ahead = ((me.x - gp.x) * Math.sin(gp.yaw) + (me.z - gp.z) * Math.cos(gp.yaw)) > 0;
        delta = Math.hypot(me.x - gp.x, me.z - gp.z) < 1.5 ? ' · level'
              : ahead ? ' · ahead' : ' · behind';
      }
      ctx.fillStyle = 'rgba(125,211,255,0.8)';
      ctx.fillText(`ghost ${(ghostBest.ms/1000).toFixed(1)}s${delta}`, 16, 94);
    }

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
      // Below the item slot, which owns the top of the screen.
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffc857';
      ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 20;
      ctx.fillText('FINISHED', W/2, H/2 - 60);
    }
    ctx.restore();

    drawDriftMeter();
    drawItemSlot();
    drawMinimap();

    // Spun out — say so, because the controls going dead is otherwise
    // indistinguishable from the game having broken.
    if(Date.now() < spinUntil || mpLocal().spun){
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ff3d8a';
      ctx.shadowColor = '#ff3d8a'; ctx.shadowBlur = 18;
      ctx.fillText('SPUN OUT', W/2, H/2 - 40);
      ctx.restore();
    }

    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('W accelerate · S brake · A/D steer · SHIFT drift · SPACE item', 16, H - 14);
    ctx.restore();
  }

  // Charge bar for the current slide, so the two mini-turbo tiers are
  // something you can see coming rather than guess at.
  function drawDriftMeter(){
    if(drift <= 0 && boost <= 0) return;
    const x = W/2 - 60, y = H - 46;
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,15,0.6)';
    ctx.beginPath(); ctx.roundRect(x, y, 120, 9, 5); ctx.fill();
    const t = Math.min(1, drift / MINI_TURBO_AT[1]);
    const tier = drift >= MINI_TURBO_AT[1] ? 2 : drift >= MINI_TURBO_AT[0] ? 1 : 0;
    ctx.fillStyle = boost > 0 ? '#45ffb0' : tier === 2 ? '#ff3d8a' : tier === 1 ? '#ffc857' : '#7dd3ff';
    ctx.beginPath();
    ctx.roundRect(x, y, 120 * (boost > 0 ? 1 : t), 9, 5);
    ctx.fill();
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232,236,241,0.75)';
    ctx.fillText(boost > 0 ? 'BOOST' : tier ? 'MINI-TURBO READY' : 'DRIFTING', W/2, y - 4);
    ctx.restore();
  }

  // Top-down circuit with everyone on it, so you can see who's where without
  // spinning the camera round.
  function drawMinimap(){
    const size = 108, pad = 14;
    const cx = W - size/2 - pad, cy = H - size/2 - pad;
    const scale = (size/2 - 8) / (TRACK_R + 10);
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,15,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, size/2, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(232,236,241,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    centre.forEach((p, i) => {
      const px = cx + p.x*scale, py = cy + p.z*scale;
      if(i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
    // Bananas on the minimap, so a dropped one is a hazard you can plan
    // around rather than one you only meet at 200km/h.
    ctx.fillStyle = 'rgba(255,224,102,0.9)';
    mpHazards.forEach(([x, z]) => {
      ctx.beginPath();
      ctx.arc(cx + x*scale, cy + z*scale, 1.6, 0, Math.PI*2);
      ctx.fill();
    });
    mpPlayers.forEach((p, user) => {
      ctx.fillStyle = user === currentUser ? '#2de2c5' : '#ff3d8a';
      ctx.beginPath();
      ctx.arc(cx + p.x*scale, cy + p.z*scale, user === currentUser ? 3.5 : 2.5, 0, Math.PI*2);
      ctx.fill();
    });
    ctx.restore();
  }

  // Results are shown from what the server told us — mp:finish carries the
  // place and time — so the board can't disagree with what was paid out.
  function showKartResults(){
    const box = document.getElementById('kart-result');
    if(!box) return;
    const mine = mpFinishOrder.find(f => f.user === currentUser);
    document.getElementById('kart-result-text').textContent =
      mine ? (mine.place === 1 ? '🏆 WINNER' : `P${mine.place}`) : 'FINISHED';
    document.getElementById('kart-result-sub').textContent =
      mine ? `${(mine.time/1000).toFixed(1)}s · best lap ${(bestLap/1000).toFixed(1)}s`
           : `best lap ${(bestLap/1000).toFixed(1)}s`;
    document.getElementById('kart-result-board').innerHTML = `
      <table class="trn-table">
        <tr><th>#</th><th>Player</th><th>Time</th></tr>
        ${mpFinishOrder.map(f => `
          <tr class="${f.user === currentUser ? 'trn-me' : ''}">
            <td>${f.place === 1 ? '🥇' : f.place === 2 ? '🥈' : f.place === 3 ? '🥉' : f.place}</td>
            <td>${f.user}</td>
            <td>${(f.time/1000).toFixed(1)}s</td>
          </tr>`).join('')}
      </table>
      ${lapTimes.length ? `<div class="trn-empty">Your laps: ${
        lapTimes.map(t => (t/1000).toFixed(1) + 's').join(' · ')}</div>` : ''}`;
    box.classList.remove('hidden');
  }

  function hideKartResults(){
    const box = document.getElementById('kart-result');
    if(box) box.classList.add('hidden');
  }

  // Firing is a press, not a hold — a keydown edge, so leaning on space can't
  // burn through a box the instant you touch it. The server checks you really
  // have the item, so the worst a stray press does is waste a message.
  function onKeyPress(name){
    if(name !== 'space' && name !== 'e') return;
    if(!myItem || !canFire || finished || countdownLeft() > 0) return;
    Realtime.send({ type: 'mp:kart-use' });
    Sfx.play('select');
    myItem = null;
  }

  function loop(){
    if(!running) return;
    if(!paused) update();
    if(running) render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    showScreen('kart-screen');
    useTrack(typeof mpRoom !== 'undefined' && mpRoom ? mpRoom.track : 'loop');
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

  return { start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning,
           gotItem, fizzled, itemBoost, droppedNearby, struck };
})();
