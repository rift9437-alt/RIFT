/* =========================================================
   COMMAND PALETTE + SHORTCUT SHEET
   =========================================================
   Ctrl/⌘+K anywhere opens a search box over the top of whatever you're
   doing; type a couple of letters and hit enter. The arcade has grown to
   fifty-odd screens and the only way to reach most of them was to go back to
   the dashboard first, which is a lot of clicking to check one leaderboard.

   ? opens the shortcut sheet, which lists the keys for the screen you're
   actually on rather than a fixed list — the game keys are the ones people
   forget, and they differ per cabinet. */

/* ---- what the palette can take you to -------------------------------- */
// Built fresh each time it opens so it picks up new cabinets, your clan and
// whether a race is running without anything having to invalidate a cache.
function paletteEntries(){
  const out = [];
  CABINETS.forEach(cab => {
    out.push({
      icon: cab.icon, label: cab.name,
      hint: cab.mod ? 'Play' : 'Open',
      keywords: (CABINET_KEYWORDS[cab.id] || '') + ' ' + (cab.tags || []).join(' '),
      run: () => launchCabinet(cab.id)
    });
  });

  const go = (id, fn) => () => { stopAllGames(); showScreen(id); if(fn) fn(); };
  out.push(
    { icon:'🏠', label:'Dashboard',      hint:'Go',   keywords:'home arcade cabinets', run:()=>backToDashboard() },
    { icon:'🛒', label:'Shop',           hint:'Go',   keywords:'themes buy tokens cosmetics', run:go('shop-screen', ()=>renderShop()) },
    { icon:'🏆', label:'Achievements',   hint:'Go',   keywords:'badges titles unlocks progress', run:go('achievements-screen', ()=>renderAchievements()) },
    { icon:'👤', label:'Profile',        hint:'Go',   keywords:'stats level xp me', run:go('profile-screen', ()=>renderProfile(currentUser)) },
    { icon:'📦', label:'Loot Crates',    hint:'Go',   keywords:'crates open pulls', run:go('lootcrate-screen', ()=>renderLootCrateScreen()) },
    { icon:'🌐', label:'Community',      hint:'Go',   keywords:'submissions vote cosmetics goal', run:go('community-screen', ()=>renderCommunityScreen()) },
    { icon:'🎡', label:'Prize Wheel',    hint:'Go',   keywords:'spin daily free', run:go('spin-screen', ()=>renderSpinScreen()) },
    { icon:'📚', label:'Collection',     hint:'Go',   keywords:'owned themes companions', run:()=>openCollection() },
    { icon:'🎒', label:'Inventory',      hint:'Go',   keywords:'items gifts', run:()=>openInventory() },
    { icon:'🥇', label:'Leaderboard',    hint:'Go',   keywords:'ranks records best scores', run:go('leaderboard-screen', ()=>renderLeaderboard()) },
    { icon:'⚔',  label:'Clans',          hint:'Go',   keywords:'team group guild', run:()=>openClans() },
    { icon:'🏅', label:'Tournaments',    hint:'Go',   keywords:'contest compete events', run:()=>openTournaments() },
    { icon:'📰', label:'The Gazette',    hint:'Go',   keywords:'news lore rumours records', run:()=>openGazette() },
    { icon:'🎮', label:'Play Together',  hint:'Go',   keywords:'multiplayer rooms hub kart friends', run:()=>openMultiplayer() },
    { icon:'🧍', label:'Avatar Creator', hint:'Go',   keywords:'dress up character 3d', run:()=>openAvatarCreator() },
    { icon:'📜', label:'Update Log',     hint:'Go',   keywords:'patch notes changes', run:go('updatelog-screen', ()=>loadAndRenderUpdateLog()) },
    { icon:'⚙',  label:'Settings',       hint:'Open', keywords:'sound volume scanlines accessibility motion', run:()=>openSettings() },
    { icon:'⌨',  label:'Keyboard Shortcuts', hint:'Open', keywords:'keys help controls', run:()=>openShortcutSheet() },
    { icon:'🐞', label:'Report a Bug',   hint:'Open', keywords:'broken problem feedback issue', run:()=>openBugReport() },
    { icon:'🚪', label:'Log Out',        hint:'Do',   keywords:'sign out leave exit', run:()=>logout() }
  );

  // Actions that only make sense sometimes, so they only appear then.
  if(typeof mpRoom !== 'undefined' && mpRoom){
    out.push({ icon:'👋', label:'Leave your room', hint:'Do',
               keywords:'quit lobby race hub', run:()=>leaveMpRoom() });
  }
  const readyDaily = (dailyInfo && dailyInfo.daily ? dailyInfo.daily.challenges : [])
    .filter(c => c.progress >= c.target && !c.claimed).length;
  if(readyDaily){
    out.push({ icon:'🎁', label:`Claim ${readyDaily} finished challenge${readyDaily > 1 ? 's' : ''}`,
               hint:'Do', keywords:'daily reward tokens collect',
               run:()=>{ backToDashboard(); document.getElementById('daily-panel')
                          .scrollIntoView({ behavior:'smooth', block:'center' }); } });
  }
  return out;
}

