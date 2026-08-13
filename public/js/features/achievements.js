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
  // Unlocked first, then whatever you're closest to finishing — a wall of
  // untouched achievements buries the one you're two races away from.
  const ids = Object.keys(achievementsCatalog).sort((a, b) => {
    const ua = unlocked.includes(a), ub = unlocked.includes(b);
    if(ua !== ub) return ua ? -1 : 1;
    const frac = id => {
      const p = achievementsCatalog[id].progress;
      return p && p.need ? p.have / p.need : -1;
    };
    return frac(b) - frac(a);
  });
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
    // How far along, when the server has a number for it. A padlock tells you
    // nothing; "312 / 5,000 bricks" tells you whether it's worth chasing.
    let bar = '';
    if(!isUnlocked && a.progress && a.progress.need > 1){
      const pct = Math.min(100, (a.progress.have / a.progress.need) * 100);
      bar = `
        <div class="ach-progress">
          <div class="ach-progress-track"><i style="width:${pct.toFixed(1)}%"></i></div>
          <div class="ach-progress-label">${fmtNum(a.progress.have)} / ${fmtNum(a.progress.need)}</div>
        </div>`;
    }
    return `
      <div class="achievement-card ${isUnlocked ? 'unlocked' : ''} ${isMaskedSecret ? 'secret-locked' : ''}">
        <div class="achievement-icon">${a.icon || '🏆'}</div>
        <div class="achievement-name">${a.name}</div>
        <div class="achievement-desc">${a.desc || ''}</div>
        ${(!isMaskedSecret && rewardBits.length) ? `<div class="achievement-reward">${rewardBits.join(' · ')}</div>` : ''}
        ${bar}
        <div class="achievement-status">${isUnlocked ? '✓ Unlocked' : (isMaskedSecret ? 'Secret' : 'Locked')}</div>
      </div>
    `;
  }).join('');
}

// Thousands separators, because "20000" and "2000" look the same at a glance.
function fmtNum(n){
  return (n || 0).toLocaleString('en-GB');
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
