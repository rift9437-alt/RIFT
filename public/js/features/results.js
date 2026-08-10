/* =========================================================
   RESULT SCREENS — score breakdown, ranks, and next-achievement nudge
   =========================================================
   Rather than editing 23 game modules, this watches for a result overlay
   becoming visible and fills in a breakdown from data we already hold:
   a snapshot taken when the run started, plus the freshly-updated lbCache. */

// stat snapshot taken the moment a cabinet is launched, so "improvement"
// can be measured against where you actually started.
let runSnapshot = null;

function snapshotRun(cabId){
  const cab = CABINETS.find(c => c.id === cabId);
  if(!cab || !cab.best || !currentUser || !lbCache) { runSnapshot = null; return; }
  const rec = lbCache[currentUser] && lbCache[currentUser][cab.best.game];
  runSnapshot = {
    cabId,
    game: cab.best.game,
    key: cab.best.key,
    label: cab.best.label,
    before: (rec && rec[cab.best.key]) || 0,
    startedAt: Date.now()
  };
}

// Where the player sits on this cabinet's board right now.
function globalRankFor(game, key){
  if(!lbCache || !currentUser) return null;
  const mine = (lbCache[currentUser][game] || {})[key] || 0;
  const better = USERS.filter(u => ((lbCache[u] && lbCache[u][game]) || {})[key] > mine).length;
  return { rank: better + 1, total: USERS.length, value: mine };
}

// The player immediately above you on this board, and by how much.
function nextTargetFor(game, key){
  if(!lbCache || !currentUser) return null;
  const mine = (lbCache[currentUser][game] || {})[key] || 0;
  const above = USERS
    .map(u => ({ user: u, v: ((lbCache[u] && lbCache[u][game]) || {})[key] || 0 }))
    .filter(x => x.user !== currentUser && x.v > mine)
    .sort((a, b) => a.v - b.v)[0];
  return above ? { user: above.user, need: above.v - mine + 1 } : null;
}

function fmt(n){
  return typeof n === 'number' ? n.toLocaleString() : n;
}

function buildBreakdown(){
  if(!runSnapshot) return '';
  const snap = runSnapshot;
  const rec = (lbCache[currentUser] || {})[snap.game] || {};
  const now = rec[snap.key] || 0;
  const improvement = now - snap.before;
  const rank = globalRankFor(snap.game, snap.key);
  const next = nextTargetFor(snap.game, snap.key);
  const seconds = Math.max(0, Math.round((Date.now() - snap.startedAt) / 1000));
  const mins = Math.floor(seconds / 60);
  const timeStr = mins ? `${mins}m ${seconds % 60}s` : `${seconds}s`;

  const rows = [];
  rows.push(`<div class="score-row"><span>PERSONAL BEST</span><b>${fmt(now)}</b></div>`);
  if(improvement > 0){
    rows.push(`<div class="score-row good"><span>IMPROVEMENT</span><b>+${fmt(improvement)}</b></div>`);
  } else {
    rows.push(`<div class="score-row"><span>PREVIOUS BEST</span><b>${fmt(snap.before)}</b></div>`);
  }
  rows.push(`<div class="score-row"><span>TIME PLAYED</span><b>${timeStr}</b></div>`);
  if(rank){
    rows.push(`<div class="score-row ${rank.rank === 1 ? 'good' : ''}"><span>GLOBAL RANK</span><b>#${rank.rank} of ${rank.total}</b></div>`);
  }

  let hint = '';
  if(next){
    hint = `Need <b>${fmt(next.need)}</b> more to pass ${escapeHtml(next.user)}.`;
  } else if(rank && rank.rank === 1 && rank.value > 0){
    hint = 'You hold the top spot on this cabinet.';
  }

  // Nearest unearned achievement, if the catalogue is loaded.
  let achLine = '';
  if(typeof ACHIEVEMENT_LIST !== 'undefined' && Array.isArray(ACHIEVEMENT_LIST)){
    const owned = (wallet && wallet.achievements) || [];
    const pending = ACHIEVEMENT_LIST.filter(a => !owned.includes(a.id)).length;
    if(pending) achLine = `<div class="score-hint">🏆 ${pending} achievement${pending === 1 ? '' : 's'} still to unlock</div>`;
  }

  return `
    <div class="score-table">${rows.join('')}</div>
    ${hint ? `<div class="score-hint">${hint}</div>` : ''}
    ${achLine}`;
}