let paletteOpen = false, paletteSel = 0, paletteMatches = [];

/* A forgiving subsequence match, so "wdi" finds Who Did It? and "brek" still
   finds Neon Breaker. Scored so whole-word prefixes beat scattered letters. */
function paletteScore(entry, q){
  if(!q) return 1;
  const hay = (entry.label + ' ' + (entry.keywords || '')).toLowerCase();
  const label = entry.label.toLowerCase();
  if(label.startsWith(q)) return 1000;
  if(label.includes(q)) return 500;
  if(hay.includes(q)) return 200;
  // subsequence: every letter of the query in order somewhere in the label
  let i = 0, gaps = 0;
  for(const ch of label){
    if(ch === q[i]){ i++; if(i === q.length) break; }
    else if(i > 0) gaps++;
  }
  if(i === q.length) return 100 - Math.min(90, gaps);
  return 0;
}

function openPalette(){
  if(paletteOpen) return;
  paletteOpen = true;
  paletteSel = 0;
  document.getElementById('palette-modal').classList.remove('hidden');
  const input = document.getElementById('palette-input');
  input.value = '';
  renderPalette();
  input.focus();
  Sfx.play('select');
}

function closePalette(){
  paletteOpen = false;
  document.getElementById('palette-modal').classList.add('hidden');
}

