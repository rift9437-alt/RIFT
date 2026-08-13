/* =========================================================
   DAILY CHALLENGES
   ========================================================= */
let dailyInfo = null;

async function loadDailyChallenges(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/daily/challenges?user=${encodeURIComponent(currentUser)}`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    dailyInfo = await res.json();
    renderDailyPanel();
  }catch(e){
    console.error('Daily challenges load failed:', e);
  }
}

// One card shape for both dailies and weeklies — they differ in cadence and
// size, not in what a card has to say.
function challengeCard(c, kind){
  const complete = c.progress >= c.target;
  const pct = Math.min(100, (c.progress / c.target) * 100);
  const claimFn = kind === 'weekly' ? 'claimWeekly' : 'claimDaily';
  // The reroll only offers itself on a daily you haven't finished, and only
  // while you still have today's swap.
  const canReroll = kind === 'daily' && !complete && !c.claimed &&
                    dailyInfo && !dailyInfo.rerollUsed;
  return `
    <div class="daily-card ${complete ? 'complete' : ''} ${c.claimed ? 'claimed' : ''}">
      ${canReroll ? `<button class="daily-reroll" title="Swap this one — ${dailyInfo.rerollCost} tokens, once a day"
                       onclick="event.stopPropagation(); rerollDaily('${c.id}')">🎲</button>` : ''}
      <div class="daily-icon">${c.icon}</div>
      <div class="daily-label">${c.label}</div>
      <div class="daily-progress-track"><div class="daily-progress-fill" style="width:${pct}%"></div></div>
      <div class="daily-progress-label">${Math.min(c.progress, c.target)} / ${c.target}</div>
      <div class="daily-reward">🪙 ${c.tokens}</div>
      <button class="btn btn-secondary" ${(!complete || c.claimed) ? 'disabled' : ''} onclick="${claimFn}('${c.id}')">
        ${c.claimed ? '✓ Claimed' : (complete ? 'Claim' : 'In Progress')}
      </button>
    </div>`;
}

function renderDailyPanel(){
  const grid = document.getElementById('daily-grid');
  const streakLabel = document.getElementById('daily-streak-label');
  if(!grid || !dailyInfo || !dailyInfo.daily) return;

  // The swap being spent is why the dice have gone; say so rather than just
  // removing them.
  const streakBit = dailyInfo.streak > 0
    ? `🔥 ${dailyInfo.streak}-day streak (best ${dailyInfo.bestStreak})`
    : (dailyInfo.bestStreak > 0 ? `Best streak: ${dailyInfo.bestStreak}` : '');
  streakLabel.textContent = [streakBit, dailyInfo.rerollUsed ? "today's swap is spent" : '']
    .filter(Boolean).join(' · ');

  grid.innerHTML = dailyInfo.daily.challenges.map(c => challengeCard(c, 'daily')).join('');
  renderWeeklyPanel();
  renderSeasonPass();
}

/* ---- weekly quests ---------------------------------------------------- */
function renderWeeklyPanel(){
  const grid = document.getElementById('weekly-grid');
  const note = document.getElementById('weekly-note');
  if(!grid || !dailyInfo || !dailyInfo.weekly) return;
  const quests = dailyInfo.weekly.quests;
  grid.innerHTML = quests.map(q => challengeCard(q, 'weekly')).join('');
  const left = quests.filter(q => !q.claimed).length;
  note.textContent = dailyInfo.weekly.bonusClaimed
    ? `All three cleared — chest collected.`
    : (left === 0 ? 'Claim your last quest for the chest.'
                  : `Clear all three for a 🪙 ${dailyInfo.weeklyClearBonus} chest — ${left} to go.`);
}

async function claimWeekly(questId){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/weekly/claim`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, questId })
    });
    const data = await res.json();
    if(!res.ok){ toast('Not yet', data.error || 'Claim failed', '⏳', 'pink'); return; }
    wallet = data.wallet;
    updateTokenDisplay();
    if(data.bonus > 0) toast('Weekly cleared', `+${data.bonus} chest bonus`, '🧰', 'gold');
    else toast('Quest claimed', '', '✅', 'cyan');
    await loadDailyChallenges();
  }catch(e){ console.error('Weekly claim failed:', e); }
}

/* ---- reroll ----------------------------------------------------------- */
async function rerollDaily(challengeId){
  if(!currentUser || !dailyInfo) return;
  if((wallet.tokens || 0) < dailyInfo.rerollCost){
    toast('Not enough tokens', `A reroll costs ${dailyInfo.rerollCost}`, '🎲', 'pink');
    return;
  }
  try{
    const res = await apiFetch(`${LB_API_BASE}/daily/reroll`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, challengeId })
    });
    const data = await res.json();
    if(!res.ok){ toast('Can\u2019t reroll', data.error || 'Reroll failed', '🎲', 'pink'); return; }
    wallet = data.wallet;
    updateTokenDisplay();
    toast('Rerolled', data.swappedTo, '🎲', 'gold');
    Sfx.play('coin');
    await loadDailyChallenges();
  }catch(e){ console.error('Reroll failed:', e); }
}

/* ---- season pass ------------------------------------------------------ */
// A row of tiers you climb by playing anything; season XP mirrors the tokens
// you earn. Rewards sit there until you claim them, which is half the point.
function passRewardLabel(reward){
  if(reward.tokens && reward.title) return `🪙 ${reward.tokens} + title`;
  if(reward.tokens) return `🪙 ${reward.tokens}`;
  if(reward.title) return `“${reward.title}”`;
  if(reward.border) return 'Profile border';
  if(reward.theme) return 'Exclusive theme';
  if(reward.crate) return `📦 ×${reward.crate}`;
  return '—';
}

