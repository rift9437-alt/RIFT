/* =========================================================
   LOOT CRATES
   ========================================================= */
let crateInfo = null; // { cost, odds: [{id, chance}] }
const CRATE_RARITY_LABELS = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
const CRATE_RARITY_ICONS = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };

async function loadCrateInfo(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/lootcrate/info`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    crateInfo = await res.json();
  }catch(e){
    console.error('Crate info load failed:', e);
  }
}

async function renderLootCrateScreen(){
  if(!currentUser || !wallet) return;
  if(!crateInfo) await loadCrateInfo();
  document.getElementById('crate-token-balance').textContent = `🪙 ${wallet.tokens}`;
  document.getElementById('crate-result').innerHTML = '';
  document.getElementById('crate-result').className = 'crate-result';
  document.getElementById('crate-icon').textContent = '📦';
  document.getElementById('crate-icon').classList.remove('shaking');

  if(crateInfo){
    document.getElementById('crate-cost-label').textContent = crateInfo.cost;
    const oddsEl = document.getElementById('crate-odds');
    oddsEl.innerHTML = crateInfo.odds.map(o => `
      <span>${CRATE_RARITY_ICONS[o.id] || ''} ${CRATE_RARITY_LABELS[o.id] || o.id}: <b>${o.chance}%</b></span>
    `).join('');
    const canAfford = wallet.tokens >= crateInfo.cost;
    document.getElementById('crate-open-btn').disabled = !canAfford;
  }
}

async function openLootCrate(){
  if(!currentUser || !crateInfo) return;
  const btn = document.getElementById('crate-open-btn');
  const icon = document.getElementById('crate-icon');
  const resultEl = document.getElementById('crate-result');
  btn.disabled = true;
  icon.classList.add('shaking');
  resultEl.innerHTML = '';
  resultEl.className = 'crate-result';

  try{
    const res = await apiFetch(`${LB_API_BASE}/lootcrate/open`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({user: currentUser})
    });
    const data = await res.json();
    if(!res.ok){
      resultEl.textContent = data.error || 'Could not open crate.';
      icon.classList.remove('shaking');
      btn.disabled = false;
      return;
    }

    const prevAchievements = wallet ? (wallet.achievements || []) : [];
    const prevLevel = wallet ? (wallet.level || 1) : 1;
    wallet = data.wallet;
    updateTokenDisplay();

    // Small suspense beat before revealing the pull.
    setTimeout(() => {
      icon.classList.remove('shaking');
      const outcome = data.outcome;
      icon.textContent = CRATE_RARITY_ICONS[outcome.rarity] || '📦';
      resultEl.className = `crate-result rarity-${outcome.rarity}`;
      let rewardLine = '';
      if(outcome.rewardType === 'avatar') rewardLine = `New avatar unlocked: ${outcome.rewardValue}`;
      else if(outcome.rewardType === 'banner') rewardLine = `New banner unlocked: ${outcome.rewardValue}`;
      else if(outcome.rewardType === 'theme') rewardLine = `New theme unlocked: ${shopCatalog && shopCatalog[outcome.rewardValue] ? shopCatalog[outcome.rewardValue].name : outcome.rewardValue}`;
      else rewardLine = `🪙 ${outcome.rewardValue} tokens`;
      resultEl.innerHTML = `<div class="crate-rarity">${CRATE_RARITY_LABELS[outcome.rarity] || outcome.rarity}</div><div>${rewardLine}</div>`;

      document.getElementById('crate-token-balance').textContent = `🪙 ${wallet.tokens}`;
      document.getElementById('crate-open-btn').disabled = wallet.tokens < crateInfo.cost;

      if((wallet.achievements || []).length > prevAchievements.length){
        const newIds = wallet.achievements.filter(id => !prevAchievements.includes(id));
        showAchievementToast(newIds);
      }
      if((wallet.level || 1) > prevLevel){
        showLevelUpToast(wallet.level);
      }
    }, 700);
  }catch(e){
    console.error('Open crate failed:', e);
    resultEl.textContent = 'Something went wrong opening that crate.';
    icon.classList.remove('shaking');
    btn.disabled = false;
  }
}
