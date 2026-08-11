/* =========================================================
   QUALITY OF LIFE — search, favourites, recents, layouts, and the
   little conveniences that make the dashboard usable day to day.
   =========================================================
   Everything here is per-device and lives in localStorage, so none of it
   needs a server round-trip or a schema change. */
/* A general-purpose notification, so any feature can surface something small
   without inventing its own popup. Safe to call before the DOM settles. */
function toast(title, sub, icon, tone){
  const stack = document.getElementById('toast-stack');
  if(!stack) return;
  const el = document.createElement('div');
  el.className = 'l7-toast' + (tone ? ' l7-toast-' + tone : '');
  el.innerHTML =
    '<div class="l7-toast-icon">' + (icon || '\u2728') + '</div>' +
    '<div><div class="l7-toast-title">' + escapeHtml(title) + '</div>' +
    (sub ? '<div class="l7-toast-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>';
  stack.appendChild(el);
  while(stack.children.length > 4) stack.removeChild(stack.firstChild);
  setTimeout(()=>{
    el.classList.add('leaving');
    setTimeout(()=>el.remove(), 340);
  }, 4200);
}

const PREFS_KEY = 'level7_prefs';

const Prefs = (function(){
  let data = {
    favourites: [],      // cabinet ids pinned to the top
    recents: [],         // cabinet ids, most recent first
    layout: 'grid',      // grid | compact | large | list
    choices: {},         // remembered mode/difficulty per cabinet
    cursor: false,       // custom cursor on/off
    secrets: []          // easter eggs already found
  };

  try{
    const raw = localStorage.getItem(PREFS_KEY);
    if(raw) data = Object.assign(data, JSON.parse(raw));
  }catch(e){ /* private mode — defaults are fine */ }

  function save(){
    try{ localStorage.setItem(PREFS_KEY, JSON.stringify(data)); }catch(e){}
  }

  return {
    all(){ return data; },
    get(k){ return data[k]; },
    set(k, v){ data[k] = v; save(); },

    isFavourite(id){ return data.favourites.includes(id); },
    toggleFavourite(id){
      const i = data.favourites.indexOf(id);
      if(i >= 0) data.favourites.splice(i, 1);
      else data.favourites.push(id);
      save();
      return data.favourites.includes(id);
    },

    noteRecent(id){
      data.recents = [id, ...data.recents.filter(r => r !== id)].slice(0, 5);
      save();
    },

    // Remembers which mode/difficulty button you last picked per cabinet.
    setChoice(cab, kind, value){
      data.choices[cab + ':' + kind] = value;
      save();
    },
    getChoice(cab, kind){ return data.choices[cab + ':' + kind]; },

    markSecret(id){
      if(data.secrets.includes(id)) return false;
      data.secrets.push(id);
      save();
      return true;
    },
    foundSecret(id){ return data.secrets.includes(id); },
    secretCount(){ return data.secrets.length; }
  };
})();

// Genre keywords so searching "racing" finds Apex Loop and Police Chase even
// though neither blurb contains that word. Keyed by cabinet id.
const CABINET_KEYWORDS = {
  soccer:'sports football ball versus kick',
  racing:'racing race car driving speed lap motorsport',
  tank:'shooter combat war artillery versus',
  runner:'endless runner jumping platformer arcade',
  wildduel:'shooter western cowboy fighting versus duel',
  asteroid:'shooter space arcade aiming',
  breaker:'arcade puzzle bricks paddle classic',
  roguelike:'rpg dungeon adventure roguelike fantasy combat',
  comet:'space dodging survival arcade',
  tunnel:'racing flying 3d space speed endless',
  depths:'shooter fps 3d horror maze combat',
  stack:'puzzle 3d timing tower building',
  golf:'sports golf physics puzzle space',
  sumo:'fighting versus physics arena party',
  towerdefense:'strategy tower defense tactics base',
  parkour:'platformer running ninja jumping speedrun',
  zombie:'shooter survival horror zombies waves',
  pirate:'adventure sailing treasure exploration',
  samurai:'fighting versus sword duel combat',
  policechase:'racing driving car chase pursuit',
  tactics:'strategy turn-based tactics grid war',
  runeduel:'card strategy magic duel versus',
  warlord:'strategy war army command battle',
  evolution:'survival arcade growth eating creature nature',
  flood:'platformer survival water escape climbing',
  hoops:'sports basketball shooting arcade aiming',
  burger:'cooking arcade time management food',
  tag:'party versus chase running arena',
  robot:'fighting versus mech arena building shooter roguelike parts',
  whodidit:'mystery detective puzzle investigation clues suspects story'
};

let cabinetSearch = '';

function setCabinetSearch(q){
  cabinetSearch = (q || '').trim().toLowerCase();
  renderCabinets();
}

function setDashLayout(layout){
  Prefs.set('layout', layout);
  document.querySelectorAll('.layout-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.layout === layout);
  });
  renderCabinets();
  Sfx.play('click');
}

