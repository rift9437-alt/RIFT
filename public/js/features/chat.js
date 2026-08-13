/* =========================================================
   ARCADE CHAT — a shared room for all keyholders
   =========================================================
   Same server-authoritative shape as the leaderboard: the client only ever
   posts text and asks for anything newer than the last id it has seen, so the
   dock stays live without shipping the whole history every few seconds. */
const CHAT_OPEN_KEY = 'level7_chat_open';
const CHAT_POLL_MS = 3500;
let chatMessages = [];
let chatLastId = 0;
let chatPollTimer = null;
let chatOpen = false;
let chatUnread = 0;
let chatSending = false;

function escapeHtml(str){
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function chatTime(iso){
  const d = new Date(iso);
  if(isNaN(d)) return '';
  return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

function openChatDock(){
  const dock = document.getElementById('chat-dock');
  if(!dock) return;
  dock.classList.remove('hidden');
  let wantOpen = false;
  try{ wantOpen = localStorage.getItem(CHAT_OPEN_KEY) === '1'; }catch(e){}
  setChatOpen(wantOpen);
}

function hideChatDock(){
  const dock = document.getElementById('chat-dock');
  if(dock) dock.classList.add('hidden');
  chatMessages = [];
  chatLastId = 0;
  chatUnread = 0;
  setChatOpen(false);
}

function setChatOpen(open){
  chatOpen = open;
  document.getElementById('chat-panel').classList.toggle('hidden', !open);
  document.getElementById('chat-toggle').classList.toggle('hidden', open);
  if(open){
    chatUnread = 0;
    updateChatBadge();
    renderChat();
    refreshChat(true);
  }
  try{ localStorage.setItem(CHAT_OPEN_KEY, open ? '1' : '0'); }catch(e){}
}

function toggleChatDock(){
  setChatOpen(!chatOpen);
}

function updateChatBadge(){
  const badge = document.getElementById('chat-unread');
  if(!badge) return;
  badge.textContent = chatUnread > 9 ? '9+' : chatUnread;
  badge.classList.toggle('hidden', chatUnread === 0);
}

const CHAT_REACTIONS = ['👍', '😂', '🔥', '💀', '👀', '🎉'];

// Anything that looks like @SOMEONE and matches a real account becomes a
// mention. Names here can contain - and _, so the pattern has to allow them.
function chatBodyHtml(text){
  const safe = escapeHtml(text);
  return safe.replace(/@([A-Za-z0-9_-]{2,20})/g, (whole, name) => {
    const match = (typeof USERS !== 'undefined' ? USERS : [])
      .find(u => u.toLowerCase() === name.toLowerCase());
    if(!match) return whole;
    const me = match === currentUser ? ' mention-me' : '';
    return `<span class="chat-mention${me}">@${escapeHtml(match)}</span>`;
  });
}

function mentionsMe(text){
  if(!currentUser) return false;
  return new RegExp('@' + currentUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text || '');
}

function reactionRow(m){
  const mine = new Set();
  const chips = Object.entries(m.reactions || {})
    .filter(([, who]) => who && who.length)
    .map(([emoji, who]) => {
      const isMine = who.includes(currentUser);
      if(isMine) mine.add(emoji);
      return `<button class="chat-react ${isMine ? 'on' : ''}" title="${escapeHtml(who.join(', '))}"
                onclick="reactToMessage(${m.id}, '${emoji}')">${emoji} ${who.length}</button>`;
    }).join('');
  // The picker only offers what isn't already showing, so the row doesn't
  // double up on the same face.
  const rest = CHAT_REACTIONS.filter(e => !(m.reactions && m.reactions[e] && m.reactions[e].length));
  const add = rest.length ? `
    <span class="chat-react-add">
      <button class="chat-react chat-react-more" title="React">＋</button>
      <span class="chat-react-menu">
        ${rest.map(e => `<button onclick="reactToMessage(${m.id}, '${e}')">${e}</button>`).join('')}
      </span>
    </span>` : '';
  return `<div class="chat-reactions">${chips}${add}</div>`;
}

function renderChat(){
  const log = document.getElementById('chat-log');
  if(!log) return;
  if(chatMessages.length === 0){
    log.innerHTML = '<div class="chat-note">Nothing here yet.<br>Say hi — everyone signed in sees this room.<br><span class="chat-note-dim">/me, /roll and /stats work here too.</span></div>';
    return;
  }
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.innerHTML = chatMessages.map(m=>{
    const mine = m.user === currentUser;
    const atMe = mentionsMe(m.text) && !mine;
    // /me reads as an action rather than as something someone said, so it
    // loses the name header and gets its own voice.
    const action = m.text.startsWith('* ') && m.text.endsWith(' *');
    if(action){
      return `<div class="chat-msg chat-action">${chatBodyHtml(m.text.slice(2, -2))}</div>${reactionRow(m)}`;
    }
    return `
      <div class="chat-msg ${mine?'me':''} ${atMe?'at-me':''}">
        <div class="chat-msg-head">
          <span class="chat-msg-user">${typeof clanTagFor === 'function' && clanTagFor(m.user) ? `<span class="clan-badge">[${escapeHtml(clanTagFor(m.user))}]</span>` : ''}${escapeHtml(m.user)}${mine?' (you)':''}</span>
          <span class="chat-msg-time">${chatTime(m.at)}</span>
        </div>
        <div class="chat-msg-body">${chatBodyHtml(m.text)}</div>
        ${reactionRow(m)}
      </div>
    `;
  }).join('');
  if(nearBottom || chatMessages.length <= 12) log.scrollTop = log.scrollHeight;
}

async function reactToMessage(messageId, emoji){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/chat/react`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, messageId, emoji })
    });
    const data = await res.json();
    if(!res.ok) return;
    applyReactions(data.messageId, data.reactions);
    Sfx.play('click', 1.4);
  }catch(e){ console.error('Reaction failed:', e); }
}

function applyReactions(messageId, reactions){
  const m = chatMessages.find(x => x.id === messageId);
  if(!m) return;
  m.reactions = reactions || {};
  if(chatOpen) renderChat();
}

// Shared by the poller and the socket, so a message takes the same path —
// dedupe, buffer trim, unread badge, sound — whichever way it arrived.
function ingestChatMessages(incoming, force){
  if(!Array.isArray(incoming) || !incoming.length){
    if(force) renderChat();
    return;
  }
  // The socket can race the poll and deliver the same message twice.
  const fresh = incoming.filter(m => m.id > chatLastId);
  if(!fresh.length){
    if(force) renderChat();
    return;
  }
  const others = fresh.filter(m => m.user !== currentUser);
  const fromOthers = others.length;
  // Being named is worth interrupting for even with the dock shut.
  if(!force){
    others.filter(m => mentionsMe(m.text)).forEach(m => {
      if(typeof toast === 'function'){
        toast(`${m.user} mentioned you`, m.text.slice(0, 60), '💬', 'pink');
      }
      Sfx.play('perfect', 1.1);
    });
  }
  chatMessages = chatMessages.concat(fresh);
  // Keep the client-side buffer bounded; the server keeps the archive.
  if(chatMessages.length > 200) chatMessages = chatMessages.slice(-200);
  chatLastId = fresh[fresh.length-1].id;
  if(chatOpen){
    renderChat();
  } else if(fromOthers > 0){
    chatUnread += fromOthers;
    updateChatBadge();
  }
  if(fromOthers > 0 && !force) Sfx.play('coin', 1.25);
}

async function refreshChat(force){
  if(!currentUser) return;
  try{
    const res = await fetch(`${LB_API_BASE}/chat?since=${chatLastId}`, { headers: authHeaders() });
    if(!res.ok) throw new Error('bad response');
    const data = await res.json();
    const incoming = Array.isArray(data.messages) ? data.messages : [];
    if(typeof Realtime === 'undefined' || !Realtime.isLive()){
      document.getElementById('chat-status').textContent = 'POLLING';
    }

    ingestChatMessages(incoming, force);
  }catch(e){
    const st = document.getElementById('chat-status');
    if(st) st.textContent = 'OFFLINE';
  }
}

/* Slash commands. Each one turns into ordinary chat text before it's sent —
   the server stays a dumb pipe, and anyone on an older client still reads
   something sensible rather than a raw command. */
function expandChatCommand(raw){
  if(!raw.startsWith('/')) return raw;
  const [cmd, ...rest] = raw.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  switch(cmd.toLowerCase()){
    case 'me':
      return arg ? `* ${currentUser} ${arg} *` : null;
    case 'shrug':
      return (arg ? arg + ' ' : '') + '¯\\_(ツ)_/¯';
    case 'roll': {
      // /roll, /roll 20, /roll 2d6
      const m = arg.match(/^(?:(\d{1,2})d)?(\d{1,4})$/i);
      const dice = m ? Math.min(10, parseInt(m[1] || '1', 10)) : 1;
      const sides = m ? Math.max(2, parseInt(m[2], 10)) : 6;
      const rolls = Array.from({length: dice}, () => 1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      return `* ${currentUser} rolled ${dice}d${sides}: ${rolls.join(' + ')}${dice > 1 ? ' = ' + total : ''} *`;
    }
    case 'stats': {
      const game = (arg || '').toLowerCase();
      const cab = (typeof CABINETS !== 'undefined' ? CABINETS : [])
        .find(c => c.id === game || c.name.toLowerCase() === game);
      if(!cab || !cab.best) return `* ${currentUser} tried /stats — try a cabinet name, like /stats robot *`;
      const rec = lbCache && lbCache[currentUser] && lbCache[currentUser][cab.best.game];
      const val = rec ? rec[cab.best.key] : 0;
      return `* ${currentUser}'s best on ${cab.name}: ${val || 0} *`;
    }
    case 'help':
      return `* commands: /me, /roll, /shrug, /stats <cabinet> *`;
    default:
      return raw;   // not a command we know — send it as typed
  }
}

