/* =========================================================
   COLLECTION + INVENTORY + KEYS
   =========================================================
   All three are views over things the wallet already tracks, so none of this
   needs a schema change: themes/avatars/banners/titles come straight off the
   wallet, and keys are derived from milestones the player has already hit. */

/* ---------------- keys ---------------- */
// Each key is earned by a condition that can be checked against existing data,
// so nothing has to be granted or stored separately.
const KEYS = [
  { id:'arcade', name:'Arcade Key',  icon:'🔑', color:'#ffc857',
    how:'Play 5 different cabinets',
    has:()=> Object.keys((wallet && wallet.gamePlays) || {}).length >= 5 },
  { id:'void',   name:'Void Key',    icon:'🗝', color:'#c9a6ff',
    how:'Find a hidden secret anywhere on the site',
    has:()=> typeof Prefs !== 'undefined' && Prefs.secretCount() > 0 },
  { id:'golden', name:'Golden Key',  icon:'🔐', color:'#ffb020',
    how:'Hold 5,000 tokens at once',
    has:()=> (wallet && wallet.tokens || 0) >= 5000 },
  { id:'master', name:'Master Key',  icon:'🎫', color:'#45ffb0',
    how:'Own every other key',
    has:()=> KEYS.slice(0, 3).every(k => k.has()) }
];

function hasKey(id){
  const k = KEYS.find(x => x.id === id);
  return !!(k && k.has());
}

// Locked areas gate on either a level or a key.
const LOCKED_AREAS = [
  { id:'vip', name:'VIP Lounge', icon:'🛋',
    need:'Reach level 25',
    open:()=> (wallet && wallet.level || 1) >= 25,
    blurb:'A quieter room above the arcade floor. Members only.' },
  { id:'lab', name:'Secret Lab', icon:'🧪',
    need:'Discover the Void Key',
    open:()=> hasKey('void'),
    blurb:'Whatever they were building down here, they left in a hurry.' },
  { id:'vault', name:'The Vault', icon:'🏦',
    need:'Hold the Master Key',
    open:()=> hasKey('master'),
    blurb:'Nobody has opened this since the arcade changed hands.' }
];

/* ---------------- collection book ---------------- */
function collectionGroups(){
  const w = wallet || {};
  const catalogThemes = shopCatalog ? Object.keys(shopCatalog).filter(id => shopCatalog[id].type !== 'upgrade') : [];
  const ownedThemes = (w.owned || []).filter(id => catalogThemes.includes(id));

  const avatarPool = (w.unlockedAvatars || []);
  const bannerPool = (w.unlockedBanners || []);
  const titlePool  = (w.titles || []);
  const badgePool  = (w.seasonBadges || []);
  const achieved   = (w.achievements || []);
  const achTotal   = (typeof ACHIEVEMENT_LIST !== 'undefined' && ACHIEVEMENT_LIST.length) || achieved.length || 1;

  return [
    { icon:'🎨', name:'Themes',   have: ownedThemes.length, total: Math.max(catalogThemes.length, ownedThemes.length, 1) },
    { icon:'👤', name:'Avatars',  have: avatarPool.length,  total: Math.max(avatarPool.length, 12) },
    { icon:'🖼', name:'Banners',  have: bannerPool.length,  total: Math.max(bannerPool.length, 8) },
    { icon:'🏷️', name:'Titles',   have: titlePool.length,   total: Math.max(titlePool.length, 10) },
    { icon:'🏆', name:'Badges',   have: badgePool.length,   total: Math.max(badgePool.length, 6) },
    { icon:'🎖️', name:'Achievements', have: achieved.length, total: achTotal },
    { icon:'🔑', name:'Keys',     have: KEYS.filter(k => k.has()).length, total: KEYS.length }
  ];
}

function bar(pct){
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

async function openCollection(){
  stopAllGames();
  showScreen('collection-screen');
  if(!shopCatalog) await loadShopItems();
  await loadWallet();

  const groups = collectionGroups();
  const overall = Math.round(
    groups.reduce((n, g) => n + Math.min(1, g.have / Math.max(1, g.total)), 0) / groups.length * 100);

  document.getElementById('collection-overall').textContent = overall + '% complete';
  document.getElementById('collection-body').innerHTML = groups.map(g=>{
    const pct = Math.round(Math.min(1, g.have / Math.max(1, g.total)) * 100);
    return `
      <div class="coll-row">
        <span class="coll-icon">${g.icon}</span>
        <span class="coll-name">${g.name}</span>
        <span class="coll-bar">${bar(pct)}</span>
        <span class="coll-pct">${pct}%</span>
        <span class="coll-count">${g.have}/${g.total}</span>
      </div>`;
  }).join('');
}

/* ---------------- inventory ---------------- */
function inventoryCategories(){
  const w = wallet || {};
  const themeName = id => (shopCatalog && shopCatalog[id] && shopCatalog[id].name) || id;
  return [
    { icon:'🎨', name:'Cosmetics', items:(w.owned || []).map(id => ({ label: themeName(id), sub: w.equipped === id ? 'Equipped' : '' })) },
    { icon:'🏷️', name:'Titles',    items:(w.titles || []).map(t => ({ label: t })) },
    { icon:'🖼', name:'Banners',   items:(w.unlockedBanners || []).map(b => ({ label: b, sub: w.banner === b ? 'Equipped' : '' })) },
    { icon:'👤', name:'Avatars',   items:(w.unlockedAvatars || []).map(a => ({ label: a })) },
    { icon:'🏆', name:'Badges',    items:(w.seasonBadges || []).map(b => ({ label: b })) },
    { icon:'🔑', name:'Keys',      items: KEYS.filter(k => k.has()).map(k => ({ label: k.icon + ' ' + k.name, sub:'Unlocked' })) },
    { icon:'🎁', name:'Pending Gifts', items:(w.pendingGifts || []).map(g => ({ label: g.itemName || 'Gift', sub:'from ' + (g.from || '?') })) }
  ];
}

async function openInventory(){
  stopAllGames();
  showScreen('inventory-screen');
  if(!shopCatalog) await loadShopItems();
  await loadWallet();

  const cats = inventoryCategories();
  document.getElementById('inventory-body').innerHTML = cats.map(c=>`
    <div class="lb-card">
      <h3>${c.icon} ${c.name} <span style="margin-left:auto; font-family:var(--font-mono); font-size:11px; color:var(--text-dim);">${c.items.length}</span></h3>
      ${c.items.length
        ? c.items.map(i => `<div class="inv-item"><span>${escapeHtml(String(i.label))}</span>${i.sub ? `<b>${escapeHtml(i.sub)}</b>` : ''}</div>`).join('')
        : '<div class="chat-note">Nothing here yet.</div>'}
    </div>`).join('');

  // keys + locked areas
  document.getElementById('keys-body').innerHTML = KEYS.map(k=>{
    const have = k.has();
    return `
      <div class="key-card ${have ? 'has' : ''}">
        <span class="key-icon" style="color:${k.color}">${have ? k.icon : '🔒'}</span>
        <div>
          <div class="key-name">${k.name}</div>
          <div class="key-how">${have ? 'Unlocked' : k.how}</div>
        </div>
      </div>`;
  }).join('') + LOCKED_AREAS.map(a=>{
    const open = a.open();
    return `
      <div class="key-card ${open ? 'has' : ''}">
        <span class="key-icon">${open ? a.icon : '🔒'}</span>
        <div>
          <div class="key-name">${a.name}</div>
          <div class="key-how">${open ? a.blurb : a.need}</div>
        </div>
      </div>`;
  }).join('');
}