function renderSeasonPass(){
  const wrap = document.getElementById('pass-track');
  const head = document.getElementById('pass-head');
  if(!wrap || !dailyInfo || !dailyInfo.pass) return;
  const p = dailyInfo.pass;
  const pct = p.tier >= p.maxTier ? 100 : (p.intoTier / p.tierXp) * 100;
  head.innerHTML = p.tier >= p.maxTier
    ? `<b>Tier ${p.maxTier}</b> — track complete`
    : `<b>Tier ${p.tier}</b> · ${p.intoTier} / ${p.tierXp} to tier ${p.tier + 1}`;

  wrap.innerHTML = `
    <div class="pass-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="pass-tiers">
      ${p.tiers.map(t => {
        const reached = p.tier >= t.tier;
        const claimed = p.claimed.includes(t.tier);
        const state = claimed ? 'claimed' : reached ? 'ready' : 'locked';
        return `
          <button class="pass-tier ${state}" ${reached && !claimed ? '' : 'disabled'}
                  onclick="claimPassTier(${t.tier})">
            <span class="pass-tier-n">${t.tier}</span>
            <span class="pass-tier-reward">${passRewardLabel(t.reward)}</span>
            <span class="pass-tier-state">${claimed ? '✓' : reached ? 'CLAIM' : '🔒'}</span>
          </button>`;
      }).join('')}
    </div>`;
}

async function claimPassTier(tier){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/pass/claim`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, tier })
    });
    const data = await res.json();
    if(!res.ok){ toast('Not yet', data.error || 'Claim failed', '🔒', 'pink'); return; }
    wallet = data.wallet;
    updateTokenDisplay();
    dailyInfo.pass = data.pass;
    renderSeasonPass();
    const bits = [passRewardLabel(data.reward)];
    (data.crates || []).forEach(c => bits.push(c.label || 'crate reward'));
    toast(`Tier ${tier} claimed`, bits.join(' · '), '🎖', 'gold');
    Sfx.play('perfect');
  }catch(e){ console.error('Pass claim failed:', e); }
}

async function claimDaily(challengeId){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/daily/claim`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, challengeId})
    });
    const data = await res.json();
    if(!res.ok){ alert(data.error || 'Claim failed'); return; }
    wallet = data.wallet;
    updateTokenDisplay();
    if(data.allClaimed && data.streakBonus > 0){
      alert(`Perfect day! +${data.streakBonus} bonus tokens — ${data.streak}-day streak.`);
    }
    await loadDailyChallenges();
  }catch(e){
    console.error('Daily claim failed:', e);
    alert('Claim failed — try again.');
  }
}


/* =========================================================
   DAILY SPIN WHEEL
   ========================================================= */
let spinStatus = null;
let spinRotation = 0;
const SPIN_WHEEL_COLORS = ['#2de2c5', '#ff3d8a', '#ffc857', '#00c2d1', '#ff8c00', '#a78bfa'];

async function loadSpinStatus(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/spin/status?user=${encodeURIComponent(currentUser)}`);
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    spinStatus = await res.json();
  }catch(e){
    console.error('Spin status load failed:', e);
  }
}

function buildSpinWheel(){
  const wheelEl = document.getElementById('spin-wheel');
  if(!wheelEl || !spinStatus) return;
  const wedges = spinStatus.wedges;
  const slice = 360 / wedges.length;
  const gradientStops = wedges.map((w, i) => {
    const color = SPIN_WHEEL_COLORS[i % SPIN_WHEEL_COLORS.length];
    return `${color} ${i * slice}deg ${(i + 1) * slice}deg`;
  }).join(', ');
  wheelEl.style.background = `conic-gradient(${gradientStops})`;
  wheelEl.innerHTML = wedges.map((w, i) => `
    <div class="spin-wedge-label" style="transform:rotate(${i * slice + slice / 2}deg);">${w.icon} ${w.label}</div>
  `).join('');
}

function renderSpinScreen(){
  loadSpinStatus().then(() => {
    buildSpinWheel();
    const btn = document.getElementById('spin-btn');
    const msg = document.getElementById('spin-message');
    if(spinStatus && !spinStatus.canSpin){
      btn.disabled = true;
      btn.textContent = 'Come Back Tomorrow';
      msg.textContent = "You've already spun today.";
    } else if(btn){
      btn.disabled = false;
      btn.textContent = 'Spin';
      msg.textContent = '';
    }
  });
}

async function doSpin(){
  if(!currentUser || !spinStatus || !spinStatus.canSpin) return;
  const btn = document.getElementById('spin-btn');
  const msg = document.getElementById('spin-message');
  const wheelEl = document.getElementById('spin-wheel');
  btn.disabled = true;
  msg.textContent = 'Spinning…';
  try{
    const res = await apiFetch(`${LB_API_BASE}/spin/roll`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser})
    });
    const data = await res.json();
    if(!res.ok){ msg.textContent = data.error || 'Spin failed'; btn.disabled = false; return; }

    const wedgeCount = spinStatus.wedges.length;
    const slice = 360 / wedgeCount;
    const wedgeCenter = data.index * slice + slice / 2;
    const targetRotation = spinRotation - (spinRotation % 360) + 1800 + (360 - wedgeCenter);
    spinRotation = targetRotation;
    wheelEl.style.transform = `rotate(${targetRotation}deg)`;

    setTimeout(() => {
      msg.textContent = `${data.wedge.icon} ${data.wedge.label}!`;
      wallet = data.wallet;
      updateTokenDisplay();
      spinStatus.canSpin = false;
      btn.textContent = 'Come Back Tomorrow';
      loadDailyChallenges();
    }, 4100);
  }catch(e){
    console.error('Spin failed:', e);
    msg.textContent = 'Spin failed — try again.';
    btn.disabled = false;
  }
}
