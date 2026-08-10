/* =========================================================
   SHOP EXTRAS — search, filters, sort, wishlist, confirmation
   =========================================================
   This layers on top of the existing renderShop() rather than replacing it:
   the cards are already in the DOM, so filtering and sorting is done over
   those nodes. That keeps theme/merge/companion logic untouched. */

const WISHLIST_KEY = 'level7_wishlist';

const Wishlist = (function(){
  let ids = [];
  try{ ids = JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]'); }catch(e){}
  function save(){ try{ localStorage.setItem(WISHLIST_KEY, JSON.stringify(ids)); }catch(e){} }
  return {
    has(id){ return ids.includes(id); },
    toggle(id){
      const i = ids.indexOf(id);
      if(i >= 0) ids.splice(i, 1); else ids.push(id);
      save();
      return ids.includes(id);
    },
    all(){ return ids.slice(); },
    count(){ return ids.length; }
  };
})();

// Rarity is derived from price — the catalogue has no rarity field, and
// deriving it keeps the two from ever disagreeing.
function rarityOf(cost){
  if(cost >= 3000) return { key:'legendary', label:'Legendary', color:'#ffb020' };
  if(cost >= 1000) return { key:'epic',      label:'Epic',      color:'#c9a6ff' };
  if(cost >= 400)  return { key:'rare',      label:'Rare',      color:'#4cb8ff' };
  if(cost > 0)     return { key:'common',    label:'Common',    color:'#7c8699' };
  return { key:'starter', label:'Starter', color:'#45ffb0' };
}

let shopFilter = { q:'', rarity:'all', show:'all', sort:'default' };

function setShopFilter(patch){
  Object.assign(shopFilter, patch);
  document.querySelectorAll('#shop-toolbar .filter-chip[data-rarity]').forEach(c=>{
    c.classList.toggle('active', c.dataset.rarity === shopFilter.rarity);
  });
  document.querySelectorAll('#shop-toolbar .filter-chip[data-show]').forEach(c=>{
    c.classList.toggle('active', c.dataset.show === shopFilter.show);
  });
  applyShopFilter();
}

// Reads each card's own data attributes (stamped in decorateShopCards) and
// hides / reorders in place.
function applyShopFilter(){
  const grid = document.getElementById('shop-grid');
  if(!grid) return;
  const cards = Array.from(grid.querySelectorAll('.shop-card'));
  let shown = 0;

  cards.forEach(card=>{
    const name = (card.dataset.name || '').toLowerCase();
    const cost = parseInt(card.dataset.cost || '0', 10);
    const rar = card.dataset.rarity || 'common';
    const owned = card.dataset.owned === '1';
    const equipped = card.dataset.equipped === '1';
    const wished = Wishlist.has(card.dataset.itemId);

    let ok = true;
    if(shopFilter.q && !name.includes(shopFilter.q)) ok = false;
    if(shopFilter.rarity !== 'all' && rar !== shopFilter.rarity) ok = false;
    if(shopFilter.show === 'owned' && !owned) ok = false;
    if(shopFilter.show === 'unowned' && owned) ok = false;
    if(shopFilter.show === 'wishlist' && !wished) ok = false;
    if(shopFilter.show === 'affordable' && (owned || cost > (wallet.tokens || 0))) ok = false;

    card.style.display = ok ? '' : 'none';
    if(ok) shown++;
    card.classList.toggle('shop-card-equipped', equipped);
  });

  const sorted = cards.slice().sort((a, b)=>{
    const ca = parseInt(a.dataset.cost || '0', 10), cb = parseInt(b.dataset.cost || '0', 10);
    switch(shopFilter.sort){
      case 'cheap':   return ca - cb;
      case 'expensive': return cb - ca;
      case 'rarity':  return cb - ca;   // price is the rarity proxy
      case 'name':    return (a.dataset.name || '').localeCompare(b.dataset.name || '');
      default:        return parseInt(a.dataset.order, 10) - parseInt(b.dataset.order, 10);
    }
  });
  sorted.forEach(c => grid.appendChild(c));

  const empty = document.getElementById('shop-empty');
  if(empty) empty.classList.toggle('hidden', shown > 0);
  const count = document.getElementById('shop-count');
  if(count) count.textContent = `${shown} item${shown === 1 ? '' : 's'}`;
}

// Stamps every card with the data the filter needs, plus a rarity badge,
// owned/equipped markers and a wishlist heart.
function decorateShopCards(){
  const grid = document.getElementById('shop-grid');
  if(!grid || !shopCatalog) return;
  const entries = Object.entries(shopCatalog);

  Array.from(grid.querySelectorAll('.shop-card')).forEach((card, i)=>{
    const nameEl = card.querySelector('.shop-card-name');
    const name = nameEl ? nameEl.textContent.trim() : '';
    const match = entries.find(([, it]) => it.name === name);
    if(!match) return;
    const [id, item] = match;
    const rar = rarityOf(item.cost || 0);

    card.dataset.itemId = id;
    card.dataset.name = name;
    card.dataset.cost = item.cost || 0;
    card.dataset.rarity = rar.key;
    card.dataset.owned = wallet.owned.includes(id) ? '1' : '0';
    card.dataset.equipped = wallet.equipped === id ? '1' : '0';
    if(card.dataset.order === undefined) card.dataset.order = i;

    if(!card.querySelector('.rarity-tag')){
      const tag = document.createElement('span');
      tag.className = 'rarity-tag';
      tag.textContent = rar.label;
      tag.style.color = rar.color;
      tag.style.borderColor = rar.color + '66';
      card.insertBefore(tag, card.firstChild);
    }
    if(wallet.owned.includes(id) && !card.querySelector('.owned-tick')){
      const tick = document.createElement('span');
      tick.className = 'owned-tick';
      tick.textContent = wallet.equipped === id ? '★ EQUIPPED' : '✓ OWNED';
      card.appendChild(tick);
    }
    if(!card.querySelector('.wish-btn')){
      const wish = document.createElement('button');
      wish.className = 'wish-btn' + (Wishlist.has(id) ? ' on' : '');
      wish.textContent = Wishlist.has(id) ? '♥' : '♡';
      wish.title = 'Wishlist';
      wish.onclick = (ev)=>{
        ev.stopPropagation();
        const on = Wishlist.toggle(id);
        wish.classList.toggle('on', on);
        wish.textContent = on ? '♥' : '♡';
        Sfx.play(on ? 'coin' : 'click');
        applyShopFilter();
      };
      card.appendChild(wish);
    }
  });
  applyShopFilter();
}

