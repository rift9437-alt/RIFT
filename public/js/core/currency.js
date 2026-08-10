/* =========================================================
   CURRENCY + SHOP
   Tokens are earned by playing and spent on cosmetic site-wide
   color themes. The server is the source of truth for both how
   much something costs and how many tokens an action pays out —
   the client only ever says *what happened*, never *how much*.
   ========================================================= */
let wallet = { tokens: 0, owned: ['neon'], equipped: 'neon', companion: null };
let shopCatalog = null;

function updateTokenDisplay(){
  const el = document.getElementById('token-balance');
  if(el) el.textContent = '🪙 ' + (wallet.tokens||0);
}

function applyTheme(itemId){
  const item = shopCatalog && shopCatalog[itemId];
  if(!item) return;
  document.documentElement.style.setProperty('--cyan', item.cyan);
  document.documentElement.style.setProperty('--pink', item.pink);
  document.documentElement.style.setProperty('--gold', item.gold);
  if(item.bg) document.documentElement.style.setProperty('--bg', item.bg);
  if(item.bgPanel) document.documentElement.style.setProperty('--bg-panel', item.bgPanel);
  if(item.bgPanelRaised) document.documentElement.style.setProperty('--bg-panel-raised', item.bgPanelRaised);
  if(item.border) document.documentElement.style.setProperty('--border', item.border);
  if(item.bgGradient) document.documentElement.style.setProperty('--bg-gradient', item.bgGradient);
  else document.documentElement.style.removeProperty('--bg-gradient');
  if(item.buttonGradient) document.documentElement.style.setProperty('--btn-gradient', item.buttonGradient);
  else document.documentElement.style.removeProperty('--btn-gradient');
  if(item.cabinetBg) document.documentElement.style.setProperty('--cabinet-bg', item.cabinetBg);
  else document.documentElement.style.removeProperty('--cabinet-bg');
  if(item.cabinetText) document.documentElement.style.setProperty('--cabinet-text', item.cabinetText);
  else document.documentElement.style.removeProperty('--cabinet-text');
  if(item.cabinetTextDim) document.documentElement.style.setProperty('--cabinet-text-dim', item.cabinetTextDim);
  else document.documentElement.style.removeProperty('--cabinet-text-dim');
  if(item.text) document.documentElement.style.setProperty('--text', item.text);
  else document.documentElement.style.removeProperty('--text');
  if(item.textDim) document.documentElement.style.setProperty('--text-dim', item.textDim);
  else document.documentElement.style.removeProperty('--text-dim');
  if(item.image){
    document.documentElement.style.setProperty('--theme-image', `url("${item.image}")`);
    document.documentElement.classList.add('theme-image-active');
  } else {
    document.documentElement.classList.remove('theme-image-active');
    document.documentElement.style.removeProperty('--theme-image');
  }
}

function resetTheme(){
  document.documentElement.style.removeProperty('--cyan');
  document.documentElement.style.removeProperty('--pink');
  document.documentElement.style.removeProperty('--gold');
  document.documentElement.style.removeProperty('--bg');
  document.documentElement.style.removeProperty('--bg-panel');
  document.documentElement.style.removeProperty('--bg-panel-raised');
  document.documentElement.style.removeProperty('--border');
  document.documentElement.style.removeProperty('--bg-gradient');
  document.documentElement.style.removeProperty('--btn-gradient');
  document.documentElement.style.removeProperty('--cabinet-bg');
  document.documentElement.style.removeProperty('--cabinet-text');
  document.documentElement.style.removeProperty('--cabinet-text-dim');
  document.documentElement.style.removeProperty('--text');
  document.documentElement.style.removeProperty('--text-dim');
  document.documentElement.style.removeProperty('--theme-image');
  document.documentElement.classList.remove('theme-image-active');
}

async function loadShopItems(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/shop/items`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    shopCatalog = await res.json();
  }catch(e){
    console.error('Shop catalog load failed:', e);
    shopCatalog = shopCatalog || {};
  }
}

async function loadWallet(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/wallet?user=${encodeURIComponent(currentUser)}`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    wallet = await res.json();
    applyTheme(wallet.equipped);
    updateTokenDisplay();
  }catch(e){
    console.error('Wallet load failed:', e);
  }
}