function renderPalette(){
  const q = (document.getElementById('palette-input').value || '').trim().toLowerCase();
  paletteMatches = paletteEntries()
    .map(e => ({ e, s: paletteScore(e, q) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 9)
    .map(x => x.e);
  if(paletteSel >= paletteMatches.length) paletteSel = Math.max(0, paletteMatches.length - 1);

  const list = document.getElementById('palette-list');
  if(!paletteMatches.length){
    list.innerHTML = '<div class="palette-empty">Nothing matches that.</div>';
    return;
  }
  list.innerHTML = paletteMatches.map((m, i) => `
    <button class="palette-row ${i === paletteSel ? 'sel' : ''}" onclick="runPalette(${i})">
      <span class="palette-icon">${m.icon}</span>
      <span class="palette-label">${escapeHtml(m.label)}</span>
      <span class="palette-hint">${m.hint}</span>
    </button>`).join('');
}

function runPalette(i){
  const m = paletteMatches[i];
  if(!m) return;
  closePalette();
  try{ m.run(); }
  catch(e){ console.error('Palette action failed:', e); }
}

function palettePressed(e){
  if(e.key === 'Escape'){ closePalette(); return true; }
  if(e.key === 'ArrowDown'){ paletteSel = Math.min(paletteMatches.length - 1, paletteSel + 1); renderPalette(); return true; }
  if(e.key === 'ArrowUp'){ paletteSel = Math.max(0, paletteSel - 1); renderPalette(); return true; }
  if(e.key === 'Enter'){ runPalette(paletteSel); return true; }
  return false;
}

/* ---- shortcut sheet --------------------------------------------------- */
// Site-wide keys, plus whatever the cabinet you're looking at uses. The
// per-game lines are read from the same controls box the setup panel shows,
// so they can't drift away from what the game actually does.
const GLOBAL_KEYS = [
  ['Ctrl / ⌘ + K', 'Command palette — jump anywhere'],
  ['?',            'This sheet'],
  ['Esc',          'Pause a game, or close whatever is open'],
  ['C',            'Toggle the chat drawer'],
  ['G',            'Back to the arcade'],
  ['/',            'Search the cabinets']
];

// A key, not a word. The controls boxes also use <b> for emphasis inside
// ordinary prose ("unlock an ability"), so anything that isn't shaped like a
// key cap is skipped rather than listed as a shortcut.
const KEY_CAP = /^(?:[A-Z0-9](?:[A-Z0-9/+\- ]{0,9}[A-Z0-9])?|←|→|↑|↓)$/;
// Mouse actions are controls too, and they're written out in words.
const POINTER_WORD = /\b(click|mouse|drag|scroll|tap|hover|arrow|shift|ctrl|alt|space|enter|esc)\b/i;
// Key names that are real words, so an all-caps run of letters isn't
// automatically a key — the boxes also bold section labels like CONTROLS and
// PLAYER 1, which are not things you can press.
const KEY_WORD = /^(space|shift|enter|esc|escape|tab|ctrl|alt|arrows?|wasd|up|down|left|right)$/i;
const GLYPH_KEY = /^[←→↑↓↩⇧⌘]+$/;
function isControl(t){
  if(t.length > 20) return false;
  if(POINTER_WORD.test(t)) return true;
  if(!KEY_CAP.test(t)) return false;
  if(/\s/.test(t) && /\d/.test(t)) return false;   // "0 HP", "3 rounds" — not keys
  if(t.length <= 2 || /[/+\-]/.test(t)) return true;
  // Every part has to look like a key name, so "↩ ENTER" passes and "DNA"
  // and "CONTROLS" don't.
  return t.split(/\s+/).every(w => KEY_WORD.test(w) || w.length <= 2 || GLYPH_KEY.test(w));
}

// A few worlds are entered from a lobby and have no setup panel to read, so
// their controls are listed here instead of scraped.
const SCREEN_KEYS = {
  'kart-screen': [
    ['W', 'Accelerate'], ['S', 'Brake / reverse'], ['A / D', 'Steer'],
    ['SHIFT', 'Drift — hold through a corner for a mini-turbo'],
    ['SPACE', 'Use the item you are holding']
  ],
  'hub-screen': [
    ['W A S D', 'Walk'], ['Mouse / arrows', 'Look around'], ['SPACE', 'Jump'],
    ['ENTER', 'Say something to the room']
  ],
  'thirteen-screen': [
    ['W', 'Walk on'], ['A / D', 'Turn'],
    ['—', 'Look back down the corridor to hold it off']
  ]
};

function currentGameKeys(){
  if(SCREEN_KEYS[currentScreen]) return SCREEN_KEYS[currentScreen];
  const setup = document.querySelector(`#${currentScreen} .controls-box`);
  if(!setup) return [];
  const out = [];
  // Whatever follows a bold, up to the next bold or the end of the line.
  const runAfter = b => {
    let s = '', n = b.nextSibling;
    while(n && !(n.nodeType === 1 && (n.tagName === 'B' || n.tagName === 'BR'))){
      s += n.textContent || '';
      n = n.nextSibling;
    }
    return s;
  };

  setup.querySelectorAll('b').forEach(b => {
    const cap = b.textContent.trim();
    // The versus cabinets label each side's whole key set on one line, which
    // is exactly the row a two-player sheet wants — take the line as-is.
    if(b.classList.contains('p1c') || b.classList.contains('p2c')){
      // The whole line, nested bolds included — a player's key set is one
      // thing, and stopping at the first <b> cut it in half.
      let line = '', n = b.nextSibling;
      while(n && !(n.nodeType === 1 && n.tagName === 'BR')){
        line += n.textContent || '';
        n = n.nextSibling;
      }
      line = line.replace(/\s+/g, ' ').replace(/^[\s—–-]+/, '').trim();
      if(line) out.push([cap, line]);
      return;
    }
    if(!isControl(cap)) return;
    // A key bolded inside a player's line is already on that row.
    if(out.some(([k, d]) => (k === 'PLAYER 1' || k === 'PLAYER 2') && d.includes(cap))) return;
    // What it does is the run of text up to the next key or the end of the
    // clause — the boxes separate items with a middle dot and sentences with
    // a full stop, and everything past either belongs to something else.
    let desc = runAfter(b).split(/[·•]/)[0].split(/\.\s/)[0]
               .replace(/\s+/g, ' ').replace(/^[\s,;—-]+/, '').replace(/[.,;\s]+$/, '').trim();
    // A control written mid-sentence — "(or SPACE to putt)" — leaves the
    // closing bracket behind when the opening one stayed with the prose.
    if(desc.endsWith(')') && !desc.includes('(')) desc = desc.slice(0, -1).trim();
    // "A/D or ←/→ steer" leaves the first key holding nothing but the
    // conjunction; the second one carries the real description.
    if(/^(or|and|to|then|,)$/i.test(desc)) return;
    if(desc.length > 52) desc = desc.slice(0, 50).replace(/\s\S*$/, '') + '…';
    if(desc && !out.some(([k]) => k === cap)) out.push([cap, desc]);
  });
  return out.slice(0, 10);
}

function openShortcutSheet(){
  const gameKeys = currentGameKeys();
  const rows = ks => ks.map(([k, d]) =>
    `<div class="ks-row"><kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(d)}</span></div>`).join('');
  document.getElementById('shortcut-body').innerHTML = `
    <div class="ks-group-title">Anywhere</div>
    ${rows(GLOBAL_KEYS)}
    ${gameKeys.length ? `<div class="ks-group-title">This cabinet</div>${rows(gameKeys)}` : ''}`;
  document.getElementById('shortcut-modal').classList.remove('hidden');
  Sfx.play('click');
}
function closeShortcutSheet(){
  document.getElementById('shortcut-modal').classList.add('hidden');
}

/* ---- the one global key listener -------------------------------------- */
// Runs at capture so it beats the game key handler, but it only ever claims
// a key when nothing is being typed into — otherwise "k" in chat would open
// the palette.
document.addEventListener('keydown', e => {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                       t.tagName === 'SELECT' || t.isContentEditable);

  if(paletteOpen){
    // the palette's own input is the exception: it's meant to be typed into
    if(palettePressed(e)){ e.preventDefault(); e.stopPropagation(); }
    return;
  }

  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){
    e.preventDefault(); e.stopPropagation();
    openPalette();
    return;
  }
  if(typing) return;

  if(e.key === '?'){
    e.preventDefault();
    document.getElementById('shortcut-modal').classList.contains('hidden')
      ? openShortcutSheet() : closeShortcutSheet();
    return;
  }
  if(e.key === 'Escape' && !document.getElementById('shortcut-modal').classList.contains('hidden')){
    closeShortcutSheet();
    return;
  }
  // Single letters only where they can't be a game control: the dashboard and
  // the other menu screens.
  const inGame = currentScreen.endsWith('-screen') &&
                 document.getElementById(currentScreen) &&
                 document.getElementById(currentScreen).classList.contains('game-screen');
  if(inGame) return;
  if(e.key === 'g' && currentScreen !== 'dashboard-screen'){ backToDashboard(); return; }
  if(e.key === '/' && currentScreen === 'dashboard-screen'){
    const box = document.querySelector('.dash-search input');
    if(box){ e.preventDefault(); box.focus(); box.select(); }
  }
}, true);
