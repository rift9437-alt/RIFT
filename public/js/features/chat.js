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

function renderChat(){
  const log = document.getElementById('chat-log');
  if(!log) return;
  if(chatMessages.length === 0){
    log.innerHTML = '<div class="chat-note">Nothing here yet.<br>Say hi — everyone signed in sees this room.</div>';
    return;
  }
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.innerHTML = chatMessages.map(m=>{
    const mine = m.user === currentUser;
    return `
      <div class="chat-msg ${mine?'me':''}">
        <div class="chat-msg-head">
          <span class="chat-msg-user">${typeof clanTagFor === 'function' && clanTagFor(m.user) ? `<span class="clan-badge">[${escapeHtml(clanTagFor(m.user))}]</span>` : ''}${escapeHtml(m.user)}${mine?' (you)':''}</span>
          <span class="chat-msg-time">${chatTime(m.at)}</span>
        </div>
        <div class="chat-msg-body">${escapeHtml(m.text)}</div>
      </div>
    `;
  }).join('');
  if(nearBottom || chatMessages.length <= 12) log.scrollTop = log.scrollHeight;
}

async function refreshChat(force){
  if(!currentUser) return;
  try{
    const res = await fetch(`${LB_API_BASE}/chat?since=${chatLastId}`, { headers: authHeaders() });
    if(!res.ok) throw new Error('bad response');
    const data = await res.json();
    const incoming = Array.isArray(data.messages) ? data.messages : [];
    document.getElementById('chat-status').textContent = 'LIVE';

    if(incoming.length){
      const fromOthers = incoming.filter(m=>m.user !== currentUser).length;
      chatMessages = chatMessages.concat(incoming);
      // Keep the client-side buffer bounded; the server keeps the archive.
      if(chatMessages.length > 200) chatMessages = chatMessages.slice(-200);
      chatLastId = incoming[incoming.length-1].id;
      if(chatOpen){
        renderChat();
      } else if(fromOthers > 0){
        chatUnread += fromOthers;
        updateChatBadge();
      }
      if(fromOthers > 0 && !force) Sfx.play('coin', 1.25);
    } else if(force){
      renderChat();
    }
  }catch(e){
    const st = document.getElementById('chat-status');
    if(st) st.textContent = 'OFFLINE';
  }
}

async function sendChatMessage(){
  const input = document.getElementById('chat-input');
  const err = document.getElementById('chat-error');
  const text = input.value.trim();
  err.textContent = '';
  if(!text || chatSending) return;
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
  chatPollTimer = setInterval(()=>{ if(currentUser) refreshChat(false); }, CHAT_POLL_MS);
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
