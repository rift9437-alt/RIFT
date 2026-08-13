/* =========================================================
   FRIEND ACTIVITY FEED
   =========================================================
   A short list of what the people you've added have been up to. It only
   carries things worth telling someone about — an achievement, a round level,
   a race won, a season tier — rather than every token earned, because a feed
   that reports everything gets skimmed and then ignored.

   With no friends added it falls back to the whole arcade, since an empty
   panel teaches nothing and seeing what other people are doing is how you
   find someone to add in the first place. */
let feedItems = [];
let feedFriendsOnly = false;
let feedTimer = null;

const FEED_LOOK = {
  achievement: { icon: '🏆', verb: 'unlocked' },
  level:       { icon: '⭐', verb: 'reached' },
  kart:        { icon: '🏁', verb: '' },
  pass:        { icon: '🎖', verb: '' },
  weekly:      { icon: '🗓', verb: '' },
  prestige:    { icon: '💫', verb: 'hit' }
};

// "just now" reads better than a timestamp for something that happened a
// minute ago, and a timestamp reads better than "4300 minutes ago".
function feedAgo(iso){
  const then = new Date(iso).getTime();
  if(isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if(hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

async function loadFeed(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/feed`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    const data = await res.json();
    feedItems = data.items || [];
    feedFriendsOnly = !!data.friendsOnly;
    renderFeed();
  }catch(e){
    console.error('Feed load failed:', e);
  }
}

function renderFeed(){
  const panel = document.getElementById('feed-panel');
  const list = document.getElementById('feed-list');
  const note = document.getElementById('feed-note');
  if(!panel || !list) return;

  note.textContent = feedFriendsOnly
    ? 'What your friends have been up to.'
    : 'Nobody added yet — here’s the whole arcade. Add friends on a profile to narrow it down.';

  if(!feedItems.length){
    list.innerHTML = '<div class="feed-empty">Quiet in here. Go and do something notable.</div>';
    return;
  }
  list.innerHTML = feedItems.map(it => {
    const look = FEED_LOOK[it.kind] || { icon: '•', verb: '' };
    const mine = it.user === currentUser;
    return `
      <div class="feed-row ${mine ? 'mine' : ''}">
        <span class="feed-icon">${look.icon}</span>
        <span class="feed-text">
          <b onclick="renderProfile('${escapeHtml(it.user)}'); showScreen('profile-screen');">${escapeHtml(it.user)}</b>
          ${look.verb ? escapeHtml(look.verb) + ' ' : ''}${escapeHtml(it.detail)}
        </span>
        <span class="feed-when">${feedAgo(it.at)}</span>
      </div>`;
  }).join('');
}

// Slow on purpose: this is ambient, and the socket already handles anything
// that needs to be immediate.
function startFeedPolling(){
  stopFeedPolling();
  loadFeed();
  feedTimer = setInterval(() => { if(currentUser) loadFeed(); }, 90000);
}
function stopFeedPolling(){
  if(feedTimer){ clearInterval(feedTimer); feedTimer = null; }
}