// Watches every result overlay; when one is revealed, drop the breakdown in.
function watchResultOverlays(){
  document.querySelectorAll('.result-overlay').forEach(overlay=>{
    if(overlay.dataset.watched) return;
    overlay.dataset.watched = '1';
    const obs = new MutationObserver(()=>{
      if(overlay.classList.contains('hidden')) return;
      injectBreakdown(overlay);
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  });
}

function injectBreakdown(overlay){
  const old = overlay.querySelector('.score-table');
  if(old) old.remove();
  overlay.querySelectorAll('.score-hint').forEach(h => h.remove());
  const html = buildBreakdown();
  if(!html) return;
  const actions = overlay.querySelector('.result-actions');
  const holder = document.createElement('div');
  holder.innerHTML = html;
  // Sits between the summary line and the buttons.
  while(holder.firstChild){
    if(actions) overlay.insertBefore(holder.firstChild, actions);
    else overlay.appendChild(holder.firstChild);
  }
  if(typeof playVictoryFx === 'function'){
    const heading = (overlay.querySelector('h3') || {}).textContent || '';
    playVictoryFx(/win|record|reach|sunk|skyline|yours/i.test(heading));
  }
}

/* =========================================================
   GAME TIPS + HOW TO PLAY
   ========================================================= */
const GAME_TIPS = [
  'Hold your nerve — most cabinets reward patience over mashing.',
  'Perks bought in the shop apply to every cabinet, not just one.',
  'Beating the player above you on any board is worth a podium point.',
  'The prize wheel is spun on the server. Nobody can rig it.',
  'Daily challenges refresh at midnight UTC and everyone gets the same three.',
  'Losing still pays tokens — Insurance makes a loss pay almost like a win.',
  'Pin your favourites with the ★ and they float to the top of the dashboard.',
  'ESC pauses any cabinet. It works in all 23 now.',
  'Try the Konami code somewhere on the dashboard.',
  'Search understands genres — type "racing" or "strategy".'
];

function randomTip(){
  return GAME_TIPS[Math.floor(Math.random() * GAME_TIPS.length)];
}

// A "How to Play" button on every game screen that re-opens that cabinet's
// own controls box without leaving the run.
function wireHowToPlay(){
  document.querySelectorAll('.screen.game-screen').forEach(screen=>{
    if(screen.dataset.howto) return;
    screen.dataset.howto = '1';
    const bar = screen.querySelector('.game-topbar');
    const controls = screen.querySelector('.controls-box');
    if(!bar || !controls) return;
    const btn = document.createElement('button');
    btn.className = 'back-btn';
    btn.textContent = '? HOW TO PLAY';
    btn.title = 'Show the controls';
    btn.onclick = ()=> showHowTo(screen.id, controls.innerHTML);
    const pause = bar.querySelector('.pause-btn');
    if(pause) bar.insertBefore(btn, pause);
    else bar.appendChild(btn);
  });
}

function showHowTo(screenId, html){
  const mod = currentGameModule();
  const wasRunning = mod && mod.isRunning && mod.isRunning() && !mod.isPaused();
  if(wasRunning && mod.pause) mod.pause();

  let modal = document.getElementById('howto-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'howto-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-card modal-card-wide">
        <h3>? HOW TO PLAY</h3>
        <div class="controls-box" id="howto-body"></div>
        <div class="score-hint" id="howto-tip"></div>
        <button class="btn btn-primary" onclick="closeHowTo()">Back to the game</button>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('howto-body').innerHTML = html;
  document.getElementById('howto-tip').textContent = '💡 ' + randomTip();
  modal.classList.remove('hidden');
  modal.dataset.resume = wasRunning ? '1' : '';
}

function closeHowTo(){
  const modal = document.getElementById('howto-modal');
  if(!modal) return;
  modal.classList.add('hidden');
  if(modal.dataset.resume){
    const mod = currentGameModule();
    if(mod && mod.resume) mod.resume();
  }
}

/* =========================================================
   LOADING INDICATOR — a beat of "now loading" with a tip
   ========================================================= */
function showGameLoader(name, then){
  let el = document.getElementById('game-loader');
  if(!el){
    el = document.createElement('div');
    el.id = 'game-loader';
    el.className = 'modal-overlay hidden';
    el.innerHTML = `
      <div class="modal-card" style="text-align:center;">
        <h3 id="loader-name">LOADING</h3>
        <div class="loader-bar"><i></i></div>
        <div class="score-hint" id="loader-tip"></div>
      </div>`;
    document.body.appendChild(el);
  }
  document.getElementById('loader-name').textContent = name.toUpperCase();
  document.getElementById('loader-tip').textContent = '💡 ' + randomTip();
  el.classList.remove('hidden');
  setTimeout(()=>{
    el.classList.add('hidden');
    if(then) then();
  }, 620);
}

function initResults(){
  watchResultOverlays();
  wireHowToPlay();
}
