/* =========================================================
   MINI3D — a small software 3D renderer on top of canvas 2D
   Enough of a pipeline for the three 3D cabinets: world → camera space →
   near-plane clip → perspective projection → painter's-algorithm fill. No
   libraries, no WebGL, and it keeps the same flat-shaded neon look as the
   rest of the arcade. */
const Mini3D = (function(){
  const NEAR = 0.35;

  // World space is right-handed-ish: +x right, +y up, +z forward (away).
  function toView(p, cam){
    const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
    const cy = Math.cos(cam.yaw||0), sy = Math.sin(cam.yaw||0);
    let x = dx*cy - dz*sy;
    let z = dx*sy + dz*cy;
    const cp = Math.cos(cam.pitch||0), sp = Math.sin(cam.pitch||0);
    const y = dy*cp - z*sp;
    z = dy*sp + z*cp;
    if(cam.roll){
      const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
      const rx = x*cr - y*sr, ry = x*sr + y*cr;
      return { x:rx, y:ry, z };
    }
    return { x, y, z };
  }

  function project(v, W, H, focal){
    const s = focal / v.z;
    return { x: W/2 + v.x*s, y: H/2 - v.y*s, z: v.z, s };
  }

  // Sutherland–Hodgman against the single z >= NEAR plane. Without this,
  // geometry behind the camera projects to a mirrored mess on screen.
  function clipNear(pts){
    const out = [];
    for(let i=0;i<pts.length;i++){
      const a = pts[i], b = pts[(i+1)%pts.length];
      const aIn = a.z >= NEAR, bIn = b.z >= NEAR;
      if(aIn) out.push(a);
      if(aIn !== bIn){
        const t = (NEAR - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t, z: NEAR });
      }
    }
    return out;
  }

  function shade(hex, mult){
    const h = hex.replace('#','');
    const full = h.length === 3 ? h.split('').map(c=>c+c).join('') : h;
    const n = parseInt(full, 16);
    const r = Math.min(255, Math.round(((n>>16)&255) * mult));
    const g = Math.min(255, Math.round(((n>>8)&255) * mult));
    const b = Math.min(255, Math.round((n&255) * mult));
    return `rgb(${r},${g},${b})`;
  }

  // faces: [{pts:[{x,y,z}...], fill, stroke, lineWidth, glow, alpha, fog}]
  // Sorted back-to-front and filled — cheap, and correct enough for convex,
  // non-interpenetrating shapes like blocks, rings and tunnel panels.
  function render(ctx, faces, cam, W, H, focal){
    const prepared = [];
    for(const f of faces){
      const view = f.pts.map(p=>toView(p, cam));
      const clipped = clipNear(view);
      if(clipped.length < 3) continue;
      let depth = 0;
      for(const v of clipped) depth += v.z;
      depth /= clipped.length;
      prepared.push({ f, clipped, depth });
    }
    prepared.sort((a,b)=> b.depth - a.depth);

    for(const item of prepared){
      const f = item.f;
      const screen = item.clipped.map(v=>project(v, W, H, focal));
      ctx.save();
      if(f.alpha != null) ctx.globalAlpha = f.alpha;
      // Optional distance fog: far geometry fades toward the background.
      if(f.fog){
        const fade = Math.max(0.12, Math.min(1, f.fog / item.depth));
        ctx.globalAlpha = (f.alpha == null ? 1 : f.alpha) * fade;
      }
      ctx.beginPath();
      ctx.moveTo(screen[0].x, screen[0].y);
      for(let i=1;i<screen.length;i++) ctx.lineTo(screen[i].x, screen[i].y);
      ctx.closePath();
      if(f.glow){ ctx.shadowColor = f.glow; ctx.shadowBlur = f.glowBlur || 14; }
      if(f.fill){ ctx.fillStyle = f.fill; ctx.fill(); }
      if(f.stroke){
        ctx.shadowBlur = f.glow ? (f.glowBlur || 14) : 0;
        ctx.strokeStyle = f.stroke;
        ctx.lineWidth = f.lineWidth || 1;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Six faces of an axis-aligned box, flat-shaded from a fixed key light.
  const BOX_SHADE = { top:1.18, bottom:0.45, front:0.92, back:0.62, right:0.78, left:0.68 };
  function box(cx, cy, cz, sx, sy, sz, color, opts){
    const o = opts || {};
    const x0 = cx-sx/2, x1 = cx+sx/2;
    const y0 = cy-sy/2, y1 = cy+sy/2;
    const z0 = cz-sz/2, z1 = cz+sz/2;
    const P = (x,y,z)=>({x,y,z});
    const mk = (pts, key)=>({
      pts,
      fill: shade(color, BOX_SHADE[key]),
      stroke: o.stroke || 'rgba(255,255,255,0.16)',
      lineWidth: o.lineWidth || 1,
      glow: o.glow,
      glowBlur: o.glowBlur,
      alpha: o.alpha,
      fog: o.fog
    });
    return [
      mk([P(x0,y1,z0),P(x1,y1,z0),P(x1,y1,z1),P(x0,y1,z1)], 'top'),
      mk([P(x0,y0,z0),P(x0,y0,z1),P(x1,y0,z1),P(x1,y0,z0)], 'bottom'),
      mk([P(x0,y0,z0),P(x1,y0,z0),P(x1,y1,z0),P(x0,y1,z0)], 'front'),
      mk([P(x1,y0,z1),P(x0,y0,z1),P(x0,y1,z1),P(x1,y1,z1)], 'back'),
      mk([P(x1,y0,z0),P(x1,y0,z1),P(x1,y1,z1),P(x1,y1,z0)], 'right'),
      mk([P(x0,y0,z1),P(x0,y0,z0),P(x0,y1,z0),P(x0,y1,z1)], 'left')
    ];
  }

  return { render, toView, project, clipNear, shade, box, NEAR };
})();