// Purchase confirmation, so a mis-click can't spend 3000 tokens.
let pendingPurchase = null;

function confirmPurchase(itemId, name, cost, onYes){
  pendingPurchase = onYes;
  let modal = document.getElementById('buy-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'buy-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-card" style="text-align:center;">
        <h3>CONFIRM PURCHASE</h3>
        <div id="buy-body" class="controls-box" style="margin-top:12px;"></div>
        <div style="display:flex; gap:10px; margin-top:6px;">
          <button class="btn btn-secondary" style="flex:1;" onclick="closeBuyModal()">Cancel</button>
          <button class="btn btn-primary" style="flex:1; margin-top:0;" onclick="acceptPurchase()">Buy it</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  const after = (wallet.tokens || 0) - cost;
  document.getElementById('buy-body').innerHTML =
    `Buy <b>${escapeHtml(name)}</b> for <b>🪙 ${cost}</b>?<br>` +
    `You'll have <b>🪙 ${after}</b> left.`;
  modal.classList.remove('hidden');
}

function closeBuyModal(){
  const m = document.getElementById('buy-modal');
  if(m) m.classList.add('hidden');
  pendingPurchase = null;
}

function acceptPurchase(){
  const go = pendingPurchase;
  closeBuyModal();
  if(go) go();
}

// Wraps the existing handlePurchase so every buy route gets the prompt.
function installPurchaseGuard(){
  if(typeof handlePurchase !== 'function' || handlePurchase.__guarded) return;
  const original = handlePurchase;
  window.handlePurchase = function(itemId){
    const item = shopCatalog && shopCatalog[itemId];
    if(!item) return original(itemId);
    confirmPurchase(itemId, item.name, item.cost || 0, ()=> original(itemId));
  };
  window.handlePurchase.__guarded = true;
}

function initShopPlus(){
  installPurchaseGuard();
  // renderShop is async and rebuilds the grid, so re-decorate after it runs.
  if(typeof renderShop === 'function' && !renderShop.__wrapped){
    const original = renderShop;
    window.renderShop = async function(){
      const out = await original.apply(this, arguments);
      decorateShopCards();
      await loadShopRotation();
      renderShopRotation();
      return out;
    };
    window.renderShop.__wrapped = true;
  }
}

/* =========================================================
   ROTATING SHOP
   =========================================================
   Daily / weekly / back-room slots. The server derives these from the date,
   so everyone sees the same offers and a reload doesn't reroll them. The
   discounted price shown here is the one the server charges — this code
   never sends an amount. */
let shopRotation = null;

async function loadShopRotation(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/shop/rotation`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    shopRotation = await res.json();
  }catch(e){
    console.error('Shop rotation load failed:', e);
    shopRotation = null;
  }
  return shopRotation;
}

function countdownText(ms){
  const left = Math.max(0, ms - Date.now());
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  if(h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderShopRotation(){
  const box = document.getElementById('shop-rotation');
  if(!box) return;
  if(!shopRotation){ box.innerHTML = ''; return; }

  const section = (kind, icon, resetMs) => {
    const offers = shopRotation[kind] || [];
    if(!offers.length) return '';
    const label = (shopRotation.labels && shopRotation.labels[kind]) || kind;
    const timer = resetMs ? `<span class="rot-timer">resets in ${countdownText(resetMs)}</span>` : '';
    return `
      <div class="rot-section rot-${kind}">
        <div class="rot-head"><span>${icon} ${label}</span>${timer}</div>
        <div class="rot-row">
          ${offers.map(o => {
            const owned = wallet.owned && wallet.owned.includes(o.id);
            return `
              <div class="rot-card ${owned ? 'rot-owned' : ''}">
                <div class="rot-name">${o.name}</div>
                <div class="rot-price">
                  <s>${o.base}</s>
                  <b>🪙 ${o.cost}</b>
                  <span class="rot-off">-${o.discount}%</span>
                </div>
                ${owned
                  ? '<span class="rot-owned-tag">✓ Owned</span>'
                  : `<button class="btn btn-primary btn-small" onclick="handlePurchase('${o.id}')">Buy</button>`}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  };

  const resets = shopRotation.resetsAt || {};
  box.innerHTML =
    section('secret', '🚪', null) +
    section('daily', '⏱', resets.daily) +
    section('weekly', '⭐', resets.weekly);
}
