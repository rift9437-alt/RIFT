/* =========================================================
   CABINET THIRTEEN — the secret horror game (Season 2)
   =========================================================
   There is no cabinet thirteen. It isn't in the grid and it has no card —
   you get here by walking into the crooked gate in the haunted hub.

   A dark corridor you crawl down with a torch that is running out. Something
   is behind you and it only moves when you aren't looking at it, so the game
   is a decision you keep re-making: turn round and hold it off, or keep
   going and gain ground. Reaching the door at the end is the whole win. */
const ThirteenGame = (function(){
  const canvas = document.getElementById('thirteen-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const FOCAL = 300;
  const CORRIDOR_LEN = 120;     // world units to the door
  const HALF_W = 3.2;
  const WALK = 0.075;
  const TURN = 0.05;
  const TORCH_START = 100;      // percent
  const TORCH_DRAIN = 0.028;    // per frame while walking
  const STALKER_NEAR = 2.2;     // this close and it takes you

  let rafId = null, running = false, paused = false;
  let px, pz, yaw, torch, stalkerZ, stalkerLunge;
  let frame, walls, ended, endedWell, flicker, heartbeat;

  // The corridor: two walls of panels plus a floor, built once per run so the
  // debris is different each time.
  function buildCorridor(){
    const out = [];
    const edge = { stroke: 'rgba(0,0,0,0.45)', lineWidth: 1 };
    for(let z = -4; z < CORRIDOR_LEN; z += 4){
      const shade = ((z / 4) | 0) % 2 ? '#141019' : '#181322';
      out.push({
        pts: [
          { x: -HALF_W, y: 0, z }, { x: HALF_W, y: 0, z },
          { x: HALF_W, y: 0, z: z + 4 }, { x: -HALF_W, y: 0, z: z + 4 }
        ],
        fill: shade, fog: 26
      });
      // ceiling, so the torch has something to bounce off
      out.push({
        pts: [
          { x: -HALF_W, y: 4, z }, { x: -HALF_W, y: 4, z: z + 4 },
          { x: HALF_W, y: 4, z: z + 4 }, { x: HALF_W, y: 4, z }
        ],
        fill: '#0c0912', fog: 26
      });
      [-1, 1].forEach(side => {
        out.push(...Mini3D.box(side * HALF_W, 2, z + 2, 0.3, 4, 4,
                               side > 0 ? '#1b1526' : '#171122', { ...edge, fog: 26 }));
      });
      // the occasional doorway that goes nowhere
      if(((z / 4) | 0) % 5 === 3){
        const side = ((z / 4) | 0) % 10 === 3 ? -1 : 1;
        out.push(...Mini3D.box(side * (HALF_W - 0.18), 1.2, z + 2, 0.1, 2.4, 1.4,
                               '#05030a', { fog: 26 }));
      }
    }
    // the door at the end
    out.push(...Mini3D.box(0, 1.5, CORRIDOR_LEN, 2.4, 3, 0.3, '#3a2416',
                           { stroke: 'rgba(0,0,0,0.5)' }));
    out.push(...Mini3D.box(0.8, 1.5, CORRIDOR_LEN - 0.2, 0.18, 0.18, 0.18, '#c9ff2e',
                           { glow: '#c9ff2e', glowBlur: 20 }));
    return out;
  }

  function reset(){
    px = 0; pz = 0; yaw = 0;
    torch = TORCH_START;
    stalkerZ = -14;
    stalkerLunge = 0;
    frame = 0;
    ended = false; endedWell = false;
    flicker = 0; heartbeat = 0;
    walls = buildCorridor();
  }

  // Are we facing back down the corridor? Looking at it is what holds it.
  function lookingBack(){
    const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return a > Math.PI * 0.55 && a < Math.PI * 1.45;
  }

  function update(){
    frame++;
    if(ended) return;

    if(keys.has('a') || keys.has('arrowleft')) yaw -= TURN;
    if(keys.has('d') || keys.has('arrowright')) yaw += TURN;

    let drive = 0;
    if(keys.has('w') || keys.has('arrowup')) drive = 1;
    if(keys.has('s') || keys.has('arrowdown')) drive = -0.6;
    const step = WALK * drive;
    px = clamp(px + Math.sin(yaw) * step, -HALF_W + 0.5, HALF_W - 0.5);
    pz += Math.cos(yaw) * step;

    // The torch only burns while you move, so standing still to watch the
    // corridor is free — the cost of turning round is the ground you don't
    // cover, not the light.
    if(Math.abs(step) > 0.001) torch -= TORCH_DRAIN;
    torch = Math.max(0, torch);

    // The stalker. Held while you look at it, and faster the darker it gets.
    const watching = lookingBack();
    if(!watching){
      const dark = 1 + (1 - torch / TORCH_START) * 1.4;
      stalkerZ += 0.055 * dark;
    } else {
      stalkerZ -= 0.012;                // it gives a little ground, grudgingly
      stalkerLunge = Math.max(0, stalkerLunge - 1);
    }
    if(torch <= 0) stalkerZ += 0.05;     // in the dark, looking doesn't help

    const gap = pz - stalkerZ;
    heartbeat = Math.max(0, 1 - gap / 18);
    flicker = torch < 25 ? Math.random() : 0;

    if(gap < STALKER_NEAR){ finish(false); return; }
    if(pz >= CORRIDOR_LEN - 1.5){ finish(true); return; }
  }

  function finish(won){
    ended = true;
    endedWell = won;
    running = false;
    Sfx.play(won ? 'win' : 'lose');
    document.getElementById('thirteen-result-text').textContent =
      won ? 'YOU GOT OUT' : 'IT CAUGHT YOU';
    document.getElementById('thirteen-result-sub').textContent = won
      ? 'The door was never locked. It never has been.'
      : `You made it ${Math.max(0, Math.round(pz))} of ${CORRIDOR_LEN} steps.`;
    document.getElementById('thirteen-play').classList.add('hidden');
    document.getElementById('thirteen-result').classList.remove('hidden');
    if(won){
      // The secret achievement, and the arcade's own secret counter.
      if(typeof postSpooky === 'function') postSpooky('thirteenth', 1);
      if(typeof earnTokens === 'function') earnTokens('secret_found', 1);
      if(typeof toast === 'function'){
        toast('Cabinet Thirteen', 'You found what was behind the door', '🚪', 'gold');
      }
    }
  }

  function render(){
    const cam = { x: px, y: 1.6, z: pz, yaw, pitch: 0 };
    // No sky — a corridor has no horizon, and the black is the point.
    ctx.fillStyle = '#05030a';
    ctx.fillRect(0, 0, W, H);

    let faces = walls;

    // The stalker is a shape, never a face. It reads as worse that way, and
    // it means the model can stay as cheap as everything else here.
    const gap = pz - stalkerZ;
    if(gap < 34){
      const body = [];
      const sway = Math.sin(frame * 0.08) * 0.12;
      body.push(...Mini3D.box(0, 1.05, 0, 0.9, 2.1, 0.5, '#0a0710', { alpha: 0.97 }));
      body.push(...Mini3D.box(0, 2.35, 0, 0.62, 0.6, 0.5, '#0a0710', { alpha: 0.97 }));
      body.push(...Mini3D.box(-0.62 + sway, 1.3, 0, 0.22, 1.5, 0.22, '#0a0710', { alpha: 0.97 }));
      body.push(...Mini3D.box( 0.62 - sway, 1.3, 0, 0.22, 1.5, 0.22, '#0a0710', { alpha: 0.97 }));
      // two pale points where a face would be
      body.push(...Mini3D.box(-0.14, 2.42, 0.26, 0.09, 0.05, 0.05, '#c9ff2e',
                              { glow: '#c9ff2e', glowBlur: 14 }));
      body.push(...Mini3D.box( 0.14, 2.42, 0.26, 0.09, 0.05, 0.05, '#c9ff2e',
                              { glow: '#c9ff2e', glowBlur: 14 }));
      faces = faces.concat(Mini3D.transform(body, { x: 0, y: 0, z: stalkerZ, yaw: 0 }));
    }

    Mini3D.render(ctx, faces, cam, W, H, FOCAL);

    // Torchlight: a vignette that closes in as the battery goes. Everything
    // outside it is simply not lit.
    const reach = 0.18 + (torch / TORCH_START) * 0.42 - flicker * 0.06;
    const g = ctx.createRadialGradient(W/2, H/2, W * Math.max(0.05, reach * 0.35),
                                       W/2, H/2, W * Math.max(0.12, reach));
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.97)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Getting close pulls the edges red.
    if(heartbeat > 0.1){
      const pulse = (Math.sin(frame * 0.22) * 0.5 + 0.5) * heartbeat;
      const r = ctx.createRadialGradient(W/2, H/2, W * 0.22, W/2, H/2, W * 0.62);
      r.addColorStop(0, 'rgba(0,0,0,0)');
      r.addColorStop(1, `rgba(150,10,20,${(0.5 * pulse).toFixed(3)})`);
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    }

    drawHud();
  }

  function drawHud(){
    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(201,255,46,0.75)';
    ctx.fillText('TORCH', 16, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(16, 32, 120, 8);
    ctx.fillStyle = torch < 25 ? '#ff5454' : '#c9ff2e';
    ctx.fillRect(16, 32, 120 * (torch / TORCH_START), 8);

    ctx.fillStyle = 'rgba(232,236,241,0.5)';
    ctx.fillText(`${Math.max(0, Math.round(CORRIDOR_LEN - pz))} steps to the door`, 16, 58);

    if(lookingBack()){
      ctx.fillStyle = '#c9ff2e';
      ctx.fillText('HOLDING IT', 16, 76);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232,236,241,0.4)';
    ctx.fillText('W walk · A/D turn · look back to hold it · the torch only burns while you move', 16, H - 14);
    ctx.restore();
  }

  function onKeyPress(){}

  function loop(){
    if(!running) return;
    if(!paused) update();
    render();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    showScreen('thirteen-screen');
    document.getElementById('thirteen-result').classList.add('hidden');
    document.getElementById('thirteen-play').classList.remove('hidden');
    reset();
    paused = false; running = true;
    loop();
  }
  function stop(){ running = false; paused = false; if(rafId) cancelAnimationFrame(rafId); }
  function pause(){ if(running) paused = true; }
  function resume(){ paused = false; }
  function isPaused(){ return paused; }
  function isRunning(){ return running; }

  return { start, stop, reset, onKeyPress, pause, resume, isPaused, isRunning };
})();
