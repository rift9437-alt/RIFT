/* =========================================================
   COMMUNITY: goal bar, prestige, user-created cosmetics
   ========================================================= */
let communityGoalInfo = null;
let prestigeInfo = null;
let cosmeticTab = 'avatar';
let cosmeticSubmissions = [];
let cosmeticWinners = [];

async function loadCommunityGoal(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/community-goal`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    communityGoalInfo = await res.json();
  }catch(e){
    console.error('Community goal load failed:', e);
  }
}

function renderGoalBar(){
  const track = document.getElementById('goal-bar-track');
  const fill = document.getElementById('goal-bar-fill');
  const label = document.getElementById('goal-bar-label');
  if(!track || !communityGoalInfo) return;
  const pct = Math.min(100, (communityGoalInfo.progress / communityGoalInfo.target) * 100);
  fill.style.width = pct.toFixed(2) + '%';
  track.classList.toggle('completed', !!communityGoalInfo.completed);
  const progressText = communityGoalInfo.progress.toLocaleString();
  const targetText = communityGoalInfo.target.toLocaleString();
  label.textContent = communityGoalInfo.completed
    ? `✓ Complete! ${progressText} / ${targetText} crates opened — everyone claimed their reward.`
    : `${communityGoalInfo.title || 'Open Loot Crates'}: ${progressText} / ${targetText}`;
}

async function loadPrestigeInfo(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/prestige/info?user=${encodeURIComponent(currentUser)}`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    prestigeInfo = await res.json();
  }catch(e){
    console.error('Prestige info load failed:', e);
  }
}

function renderPrestige(){
  const badgesEl = document.getElementById('prestige-badges');
  const statusEl = document.getElementById('prestige-status');
  const btn = document.getElementById('prestige-btn');
  if(!badgesEl || !prestigeInfo) return;
  const current = prestigeInfo.currentPrestige || 0;
  const max = prestigeInfo.maxPrestige || 3;
  badgesEl.innerHTML = Array.from({length: max}, (_, i) => {
    const tier = i + 1;
    const earned = tier <= current;
    const color = (prestigeInfo.tiers[tier] || {}).badgeColor || '#888';
    return `<div class="prestige-pip ${earned ? 'earned' : ''}" style="${earned ? `background:${color}; color:${color};` : ''}" title="Prestige ${tier}"></div>`;
  }).join('');

  if(current >= max){
    statusEl.textContent = `Maximum prestige reached — ${(prestigeInfo.tiers[max] || {}).name || 'Prestige III'}.`;
    btn.disabled = true; btn.textContent = 'Maxed Out';
  } else if(prestigeInfo.eligible){
    const nextTier = prestigeInfo.tiers[current + 1] || {};
    statusEl.textContent = `Level ${prestigeInfo.currentLevel} — ready to prestige into ${nextTier.name || 'the next tier'}!`;
    btn.disabled = false; btn.textContent = `Prestige into ${nextTier.name || ''}`;
  } else {
    statusEl.textContent = `Level ${prestigeInfo.currentLevel} / ${prestigeInfo.requiredLevel} required to prestige.`;
    btn.disabled = true; btn.textContent = 'Locked';
  }
}

async function doPrestige(){
  if(!currentUser) return;
  if(!confirm('Prestige now? Your level, XP, and per-game leaderboard stats will reset to zero. Tokens, themes, and achievements are kept.')) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/prestige`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser})
    });
    const data = await res.json();
    if(!res.ok){ alert(data.error || 'Prestige failed'); return; }
    wallet = data;
    updateTokenDisplay();
    await loadPrestigeInfo();
    renderPrestige();
  }catch(e){
    console.error('Prestige failed:', e);
    alert('Prestige failed — try again.');
  }
}

function setCosmeticTab(cat){
  cosmeticTab = cat;
  document.querySelectorAll('#cosmetic-tabs .cosmetic-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
  renderCosmeticSubmitRow();
  loadCosmeticSubmissions();
}

function renderCosmeticSubmitRow(){
  const row = document.getElementById('cosmetic-submit-row');
  if(!row) return;
  if(cosmeticTab === 'theme'){
    row.innerHTML = `
      <input id="cosmetic-name-input" maxlength="30" placeholder="Theme name">
      <input id="cosmetic-cyan-input" type="color" value="#2de2c5" title="Cyan">
      <input id="cosmetic-pink-input" type="color" value="#ff3d8a" title="Pink">
      <input id="cosmetic-gold-input" type="color" value="#ffc857" title="Gold">
      <input id="cosmetic-bg-input" type="color" value="#0a0d13" title="Background">
      <button class="btn btn-secondary" onclick="submitCosmetic()">Submit</button>
    `;
  } else {
    row.innerHTML = `
      <input id="cosmetic-name-input" maxlength="30" placeholder="${cosmeticTab === 'avatar' ? 'Name your avatar' : 'Name your banner'}">
      <input id="cosmetic-preview-input" maxlength="${cosmeticTab === 'avatar' ? 4 : 200}" placeholder="${cosmeticTab === 'avatar' ? 'Paste one emoji 🐙' : 'CSS gradient or hex color'}">
      <button class="btn btn-secondary" onclick="submitCosmetic()">Submit</button>
    `;
  }
}

async function submitCosmetic(){
  if(!currentUser) return;
  const msgEl = document.getElementById('cosmetic-message');
  const name = document.getElementById('cosmetic-name-input').value.trim();
  let preview;
  if(cosmeticTab === 'theme'){
    preview = JSON.stringify({
      cyan: document.getElementById('cosmetic-cyan-input').value,
      pink: document.getElementById('cosmetic-pink-input').value,
      gold: document.getElementById('cosmetic-gold-input').value,
      bg: document.getElementById('cosmetic-bg-input').value
    });
  } else {
    preview = document.getElementById('cosmetic-preview-input').value.trim();
  }
  if(!name || !preview){ msgEl.textContent = 'Fill in a name and preview first.'; return; }
  try{
    const res = await apiFetch(`${LB_API_BASE}/cosmetics/submit`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, category: cosmeticTab, name, preview})
    });
    const data = await res.json();
    if(!res.ok){ msgEl.textContent = data.error || 'Submission failed.'; return; }
    msgEl.textContent = 'Submitted! Thanks for the entry.';
    await loadCosmeticSubmissions();
  }catch(e){
    console.error('Cosmetic submit failed:', e);
    msgEl.textContent = 'Submission failed — try again.';
  }
}

async function loadCosmeticSubmissions(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/cosmetics/submissions?category=${encodeURIComponent(cosmeticTab)}`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    cosmeticSubmissions = data.submissions || [];
    renderCosmeticGrid();
  }catch(e){
    console.error('Cosmetic submissions load failed:', e);
  }
}

