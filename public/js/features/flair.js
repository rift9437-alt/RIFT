/* =========================================================
   FLAIR — emotes, nameplates, chat badges, victory and start
   animations, score pop-ups, cabinet card effects, menu music
   =========================================================
   Presentation only. Everything reads from data the wallet already holds. */

/* ---------------- nameplates + chat badges ---------------- */
// A player's badge set is derived from what they own, so it stays true
// without anything extra being stored.
function badgesFor(user){
  const rec = lbCache && lbCache[user];
  const w = (rec && rec.wallet) || {};
  const out = [];
  if((w.prestige || 0) > 0) out.push({ icon:'⭐', title:'Prestige ' + w.prestige, color:'#ffb020' });
  if((w.level || 1) >= 25)  out.push({ icon:'🎖', title:'Level ' + w.level, color:'#c9a6ff' });
  if((w.owned || []).length >= 5) out.push({ icon:'🎨', title:'Collector', color:'#4cb8ff' });
  if((w.achievements || []).length >= 10) out.push({ icon:'🏆', title:'Decorated', color:'#ffc857' });
  if((w.dailyBestStreak || 0) >= 5) out.push({ icon:'🔥', title:'Streaker', color:'#ff5b3d' });
  return out;
}

function nameplate(user){
  const rec = lbCache && lbCache[user];
  const w = (rec && rec.wallet) || {};
  const avatar = w.avatar || '';
  const title = (w.titles && w.titles.length) ? w.titles[w.titles.length - 1] : '';
  const badges = badgesFor(user).map(b =>
    `<span class="flair-badge" style="color:${b.color}; border-color:${b.color}55" title="${escapeHtml(b.title)}">${b.icon}</span>`).join('');
  return `<span class="nameplate">` +
    (avatar ? `<span class="np-avatar">${avatar}</span>` : '') +
    `<span class="np-name">${escapeHtml(user)}</span>` +
    (title ? `<span class="np-title">${escapeHtml(title)}</span>` : '') +
    badges +
    `</span>`;
}

/* ---------------- emotes ---------------- */
const EMOTES = [
  { key:'gg',    icon:'🤝', text:'gg!' },
  { key:'nice',  icon:'🔥', text:'nice one' },
  { key:'oof',   icon:'💀', text:'oof' },
  { key:'lol',   icon:'😂', text:'lol' },
  { key:'wow',   icon:'😮', text:'no way' },
  { key:'rip',   icon:'🪦', text:'rip' },
  { key:'clap',  icon:'👏', text:'clap clap' },
  { key:'salt',  icon:'🧂', text:'salty' },
  { key:'crown', icon:'👑', text:'bow to me' },
  { key:'brb',   icon:'💤', text:'brb' }
];

function toggleEmotePicker(){
  const box = document.getElementById('emote-picker');
  if(!box) return;
  if(!box.dataset.built){
    box.dataset.built = '1';
    box.innerHTML = EMOTES.map(e =>
      `<button class="emote-btn" title="${escapeHtml(e.text)}" onclick="sendEmote('${e.key}')">${e.icon}</button>`).join('');
  }
  box.classList.toggle('hidden');
}

// Emotes go through the normal chat pipe, so everyone sees them and the
// server-side throttle still applies.
function sendEmote(key){
  const e = EMOTES.find(x => x.key === key);
  if(!e) return;
  const input = document.getElementById('chat-input');
  if(input){
    input.value = e.icon + ' ' + e.text;
    if(typeof sendChatMessage === 'function') sendChatMessage();
  }
  const box = document.getElementById('emote-picker');
  if(box) box.classList.add('hidden');
  Sfx.play('select');
  floatEmote(e.icon);
}

// A little burst of the emote floating up the screen.
function floatEmote(icon){
  const el = document.createElement('div');
  el.className = 'floating-emote';
  el.textContent = icon;
  el.style.left = (30 + Math.random() * 40) + '%';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1800);
}

