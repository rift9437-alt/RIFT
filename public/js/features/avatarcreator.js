/* =========================================================
   AVATAR CREATOR
   =========================================================
   A live turntable preview of the Avatar3D model with swatches for each
   part. Nothing is saved until you press Save, so backing out leaves your
   look alone — the preview edits a working copy, not the wallet. */
let avatarDraft = null;
let avatarPreviewRaf = null;
let avatarSpin = 0;
let avatarDragging = false;
let avatarLastX = 0;
let avatarWalking = true;
let avatarPhase = 0;

// Every player's look, so worlds can draw the right person. Populated once
// on entry and patched by the socket when somebody changes theirs.
let avatarBook = {};

async function loadAvatarBook(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/avatars`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    avatarBook = (await res.json()).avatars || {};
  }catch(e){
    console.error('Avatar book load failed:', e);
  }
  return avatarBook;
}

// Falls back to a deterministic look seeded from the name, so a player who
// has never opened the editor still shows up as a distinct character rather
// than a default grey one shared with everyone else.
function avatarFor(user){
  const stored = avatarBook[user];
  return stored ? Avatar3D.normalize(stored) : Avatar3D.random(user);
}

function openAvatarCreator(){
  showScreen('avatar-screen');
  avatarDraft = Avatar3D.normalize(
    (wallet && wallet.avatar3d) || avatarFor(currentUser));
  renderAvatarControls();
  startAvatarPreview();
}

function closeAvatarCreator(){
  stopAvatarPreview();
  backToDashboard();
}

/* ---- preview -------------------------------------------------------- */

function startAvatarPreview(){
  stopAvatarPreview();
  const canvas = document.getElementById('avatar-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  function frame(){
    if(!avatarDragging) avatarSpin += 0.012;
    if(avatarWalking) avatarPhase += 0.16;
    else avatarPhase += 0.02;

    const cam = { x: 0, y: 0.98, z: -2.9, yaw: 0, pitch: -0.03 };
    Mini3D.sky(ctx, W, H, cam, {
      focal: 420,
      skyTop: '#0a0d13', skyBottom: '#171f30',
      groundNear: '#141c2c', groundFar: '#080b11'
    });

    // A ring on the floor so the model reads as standing on something.
    const ring = [];
    const R = 1.05;
    for(let i=0;i<24;i++){
      const a0 = (i/24)*Math.PI*2, a1 = ((i+1)/24)*Math.PI*2;
      ring.push({
        pts: [
          { x: Math.cos(a0)*R, y: 0.01, z: Math.sin(a0)*R },
          { x: Math.cos(a1)*R, y: 0.01, z: Math.sin(a1)*R },
          { x: Math.cos(a1)*R*0.82, y: 0.01, z: Math.sin(a1)*R*0.82 },
          { x: Math.cos(a0)*R*0.82, y: 0.01, z: Math.sin(a0)*R*0.82 }
        ],
        fill: i % 2 ? 'rgba(45,226,197,0.22)' : 'rgba(45,226,197,0.08)'
      });
    }

    const faces = ring.concat(Avatar3D.build(avatarDraft, {
      x: 0, y: 0, z: 0, yaw: avatarSpin, phase: avatarPhase, moving: avatarWalking
    }));
    Mini3D.render(ctx, faces, cam, W, H, 420);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232,236,241,0.45)';
    ctx.textAlign = 'center';
    ctx.fillText('DRAG TO TURN', W/2, H - 12);

    avatarPreviewRaf = requestAnimationFrame(frame);
  }
  frame();

  // Drag to spin, on both mouse and touch.
  const down = x => { avatarDragging = true; avatarLastX = x; };
  const move = x => {
    if(!avatarDragging) return;
    avatarSpin -= (x - avatarLastX) * 0.012;
    avatarLastX = x;
  };
  const up = () => { avatarDragging = false; };

  canvas.onmousedown = e => down(e.clientX);
  window.addEventListener('mousemove', avatarMouseMove);
  window.addEventListener('mouseup', up);
  canvas.ontouchstart = e => { down(e.touches[0].clientX); };
  canvas.ontouchmove = e => { move(e.touches[0].clientX); e.preventDefault(); };
  canvas.ontouchend = up;

  function avatarMouseMove(e){ move(e.clientX); }
  // Kept on the element so stopAvatarPreview can unhook them again.
  canvas.__avatarMove = avatarMouseMove;
  canvas.__avatarUp = up;
}

function stopAvatarPreview(){
  if(avatarPreviewRaf) cancelAnimationFrame(avatarPreviewRaf);
  avatarPreviewRaf = null;
  avatarDragging = false;
  const canvas = document.getElementById('avatar-canvas');
  if(canvas && canvas.__avatarMove){
    window.removeEventListener('mousemove', canvas.__avatarMove);
    window.removeEventListener('mouseup', canvas.__avatarUp);
    canvas.__avatarMove = null;
    canvas.__avatarUp = null;
  }
}

/* ---- controls ------------------------------------------------------- */

function swatchRow(part, colors){
  return colors.map(c => `
    <button class="av-swatch ${avatarDraft[part] === c ? 'selected' : ''}"
            style="background:${c}" title="${c}"
            onclick="setAvatarPart('${part}','${c}')"></button>`).join('');
}

function renderAvatarControls(){
  const box = document.getElementById('avatar-controls');
  if(!box) return;
  box.innerHTML = `
    <div class="av-group"><div class="setup-section-label">Skin</div>
      <div class="av-row">${swatchRow('skin', Avatar3D.SKINS)}</div></div>
    <div class="av-group"><div class="setup-section-label">Shirt</div>
      <div class="av-row">${swatchRow('shirt', Avatar3D.SHIRTS)}</div></div>
    <div class="av-group"><div class="setup-section-label">Trousers</div>
      <div class="av-row">${swatchRow('pants', Avatar3D.PANTS)}</div></div>
    <div class="av-group"><div class="setup-section-label">Shoes</div>
      <div class="av-row">${swatchRow('shoes', Avatar3D.SHOES)}</div></div>
    <div class="av-group"><div class="setup-section-label">Hat</div>
      <div class="av-row">
        ${Avatar3D.HATS.map(h => `
          <button class="option-btn av-hat ${avatarDraft.hat === h.id ? 'selected' : ''}"
                  onclick="setAvatarPart('hat','${h.id}')">${h.name}</button>`).join('')}
      </div></div>
    ${avatarDraft.hat === 'none' ? '' : `
      <div class="av-group"><div class="setup-section-label">Hat colour</div>
        <div class="av-row">${swatchRow('hatColor', Avatar3D.SHIRTS)}</div></div>`}
    <div class="av-actions">
      <button class="btn btn-secondary" onclick="randomizeAvatar()">🎲 Surprise me</button>
      <button class="btn btn-ghost" onclick="toggleAvatarWalk()"
              id="avatar-walk-btn">${avatarWalking ? 'Stand still' : 'Walk'}</button>
    </div>
    <div class="clan-error" id="avatar-error"></div>
    <button class="btn btn-primary" onclick="saveAvatar()">Save avatar</button>`;
}

function setAvatarPart(part, value){
  avatarDraft[part] = value;
  Sfx.play('click');
  renderAvatarControls();
}

function randomizeAvatar(){
  avatarDraft = Avatar3D.random();
  Sfx.play('whoosh');
  renderAvatarControls();
}

function toggleAvatarWalk(){
  avatarWalking = !avatarWalking;
  const btn = document.getElementById('avatar-walk-btn');
  if(btn) btn.textContent = avatarWalking ? 'Stand still' : 'Walk';
}

async function saveAvatar(){
  const err = document.getElementById('avatar-error');
  if(err) err.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/avatar3d`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, avatar: avatarDraft })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      if(err) err.textContent = data.error || 'Could not save that.';
      return;
    }
    if(wallet) wallet.avatar3d = data.avatar;
    avatarBook[currentUser] = data.avatar;
    Sfx.play('win');
    toast('Avatar saved', 'You look like that everywhere now', '🧍', 'cyan');
  }catch(e){
    console.error('Avatar save failed:', e);
    if(err) err.textContent = 'Network error — try again.';
  }
}