async function sendChatMessage(){
  const input = document.getElementById('chat-input');
  const err = document.getElementById('chat-error');
  const typed = input.value.trim();
  err.textContent = '';
  if(!typed || chatSending) return;
  const text = expandChatCommand(typed);
  if(text === null){
    err.textContent = 'Usage: /me does something';
    return;
  }
  chatSending = true;
  document.getElementById('chat-send').disabled = true;
  try{
    const res = await apiFetch(`${LB_API_BASE}/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ user: currentUser, text, since: chatLastId })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      err.textContent = data.error || 'Message not sent.';
    } else {
      input.value = '';
      Sfx.play('select');
      // The POST returns everything newer than what we already had.
      const incoming = Array.isArray(data.messages) ? data.messages : [];
      if(incoming.length){
        chatMessages = chatMessages.concat(incoming.filter(m=>m.id > chatLastId));
        if(chatMessages.length > 200) chatMessages = chatMessages.slice(-200);
        chatLastId = Math.max(chatLastId, incoming[incoming.length-1].id);
        renderChat();
      }
    }
  }catch(e){
    err.textContent = 'Could not reach the server — try again.';
  }finally{
    chatSending = false;
    document.getElementById('chat-send').disabled = false;
  }
}

function startChatPolling(){
  stopChatPolling();
  refreshChat(true);
  // The socket delivers messages the moment they're posted; this poll stays
  // as the fallback and backs right off while the socket is healthy, so a
  // dropped connection costs a few seconds of latency rather than the room.
  chatPollTimer = setInterval(()=>{
    if(!currentUser) return;
    if(typeof Realtime !== 'undefined' && Realtime.isLive()) return;
    refreshChat(false);
  }, CHAT_POLL_MS);
}

function stopChatPolling(){
  if(chatPollTimer){ clearInterval(chatPollTimer); chatPollTimer = null; }
}

document.getElementById('chat-input').addEventListener('keydown', e=>{
  if(e.key === 'Enter'){
    e.preventDefault();
    sendChatMessage();
  }
});