/* ---------------- victory + start animations ---------------- */
function playVictoryFx(won){
  if(!settings || settings.shake === false) { /* still fine to show */ }
  const layer = document.createElement('div');
  layer.className = 'victory-layer';
  const colors = won
    ? ['#ffc857','#45ffb0','#4cb8ff','#ff6ad5','#ffffff']
    : ['#7c8699','#4a5568','#2d3748'];
  const count = won ? 60 : 18;
  for(let i = 0; i < count; i++){
    const bit = document.createElement('i');
    bit.style.left = Math.random() * 100 + '%';
    bit.style.background = colors[Math.floor(Math.random() * colors.length)];
    bit.style.animationDelay = (Math.random() * 0.5) + 's';
    bit.style.animationDuration = (1.4 + Math.random() * 1.2) + 's';
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(()=>layer.remove(), 2800);
}

// A quick "3 · 2 · 1" style flourish when a cabinet opens.
function playStartAnimation(name, then){
  const el = document.createElement('div');
  el.className = 'start-splash';
  el.innerHTML = `<div class="start-name">${escapeHtml(name)}</div><div class="start-sub">GET READY</div>`;
  document.body.appendChild(el);
  Sfx.play('whoosh');
  setTimeout(()=>{
    el.classList.add('out');
    setTimeout(()=>{ el.remove(); if(then) then(); }, 320);
  }, 700);
}

/* ---------------- score pop-ups ---------------- */
// Style is picked by magnitude, so a big score reads differently to a small one.
function scorePop(text, style){
  const el = document.createElement('div');
  el.className = 'score-pop score-pop-' + (style || 'normal');
  el.textContent = text;
  el.style.left = (42 + Math.random() * 16) + '%';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1400);
}

/* ---------------- menu music ---------------- */
// Generated, not streamed — a slow arpeggio over a pad, built from the same
// WebAudio context the sound effects already use.
const MenuMusic = (function(){
  let ctxA = null, master = null, timer = null, step = 0, on = false;
  const SCALE = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
  // Background music wants to sit well under the effects, so the slider runs
  // 0–1 over a ceiling rather than straight into the gain.
  const MUSIC_CEILING = 0.10;
  const musicLevel = () =>
    (typeof settings !== 'undefined' && typeof settings.musicVolume === 'number')
      ? Math.max(0, Math.min(1, settings.musicVolume)) : 0.5;

  function ensure(){
    if(ctxA) return ctxA;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    try{
      ctxA = new AC();
      master = ctxA.createGain();
      master.gain.value = MUSIC_CEILING * musicLevel();
      master.connect(ctxA.destination);
    }catch(e){ ctxA = null; }
    return ctxA;
  }

  function note(freq, dur, type, vol){
    const ac = ensure();
    if(!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function tick(){
    const pattern = [0, 2, 4, 6, 4, 2];
    note(SCALE[pattern[step % pattern.length]], 1.1, 'triangle', 0.4);
    if(step % 6 === 0) note(SCALE[0] / 2, 2.4, 'sine', 0.5);
    step++;
  }

  return {
    isOn(){ return on; },
    // Called by applySettings whenever the slider moves.
    setVolume(v){
      if(!master || !ctxA) return;
      const g = MUSIC_CEILING * Math.max(0, Math.min(1, Number(v) || 0));
      try{ master.gain.setTargetAtTime(g, ctxA.currentTime, 0.05); }
      catch(e){ master.gain.value = g; }
    },
    start(){
      if(on) return;
      if(!ensure()) return;
      if(ctxA.state === 'suspended') ctxA.resume().catch(()=>{});
      on = true;
      tick();
      timer = setInterval(tick, 1400);
    },
    stop(){
      on = false;
      if(timer){ clearInterval(timer); timer = null; }
    },
    toggle(){
      this.isOn() ? this.stop() : this.start();
      try{ localStorage.setItem('level7_music', this.isOn() ? '1' : '0'); }catch(e){}
      const btn = document.getElementById('music-toggle-btn');
      if(btn){
        btn.textContent = this.isOn() ? '🎵' : '🎶';
        btn.style.color = this.isOn() ? 'var(--cyan)' : '';
      }
      return this.isOn();
    }
  };
})();

function setMusicVolume(v){ MenuMusic.setVolume(v); }

function toggleMenuMusic(){
  const on = MenuMusic.toggle();
  toast(on ? 'Menu music on' : 'Menu music off', '', on ? '🎵' : '🔇');
}

/* ---------------- init ---------------- */
function initFlair(){
  // Music only auto-starts if it was on last time, and only after a gesture,
  // since browsers block audio before one.
  let want = false;
  try{ want = localStorage.getItem('level7_music') === '1'; }catch(e){}
  if(want){
    const kick = ()=>{
      MenuMusic.start();
      const btn = document.getElementById('music-toggle-btn');
      if(btn){ btn.textContent = '🎵'; btn.style.color = 'var(--cyan)'; }
      document.removeEventListener('click', kick);
    };
    document.addEventListener('click', kick);
  }
}