function cosmeticPreviewStyle(sub){
  if(sub.category === 'theme'){
    try{
      const p = JSON.parse(sub.preview);
      return `background:${p.bg || '#111'}; color:${p.cyan || '#fff'}; border:1px solid ${p.gold || '#555'};`;
    }catch(e){ return ''; }
  }
  if(sub.category === 'banner'){
    return sub.preview.startsWith('#') ? `background:${sub.preview};` : `background:${sub.preview};`;
  }
  return '';
}

function renderCosmeticGrid(){
  const grid = document.getElementById('cosmetic-grid');
  if(!grid) return;
  if(!cosmeticSubmissions.length){
    grid.innerHTML = `<div class="community-sub">No submissions yet this month — be the first!</div>`;
    return;
  }
  grid.innerHTML = cosmeticSubmissions.map(sub => `
    <div class="cosmetic-card">
      <div class="cosmetic-preview" style="${cosmeticPreviewStyle(sub)}">${sub.category === 'avatar' ? sub.preview : (sub.category === 'theme' ? '🎨' : '🏳️')}</div>
      <div class="cosmetic-name">${sub.name}</div>
      <div class="cosmetic-creator">by ${sub.user_id}</div>
      <div class="cosmetic-votes">▲ ${sub.votes} vote${sub.votes === 1 ? '' : 's'}</div>
      <button class="btn btn-secondary" onclick="voteCosmetic(${sub.id})">Vote</button>
    </div>
  `).join('');
}

async function voteCosmetic(submissionId){
  if(!currentUser) return;
  const msgEl = document.getElementById('cosmetic-message');
  try{
    const res = await apiFetch(`${LB_API_BASE}/cosmetics/vote`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, submissionId})
    });
    const data = await res.json();
    if(!res.ok){ msgEl.textContent = data.error || 'Vote failed.'; return; }
    msgEl.textContent = 'Vote counted!';
    await loadCosmeticSubmissions();
  }catch(e){
    console.error('Cosmetic vote failed:', e);
    msgEl.textContent = 'Vote failed — try again.';
  }
}

async function loadCosmeticWinners(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/cosmetics/winners`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    cosmeticWinners = data.winners || [];
    renderCosmeticWinners();
  }catch(e){
    console.error('Cosmetic winners load failed:', e);
  }
}

function renderCosmeticWinners(){
  const listEl = document.getElementById('cosmetic-winners-list');
  if(!listEl) return;
  if(!cosmeticWinners.length){
    listEl.innerHTML = `<div class="community-sub">No winners yet — this month's votes are still open.</div>`;
    return;
  }
  listEl.innerHTML = cosmeticWinners.map(w => `
    <div class="cosmetic-winner-row">
      <span>${w.category === 'avatar' ? '🙂' : (w.category === 'theme' ? '🎨' : '🏳️')}</span>
      <span><b>${w.name}</b> (${w.category}) — by ${w.creator}, ${w.month_key}</span>
    </div>
  `).join('');
}

async function renderCommunityScreen(){
  if(!currentUser) return;
  document.getElementById('goal-bar-label').textContent = 'Loading…';
  await loadCommunityGoal();
  renderGoalBar();
  await loadPrestigeInfo();
  renderPrestige();
  renderCosmeticSubmitRow();
  await Promise.all([loadCosmeticSubmissions(), loadCosmeticWinners()]);
}