function toggleCabinetFavourite(id, ev){
  if(ev) ev.stopPropagation();      // don't launch the cabinet behind the star
  const now = Prefs.toggleFavourite(id);
  Sfx.play(now ? 'coin' : 'click');
  renderCabinets();
}

/* =========================================================
   REMEMBERED MODE / DIFFICULTY
   =========================================================
   Every cabinet names its option buttons "<game>-mode-x" / "<game>-diff-x",
   so one delegated listener can record the last pick for all of them, and
   re-applying is just clicking the stored button again. */
document.addEventListener('click', e=>{
  const btn = e.target.closest && e.target.closest('.option-btn');
  if(!btn || !btn.id) return;
  const m = btn.id.match(/^([a-z0-9]+)-(mode|diff)-([a-z0-9]+)$/i);
  if(m) Prefs.setChoice(m[1], m[2], m[3]);
});

function applyRememberedChoices(screenId){
  const cab = screenId.replace(/-screen$/, '');
  ['mode', 'diff'].forEach(kind=>{
    const value = Prefs.getChoice(cab, kind);
    if(!value) return;
    const btn = document.getElementById(`${cab}-${kind}-${value}`);
    // Clicking runs the game's own setMode/setDifficulty, so the module state
    // and the button highlight stay in agreement.
    if(btn && !btn.classList.contains('selected')) btn.click();
  });
}

/* =========================================================
   RIVAL — the player directly above you on total podium points
   ========================================================= */
function playerPoints(user, data){
  if(!data || !data[user]) return 0;
  let pts = 0;
  (typeof LB_BOARDS !== 'undefined' ? LB_BOARDS : []).forEach(board=>{
    const key = board.cols[0][0];
    const mine = (data[user][board.game] || {})[key] || 0;
    if(!mine) return;
    // Points = how many players you're ahead of on this board.
    USERS.forEach(other=>{
      if(other === user) return;
      const theirs = (data[other] && data[other][board.game] || {})[key] || 0;
      if(mine > theirs) pts++;
    });
  });
  return pts;
}

