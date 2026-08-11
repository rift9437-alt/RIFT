/* =========================================================
   AVATAR3D — the blocky character everyone plays as
   =========================================================
   Built out of Mini3D boxes in local space (facing +z, feet at y=0), then
   placed in the world with Mini3D.transform. Same model is used for the
   editor preview, the shared world, and the kart racer, so a player looks
   like themselves everywhere.

   The walk cycle is driven by a `phase` the caller advances — no internal
   clock — which means a remote player animates off the movement we actually
   received for them rather than guessing. */
const Avatar3D = (function(){

  // Proportions in world units. One unit is roughly a third of a metre, so a
  // whole avatar is about 1.9 units tall.
  const D = {
    legH: 0.62, legW: 0.26, legD: 0.26,
    torsoH: 0.68, torsoW: 0.60, torsoD: 0.34,
    armH: 0.62, armW: 0.20, armD: 0.22,
    headH: 0.52, headW: 0.52, headD: 0.48,
    hatH: 0.16
  };
  const TOTAL_H = D.legH + D.torsoH + D.headH;

  const SKINS   = ['#f2c6a0', '#e0a878', '#b57a52', '#8a5535', '#5c3a24', '#c9d7e8'];
  const SHIRTS  = ['#2de2c5', '#ff3d8a', '#ffc857', '#7dd3ff', '#45ffb0', '#c084fc',
                   '#ff8a3d', '#e8ecf1', '#ff5454', '#8b6dff'];
  const PANTS   = ['#2a3550', '#1c2b40', '#4a3550', '#3a2a1c', '#20303a', '#111820'];
  const SHOES   = ['#101620', '#e8ecf1', '#ff3d8a', '#2de2c5', '#ffc857'];
  const HATS    = [
    { id:'none',   name:'None' },
    { id:'cap',    name:'Cap' },
    { id:'crown',  name:'Crown' },
    { id:'band',   name:'Headband' },
    { id:'antenna',name:'Antenna' },
    { id:'top',    name:'Top Hat' }
  ];

  const DEFAULT = {
    skin: SKINS[0], shirt: SHIRTS[0], pants: PANTS[0], shoes: SHOES[0],
    hat: 'none', hatColor: '#ffc857'
  };

  // Anything missing or unrecognised falls back to the default, so a config
  // from an older build (or a hand-edited one) still renders a whole person.
  function normalize(cfg){
    const c = Object.assign({}, DEFAULT, cfg || {});
    const hex = v => /^#[0-9a-fA-F]{6}$/.test(v || '');
    if(!hex(c.skin)) c.skin = DEFAULT.skin;
    if(!hex(c.shirt)) c.shirt = DEFAULT.shirt;
    if(!hex(c.pants)) c.pants = DEFAULT.pants;
    if(!hex(c.shoes)) c.shoes = DEFAULT.shoes;
    if(!hex(c.hatColor)) c.hatColor = DEFAULT.hatColor;
    if(!HATS.some(h => h.id === c.hat)) c.hat = 'none';
    return c;
  }

  // A limb swings about its top, so it's built as a box whose centre is
  // offset along the swing rather than rotated in place — enough for a
  // readable walk at this blockiness, and far cheaper than a joint hierarchy.
  function limb(cx, topY, w, h, d, swing, color, opts){
    const lean = Math.sin(swing) * 0.30;
    const lift = Math.abs(Math.sin(swing)) * 0.04;
    return Mini3D.box(cx, topY - h/2 + lift, lean * h * 0.5, w, h, d, color, opts);
  }

  /* Build the faces for one avatar.
       cfg   — appearance (see DEFAULT)
       place — { x, y, z, yaw, phase, moving, scale }
     `phase` advances with distance travelled, so the legs keep step with the
     ground instead of running on the spot. */
  function build(cfg, place){
    const c = normalize(cfg);
    const p = place || {};
    const phase = p.phase || 0;
    const swing = p.moving ? phase : 0;
    // A gentle idle bob so a standing avatar doesn't look like a statue.
    const bob = p.moving ? Math.abs(Math.sin(phase)) * 0.05
                         : Math.sin((p.phase || 0) * 0.35) * 0.02;
    const edge = { stroke: 'rgba(0,0,0,0.30)', lineWidth: 1 };
    const f = [];

    const hipY = D.legH;
    const shoulderY = hipY + D.torsoH;
    const headY = shoulderY + D.headH / 2;

    // legs
    f.push(...limb(-D.legW*0.62, hipY + bob, D.legW, D.legH, D.legD,  swing, c.pants, edge));
    f.push(...limb( D.legW*0.62, hipY + bob, D.legW, D.legH, D.legD, -swing, c.pants, edge));
    // shoes, parked at the foot of each leg so they swing with it
    f.push(...limb(-D.legW*0.62, 0.14 + bob, D.legW*1.05, 0.14, D.legD*1.25,  swing, c.shoes, edge));
    f.push(...limb( D.legW*0.62, 0.14 + bob, D.legW*1.05, 0.14, D.legD*1.25, -swing, c.shoes, edge));

    // torso
    f.push(...Mini3D.box(0, hipY + D.torsoH/2 + bob, 0,
                         D.torsoW, D.torsoH, D.torsoD, c.shirt, edge));

    // arms — opposite phase to the legs, as a real gait does
    f.push(...limb(-(D.torsoW/2 + D.armW/2 + 0.02), shoulderY + bob,
                   D.armW, D.armH, D.armD, -swing, c.shirt, edge));
    f.push(...limb( (D.torsoW/2 + D.armW/2 + 0.02), shoulderY + bob,
                   D.armW, D.armH, D.armD,  swing, c.shirt, edge));
    // hands
    f.push(...limb(-(D.torsoW/2 + D.armW/2 + 0.02), shoulderY - D.armH + 0.10 + bob,
                   D.armW*1.02, 0.14, D.armD*1.02, -swing, c.skin, edge));
    f.push(...limb( (D.torsoW/2 + D.armW/2 + 0.02), shoulderY - D.armH + 0.10 + bob,
                   D.armW*1.02, 0.14, D.armD*1.02,  swing, c.skin, edge));

    // head
    f.push(...Mini3D.box(0, headY + bob, 0, D.headW, D.headH, D.headD, c.skin, edge));
    // eyes, sitting just proud of the face so they never z-fight with it
    const eyeZ = D.headD/2 + 0.012;
    const eye = { stroke: 'rgba(0,0,0,0.5)', lineWidth: 1 };
    f.push(...Mini3D.box(-0.12, headY + 0.06 + bob, eyeZ, 0.09, 0.11, 0.02, '#0b0f17', eye));
    f.push(...Mini3D.box( 0.12, headY + 0.06 + bob, eyeZ, 0.09, 0.11, 0.02, '#0b0f17', eye));

    // hat
    const hatY = headY + D.headH/2;
    if(c.hat === 'cap'){
      f.push(...Mini3D.box(0, hatY + 0.06 + bob, 0, D.headW*1.04, 0.14, D.headD*1.04, c.hatColor, edge));
      f.push(...Mini3D.box(0, hatY + 0.01 + bob, D.headD*0.62, D.headW*0.96, 0.05, 0.30, c.hatColor, edge));
    } else if(c.hat === 'crown'){
      for(let i=0;i<5;i++){
        const a = (i/5) * Math.PI*2;
        f.push(...Mini3D.box(Math.cos(a)*0.20, hatY + 0.12 + bob, Math.sin(a)*0.20,
                             0.09, 0.20, 0.09, c.hatColor, edge));
      }
      f.push(...Mini3D.box(0, hatY + 0.04 + bob, 0, D.headW*1.02, 0.10, D.headD*1.02, c.hatColor, edge));
    } else if(c.hat === 'band'){
      f.push(...Mini3D.box(0, hatY - 0.10 + bob, 0, D.headW*1.05, 0.09, D.headD*1.05, c.hatColor, edge));
    } else if(c.hat === 'antenna'){
      f.push(...Mini3D.box(0, hatY + 0.18 + bob, 0, 0.05, 0.34, 0.05, '#8b94a7', edge));
      f.push(...Mini3D.box(0, hatY + 0.40 + bob, 0, 0.14, 0.14, 0.14, c.hatColor,
                           { glow: c.hatColor, glowBlur: 12 }));
    } else if(c.hat === 'top'){
      f.push(...Mini3D.box(0, hatY + 0.03 + bob, 0, D.headW*1.35, 0.06, D.headD*1.35, c.hatColor, edge));
      f.push(...Mini3D.box(0, hatY + 0.24 + bob, 0, D.headW*0.80, 0.38, D.headD*0.80, c.hatColor, edge));
    }

    return Mini3D.transform(f, {
      x: p.x || 0, y: p.y || 0, z: p.z || 0,
      yaw: p.yaw || 0, scale: p.scale == null ? 1 : p.scale
    });
  }

  // A random-but-valid look, used for the "surprise me" button and to give
  // any player who has never opened the editor something better than grey.
  function random(seed){
    // Deterministic when handed a seed, so the same name always gets the
    // same starter look rather than reshuffling on every load.
    let n = 0;
    const str = String(seed == null ? Math.random() : seed);
    for(let i=0;i<str.length;i++) n = (n*31 + str.charCodeAt(i)) >>> 0;
    const pick = arr => { n = (n * 1103515245 + 12345) >>> 0; return arr[n % arr.length]; };
    return {
      skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS),
      shoes: pick(SHOES), hat: pick(HATS).id, hatColor: pick(SHIRTS)
    };
  }

  return { build, normalize, random, DEFAULT, SKINS, SHIRTS, PANTS, SHOES, HATS, TOTAL_H, D };
})();
