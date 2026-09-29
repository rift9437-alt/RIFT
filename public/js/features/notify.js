/* =========================================================
   NOTIFICATIONS, BOUNTIES, CHALLENGES
   =========================================================
   The feed is everybody's news. This is the things aimed at you: a bounty you
   claimed, somebody's challenge, a whisper, a note on your profile. They have
   a read/unread state, which is why they can't just live in the feed.

   The bell only polls as a fallback — the server pushes a `notify` event down
   the socket the moment something lands, so it lights up immediately. */
let notifItems = [];
let notifUnread = 0;
let notifTimer = null;
let bountyItems = [];

const NOTIF_ICON = {
  bounty: '🎯', challenge: '⚔', whisper: '✉', guestbook: '📝',
  gift: '🎁', clan: '🛡'
};

async function loadNotifications(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/notifications`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    notifItems = data.items || [];
    notifUnread = data.unread || 0;
    paintBell();
    if(!document.getElementById('notif-panel').classList.contains('hidden')) renderNotifications();
  }catch(e){
    console.error('Notifications load failed:', e);
  }
}

function paintBell(){
  const badge = document.getElementById('notif-count');
  if(!badge) return;
  badge.textContent = notifUnread > 9 ? '9+' : notifUnread;
  badge.classList.toggle('hidden', notifUnread === 0);
  const btn = document.getElementById('notif-btn');
  if(btn) btn.classList.toggle('ringing', notifUnread > 0);
}

function toggleNotifications(){
  const panel = document.getElementById('notif-panel');
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening);
  if(!opening) return;
  renderNotifications();
  // Opening it is reading it.
  if(notifUnread > 0){
    notifUnread = 0;
    paintBell();
    apiFetch(`${LB_API_BASE}/notifications/seen`, { method:'POST', headers: authHeaders() })
      .catch(e => console.error('Could not mark notifications read:', e));
  }
}

function renderNotifications(){
  const list = document.getElementById('notif-list');
  if(!list) return;
  if(!notifItems.length){
    list.innerHTML = '<div class="notif-empty">Nothing for you yet.</div>';
    return;
  }
  list.innerHTML = notifItems.map(n => `
    <div class="notif-row ${n.seen ? '' : 'fresh'}">
      <span class="notif-icon">${NOTIF_ICON[n.kind] || '•'}</span>
      <span class="notif-text">
        <b>${escapeHtml(n.title)}</b>
        ${n.detail ? `<i>${escapeHtml(n.detail)}</i>` : ''}
      </span>
      <span class="notif-when">${feedAgo(n.at)}</span>
    </div>`).join('');
}

/* ---- bounties --------------------------------------------------------- */
// Three a day, each pointing at a score somebody in the arcade has actually
// posted. Chasing a real name is the whole appeal.
async function loadBounties(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/bounties`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    bountyItems = data.items || [];
    renderBounties();
  }catch(e){
    console.error('Bounty load failed:', e);
  }
}

function renderBounties(){
  const grid = document.getElementById('bounty-grid');
  const note = document.getElementById('bounty-note');
  if(!grid) return;
  const open = bountyItems.filter(b => !b.done);
  note.textContent = open.length
    ? 'Beat the number and the tokens land the moment you do.'
    : (bountyItems.length ? 'All cleared. Fresh ones tomorrow.'
                          : 'Nothing to chase right now — post some scores and the arcade will find you rivals.');
  grid.innerHTML = bountyItems.map(b => {
    const pct = b.target ? Math.min(100, (b.have / b.target) * 100) : 0;
    return `
      <div class="daily-card ${b.done ? 'claimed' : ''}">
        <div class="bounty-kind">${b.kind === 'challenge' ? '⚔ CHALLENGE' : '🎯 BOUNTY'}</div>
        <div class="daily-label">${escapeHtml(b.gameName)}</div>
        <div class="bounty-target">beat <b>${b.target.toLocaleString('en-GB')}</b><br>
          <span>${b.from ? escapeHtml(b.from) + "'s score" : 'the target'}</span></div>
        <div class="daily-progress-track"><div class="daily-progress-fill" style="width:${pct}%"></div></div>
        <div class="daily-progress-label">${b.have.toLocaleString('en-GB')} / ${b.target.toLocaleString('en-GB')}</div>
        <div class="daily-reward">🪙 ${b.reward}</div>
        <button class="btn btn-secondary" ${b.done ? 'disabled' : ''}
                onclick="playBountyGame('${b.game}')">${b.done ? '✓ Claimed' : 'Play it'}</button>
      </div>`;
  }).join('');
}

// Jump straight to the cabinet a bounty is about.
function playBountyGame(game){
  const cab = CABINETS.find(c => c.id === game);
  if(cab) launchCabinet(cab.id);
  else toast('Not a cabinet', 'That one is played through Play Together', '🎮', 'cyan');
}

/* ---- challenging a friend --------------------------------------------- */
// The score itself comes from the server reading your own record — the
// client only names the game and the person.
async function sendChallenge(to, game){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/challenge`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, to, game })
    });
    const data = await res.json();
    if(!res.ok){ toast('Not sent', data.error || 'Challenge failed', '⚔', 'pink'); return; }
    toast('Challenge sent', `${to} has to beat ${data.target}`, '⚔', 'gold');
    Sfx.play('select');
  }catch(e){ console.error('Challenge failed:', e); }
}

function startNotifPolling(){
  stopNotifPolling();
  loadNotifications();
  loadBounties();
  // The socket does the real work; this is the fallback for when it's down.
  notifTimer = setInterval(() => { if(currentUser) loadNotifications(); }, 60000);
}
function stopNotifPolling(){
  if(notifTimer){ clearInterval(notifTimer); notifTimer = null; }
  notifItems = []; notifUnread = 0; bountyItems = [];
}