function renderRival(){
  const box = document.getElementById('rival-panel');
  if(!box || !currentUser || !lbCache) return;

  const standings = USERS
    .map(u => ({ user: u, points: playerPoints(u, lbCache) }))
    .sort((a, b) => b.points - a.points);

  const myIndex = standings.findIndex(s => s.user === currentUser);
  if(myIndex < 0){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');

  const me = standings[myIndex];
  const rival = myIndex > 0 ? standings[myIndex - 1] : null;

  if(!rival){
    box.innerHTML = `
      <div>
        <div class="rival-title">⚔️ Your Rival</div>
        <div class="rival-line">You're <b>#1</b> — nobody above you.</div>
        <div class="rival-gap">Everyone else is chasing you now.</div>
      </div>`;
    return;
  }

  const gap = rival.points - me.points;
  box.innerHTML = `
    <div>
      <div class="rival-title">⚔️ Your Rival</div>
      <div class="rival-line">You're <b>#${myIndex + 1}</b> · ${escapeHtml(rival.user)} is <b>#${myIndex}</b></div>
      <div class="rival-gap">Difference: ${gap} point${gap === 1 ? '' : 's'}</div>
    </div>
    <button class="btn btn-pink" onclick="beatYourRival()">Beat Your Rival</button>`;
  box.dataset.rival = rival.user;
}

// Opens whichever cabinet the rival is beating you on by the least — the
// cheapest place to take a point off them.
function beatYourRival(){
  const rival = document.getElementById('rival-panel').dataset.rival;
  if(!rival || !lbCache){ surpriseMe(); return; }
  let best = null, bestGap = Infinity;
  (typeof LB_BOARDS !== 'undefined' ? LB_BOARDS : []).forEach(board=>{
    const key = board.cols[0][0];
    const mine = (lbCache[currentUser][board.game] || {})[key] || 0;
    const theirs = (lbCache[rival] && lbCache[rival][board.game] || {})[key] || 0;
    const gap = theirs - mine;
    if(gap > 0 && gap < bestGap){
      const cab = CABINETS.find(c => c.best && c.best.game === board.game);
      if(cab){ bestGap = gap; best = cab; }
    }
  });
  if(best){
    toast('Closest gap', `${best.name} — ${bestGap} behind ${rival}`, '⚔️', 'pink');
    launchCabinet(best.id);
  } else {
    surpriseMe();
  }
}

/* =========================================================
   LEVEL 7 TV — an arcade news channel on the dashboard
   ========================================================= */
const TV = (function(){
  let items = [];
  let idx = 0;
  let timer = null;

  function build(){
    const out = [];
    if(lbCache && currentUser){
      // Weekly champion = most podium points overall.
      const standings = USERS
        .map(u => ({ user: u, points: playerPoints(u, lbCache) }))
        .sort((a, b) => b.points - a.points);
      if(standings[0] && standings[0].points > 0){
        out.push({ tag:'👑 CHAMPION', text:`${standings[0].user} leads the arcade`,
                   sub:`${standings[0].points} podium points across every cabinet` });
      }
      // Biggest single record on each board, picked at random for variety.
      const boards = (typeof LB_BOARDS !== 'undefined' ? LB_BOARDS : []).slice();
      for(let i = 0; i < 3 && boards.length; i++){
        const b = boards.splice(Math.floor(Math.random()*boards.length), 1)[0];
        const key = b.cols[0][0];
        let top = null;
        USERS.forEach(u=>{
          const v = (lbCache[u] && lbCache[u][b.game] || {})[key] || 0;
          if(!top || v > top.v) top = { u, v };
        });
        if(top && top.v > 0){
          out.push({ tag:'🏆 RECORD', text:`${top.u} holds ${b.title.replace(/^\S+\s/, '')}`,
                     sub:`${b.cols[0][1]}: ${top.v}` });
        }
      }
      const mine = playerPoints(currentUser, lbCache);
      out.push({ tag:'📈 YOU', text:`${currentUser} — ${mine} podium points`,
                 sub:'Every cabinet you top adds more' });
    }
    const untouched = CABINETS.filter(c => c.mod && c.best && lbCache && currentUser &&
      !((lbCache[currentUser][c.best.game] || {})[c.best.key]));
    if(untouched.length){
      const pick = untouched[Math.floor(Math.random()*untouched.length)];
      out.push({ tag:'🎮 TRY THIS', text:`You haven't played ${pick.name} yet`,
                 sub: pick.desc.slice(0, 70) });
    }
    if(!out.length){
      out.push({ tag:'📺 LEVEL 7 TV', text:'Nothing on the wire yet',
                 sub:'Play a few rounds and this fills up' });
    }
    items = out;
  }

  function paint(){
    const box = document.getElementById('tv-set');
    if(!box || !items.length) return;
    const it = items[idx % items.length];
    idx++;
    box.innerHTML = `
      <span class="tv-badge">${it.tag}</span>
      <div class="tv-body">${escapeHtml(it.text)}<div class="tv-sub">${escapeHtml(it.sub || '')}</div></div>`;
  }

  return {
    refresh(){ build(); paint(); },
    start(){
      this.refresh();
      if(timer) clearInterval(timer);
      timer = setInterval(paint, 6500);
    },
    stop(){ if(timer){ clearInterval(timer); timer = null; } }
  };
})();

/* =========================================================
   RESULT SCREENS — retry, next game, and exit confirmation
   =========================================================
   Rather than editing 23 result overlays by hand, the buttons are injected
   into each one once at startup. Every overlay already carries its own
   "play again" button, which stays where it is. */
let lastPlayedCabinet = null;

function enhanceResultOverlays(){
  document.querySelectorAll('.result-overlay').forEach(overlay=>{
    if(overlay.querySelector('.result-actions')) return;
    const screen = overlay.closest('.screen');
    if(!screen) return;
    const cabId = screen.id.replace(/-screen$/, '');

    const row = document.createElement('div');
    row.className = 'result-actions';
    row.innerHTML = `
      <button class="btn btn-secondary" onclick="nextGame()">▶ Next Game</button>
      <button class="btn btn-secondary" onclick="exitToArcade()">← Exit</button>`;

    // Move the existing "play again" button up into the new row so all three
    // read as one set of choices.
    const existing = overlay.querySelector('.btn-pink');
    if(existing){
      existing.textContent = '↻ Retry';
      row.insertBefore(existing, row.firstChild);
    }
    overlay.appendChild(row);
    overlay.dataset.cabinet = cabId;
  });
}

// Launches a random cabinet you aren't already on.
function nextGame(){
  const playable = CABINETS.filter(c => c.mod && c.screen !== currentScreen);
  if(!playable.length) return backToDashboard();
  const pick = playable[Math.floor(Math.random()*playable.length)];
  Sfx.play('whoosh');
  actuallyLaunchCabinet(pick.id);
}

function exitToArcade(){
  backToDashboard();
}

// Guards the ARCADE button while a game is actually mid-run, so a stray
// click doesn't throw away a good score.
function confirmExitIfPlaying(){
  const mod = currentGameModule();
  if(mod && mod.isRunning && mod.isRunning()){
    if(mod.pause) mod.pause();
    const ok = window.confirm('Quit this run? Your current progress will be lost.');
    if(!ok){
      if(mod.resume) mod.resume();
      return false;
    }
  }
  return true;
}

/* =========================================================
   SECRETS — konami code, hidden clicks, rare anomalies
   ========================================================= */
const SECRET_LOG = [];

function unlockSecret(id, title, sub){
  const isNew = Prefs.markSecret(id);
  const el = document.getElementById('secret-count');
  if(el) el.textContent = Prefs.secretCount();
  if(!isNew) return;
  toast(title, sub || 'Secret discovered', '🧩', 'gold');
  Sfx.play('perfect');
  SECRET_LOG.push(id);
  if(typeof earnTokens === 'function') earnTokens('secret_found', 1);
}

// Konami code — up up down down left right left right B A
const KONAMI = ['arrowup','arrowup','arrowdown','arrowdown','arrowleft','arrowright','arrowleft','arrowright','b','a'];
let konamiPos = 0;
document.addEventListener('keydown', e=>{
  const t = e.target;
  if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  const key = (e.key === ' ' ? 'space' : e.key.toLowerCase());
  konamiPos = (key === KONAMI[konamiPos]) ? konamiPos + 1 : (key === KONAMI[0] ? 1 : 0);
  if(konamiPos === KONAMI.length){
    konamiPos = 0;
    unlockSecret('konami', 'LEVEL 7 // FILE 001', 'The old code still works.');
    document.body.classList.toggle('custom-cursor');
    Prefs.set('cursor', document.body.classList.contains('custom-cursor'));
  }
});

// A hidden clickable in the login footer — nothing marks it as a button.
function wireSecretSpots(){
  const foot = document.querySelector('.login-foot');
  if(foot && !foot.dataset.wired){
    foot.dataset.wired = '1';
    foot.style.cursor = 'default';
    foot.addEventListener('click', ()=>{
      unlockSecret('foot', 'Somebody was here before you', 'A note scratched under the cabinet.');
    });
  }
  const tag = document.querySelector('#dashboard-screen .dash-welcome');
  if(tag && !tag.dataset.wired){
    tag.dataset.wired = '1';
    let taps = 0;
    tag.addEventListener('click', ()=>{
      if(++taps >= 7){
        taps = 0;
        unlockSecret('welcome7', 'SEVEN', 'You knocked seven times.');
      }
    });
  }
}

// Rare harmless anomalies — the dashboard occasionally does something odd.
const ANOMALIES = [
  function glitch(){
    document.body.classList.add('glitching');
    setTimeout(()=>document.body.classList.remove('glitching'), 1200);
  },
  function logoFlip(){
    const logo = document.querySelector('.topbar-logo');
    if(!logo) return;
    const original = logo.innerHTML;
    logo.innerHTML = 'LEVEL<span> 8</span>';
    setTimeout(()=>{ logo.innerHTML = original; }, 3400);
  },
  function ghostMessage(){
    toast('...is anyone there?', 'unknown sender', '👁', 'pink');
  }
];

function maybeAnomaly(){
  if(currentScreen !== 'dashboard-screen') return;
  if(Math.random() > 0.05) return;          // ~1 in 20 checks
  ANOMALIES[Math.floor(Math.random()*ANOMALIES.length)]();
  unlockSecret('anomaly', 'You saw that, right?', 'Something in the arcade blinked.');
}

/* =========================================================
   WIRING
   ========================================================= */
function initQol(){
  document.body.classList.toggle('custom-cursor', !!Prefs.get('cursor'));
  const layout = Prefs.get('layout') || 'grid';
  document.querySelectorAll('.layout-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.layout === layout);
  });
  enhanceResultOverlays();
  wireSecretSpots();
  setInterval(maybeAnomaly, 45000);
}
