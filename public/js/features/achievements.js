/* =========================================================
   ACHIEVEMENTS & SEASONS
   ========================================================= */
let achievementsCatalog = null;
let seasonInfo = null;

async function loadAchievementsCatalog(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/achievements?user=${encodeURIComponent(currentUser)}`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    achievementsCatalog = await res.json();
  }catch(e){
    console.error('Achievements catalog load failed:', e);
    achievementsCatalog = achievementsCatalog || {};
  }
}

async function loadSeasonInfo(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/season`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    seasonInfo = await res.json();
    applySeasonSkin();
  }catch(e){
    console.error('Season info load failed:', e);
  }
}

function renderSeasonBanner(targetId){
  const el = document.getElementById(targetId);
  if(!el || !seasonInfo) return;
  el.innerHTML = `
    <div class="season-badge-icon">${seasonInfo.badge || '🏆'}</div>
    <div>
      <div class="season-name">CURRENT SEASON: ${seasonInfo.name || ''}${seasonInfo.theme ? ' — ' + seasonInfo.theme + ' Theme' : ''}</div>
      <div class="season-blurb">${seasonInfo.blurb || ''}</div>
    </div>
  `;
}

async function renderAchievements(){
  if(!currentUser || !wallet) return;
  // Always refetch — secret achievements only reveal their real name/desc
  // once the server sees they're unlocked, so a stale cache would hide that.
  await loadAchievementsCatalog();
  if(!seasonInfo) await loadSeasonInfo();
  renderSeasonBanner('season-banner');

  const grid = document.getElementById('achievements-grid');
  const progressEl = document.getElementById('achievements-progress');
  if(!grid || !achievementsCatalog) return;

  const unlocked = wallet.achievements || [];
  const ids = Object.keys(achievementsCatalog);
  progressEl.textContent = `${unlocked.length} / ${ids.length}`;

  grid.innerHTML = ids.map(id => {
    const a = achievementsCatalog[id];
    const isUnlocked = unlocked.includes(id);
    const isMaskedSecret = a.secret && !isUnlocked;
    const rewardBits = [];
    if(a.reward){
      if(a.reward.tokens) rewardBits.push(`🪙 ${a.reward.tokens} tokens`);
      if(a.reward.title) rewardBits.push(`Title: ${a.reward.title}`);
      if(a.reward.border) rewardBits.push(`Profile border`);
      if(a.reward.theme) rewardBits.push(`Exclusive theme`);
    }
    return `
      <div class="achievement-card ${isUnlocked ? 'unlocked' : ''} ${isMaskedSecret ? 'secret-locked' : ''}">
        <div class="achievement-icon">${a.icon || '🏆'}</div>
        <div class="achievement-name">${a.name}</div>
        <div class="achievement-desc">${a.desc || ''}</div>
        ${(!isMaskedSecret && rewardBits.length) ? `<div class="achievement-reward">${rewardBits.join(' · ')}</div>` : ''}
        <div class="achievement-status">${isUnlocked ? '✓ Unlocked' : (isMaskedSecret ? 'Secret' : 'Locked')}</div>
      </div>
    `;
  }).join('');
}

/* =========================================================
   SEASONAL SKIN
   =========================================================
   Adds a class to <body> for the running season so CSS can dress the whole
   site without any screen needing to know about it. Season 2 puts cobwebs in
   the corners, tints the cabinet grid, and marks the spooky cabinets. When
   CURRENT_SEASON moves on, the class stops being applied and everything
   returns to normal on its own. */
function applySeasonSkin(){
  const body = document.body;
  body.classList.remove('season-1', 'season-2');
  if(seasonInfo && seasonInfo.current) body.classList.add('season-' + seasonInfo.current);
}

// Cabinets that get a spooky treatment for Season 2 — the ones whose theme
// already sits close enough to horror that a coat of paint is enough.
const SPOOKY_CABINETS = ['roguelike', 'depths', 'zombie', 'samurai', 'flood', 'evolution', 'tunnel'];
function isSpookyCabinet(id){
  return seasonInfo && seasonInfo.current === 2 && SPOOKY_CABINETS.includes(id);
}
