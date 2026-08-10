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

function renderDailyPanel(){
  const grid = document.getElementById('daily-grid');
  const streakLabel = document.getElementById('daily-streak-label');
  if(!grid || !dailyInfo || !dailyInfo.daily) return;

  streakLabel.textContent = dailyInfo.streak > 0
    ? `🔥 ${dailyInfo.streak}-day streak (best ${dailyInfo.bestStreak})`
    : (dailyInfo.bestStreak > 0 ? `Best streak: ${dailyInfo.bestStreak}` : '');

  grid.innerHTML = dailyInfo.daily.challenges.map(c => {
    const complete = c.progress >= c.target;
    const pct = Math.min(100, (c.progress / c.target) * 100);
    return `
      <div class="daily-card ${complete ? 'complete' : ''} ${c.claimed ? 'claimed' : ''}">
        <div class="daily-icon">${c.icon}</div>
        <div class="daily-label">${c.label}</div>
        <div class="daily-progress-track"><div class="daily-progress-fill" style="width:${pct}%"></div></div>
        <div class="daily-progress-label">${Math.min(c.progress, c.target)} / ${c.target}</div>
        <div class="daily-reward">🪙 ${c.tokens}</div>
        <button class="btn btn-secondary" ${(!complete || c.claimed) ? 'disabled' : ''} onclick="claimDaily('${c.id}')">
          ${c.claimed ? '✓ Claimed' : (complete ? 'Claim' : 'In Progress')}
        </button>
      </div>
    `;
  }).join('');
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
