/* =========================================================
   SETTINGS — sound, presentation, accessibility
   =========================================================
   Everything here is per-device and lives in localStorage: none of it is
   worth a round trip, and it has to be applied before the first frame rather
   than after a fetch comes back. */
const SETTINGS_KEY = 'level7_settings';
let settings = {
  sound: true, scanlines: true, shake: true,
  // Volume is a number now rather than a second on/off — `sound` stays as the
  // master mute so the existing toggle button still means something.
  sfxVolume: 0.85,
  musicVolume: 0.5,
  // Accessibility. Each one is a body class the stylesheet reacts to, so
  // nothing else in the app has to know these exist.
  textScale: 1,        // 0.9 – 1.35
  reduceMotion: false, // stills the flicker, the marquee, the toast slide
  highContrast: false, // firmer borders and full-strength text everywhere
  bigHitboxes: false,  // larger click targets on small controls
  // Colour vision: swaps the three accent colours for a set that stays
  // distinguishable under the named deficiency. Themes still apply; this
  // overrides only the accents, which is what carries meaning.
  colourMode: 'off',   // off | deuter | prot | trit
  zen: false           // hide everything that isn't the game while playing
};

// Accent triples that stay separable for each kind of colour vision. Blue and
// orange survive red/green deficiency; for tritanopia the blue/yellow axis is
// the weak one, so it leans on red and cyan instead.
const COLOUR_MODES = {
  deuter: { cyan: '#4c9aff', pink: '#ff8a3d', gold: '#f2d24b', label: 'Deuteranopia' },
  prot:   { cyan: '#57a6ff', pink: '#ffab2e', gold: '#ffe066', label: 'Protanopia' },
  trit:   { cyan: '#2fd4c4', pink: '#ff5d6c', gold: '#d9b3ff', label: 'Tritanopia' }
};

function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(raw) settings = Object.assign(settings, JSON.parse(raw));
  }catch(e){ /* private mode / no storage — defaults are fine */ }
  // Someone who has asked their OS for less motion gets it here by default,
  // without having to find the toggle.
  try{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
       localStorage.getItem(SETTINGS_KEY) === null){
      settings.reduceMotion = true;
    }
  }catch(e){}
  applySettings();
}

function saveSettings(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){}
}

function applySettings(){
  document.body.classList.toggle('no-scanlines', !settings.scanlines);
  document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
  document.body.classList.toggle('high-contrast', !!settings.highContrast);
  document.body.classList.toggle('big-hitboxes', !!settings.bigHitboxes);
  document.documentElement.style.setProperty('--text-scale', settings.textScale);
  document.body.classList.toggle('zen', !!settings.zen);

  // Applied on top of whatever theme is equipped, and removed cleanly when
  // switched off so the theme's own accents come back.
  const cm = COLOUR_MODES[settings.colourMode];
  ['cyan', 'pink', 'gold'].forEach(k => {
    if(cm) document.documentElement.style.setProperty('--' + k, cm[k]);
    else document.documentElement.style.removeProperty('--' + k);
  });
  const sel = document.getElementById('setting-colour-mode');
  if(sel && sel.value !== settings.colourMode) sel.value = settings.colourMode;

  const sb = document.getElementById('sound-toggle-btn');
  if(sb){
    sb.textContent = settings.sound ? '🔊' : '🔇';
    sb.title = settings.sound ? 'Mute sound' : 'Unmute sound';
  }
  [['sound','setting-sound'],['scanlines','setting-scanlines'],['shake','setting-shake'],
   ['reduceMotion','setting-reduce-motion'],['highContrast','setting-high-contrast'],
   ['bigHitboxes','setting-big-hitboxes'],['zen','setting-zen']].forEach(([key,id])=>{
    const el = document.getElementById(id);
    if(el) el.classList.toggle('on', !!settings[key]);
  });
  [['sfxVolume','setting-sfx-vol','setting-sfx-vol-label'],
   ['musicVolume','setting-music-vol','setting-music-vol-label'],
   ['textScale','setting-text-scale','setting-text-scale-label']].forEach(([key,id,labelId])=>{
    const el = document.getElementById(id);
    if(el && el.value !== String(settings[key])) el.value = settings[key];
    const lab = document.getElementById(labelId);
    if(lab) lab.textContent = key === 'textScale'
      ? Math.round(settings[key] * 100) + '%'
      : Math.round(settings[key] * 100) + '%';
  });
  if(typeof Sfx !== 'undefined' && Sfx.setVolume) Sfx.setVolume(settings.sfxVolume);
  if(typeof setMusicVolume === 'function') setMusicVolume(settings.musicVolume);
}

function toggleSetting(key){
  settings[key] = !settings[key];
  saveSettings();
  applySettings();
  if(key === 'sound' && settings.sound) Sfx.play('select');
}

// Sliders. `live` is true while dragging — we apply but don't write to disk on
// every pixel of movement.
function setSetting(key, value, live){
  const n = Number(value);
  if(!Number.isFinite(n)) return;
  settings[key] = n;
  applySettings();
  if(!live) saveSettings();
}

// Applying a theme wipes the accent overrides, so re-assert them afterwards.
// Without this, equipping a theme silently cancels colour-vision mode.
function reapplyColourMode(){
  const cm = COLOUR_MODES[settings.colourMode];
  if(!cm) return;
  ['cyan', 'pink', 'gold'].forEach(k =>
    document.documentElement.style.setProperty('--' + k, cm[k]));
}

function setColourMode(mode){
  settings.colourMode = COLOUR_MODES[mode] ? mode : 'off';
  saveSettings();
  applySettings();
}

// Zen strips the page back to the cabinet: no topbar, no chat, no panels.
// Bound to Z, and Escape brings everything back — being unable to find your
// way out of a mode is worse than not having it.
function toggleZen(){
  settings.zen = !settings.zen;
  saveSettings();
  applySettings();
  if(typeof toast === 'function' && settings.zen){
    toast('Zen mode', 'Press Z or Escape to bring the arcade back', '🧘', 'cyan');
  }
}

function toggleSound(){ toggleSetting('sound'); }
function openSettings(){ Sfx.play('click'); document.getElementById('settings-modal').classList.remove('hidden'); applySettings(); }
function closeSettings(){ Sfx.play('click'); saveSettings(); document.getElementById('settings-modal').classList.add('hidden'); }

// One delegated listener gives every button in the arcade a click blip.
document.addEventListener('click', e=>{
  if(e.target.closest('.btn, .option-btn, .cabinet, .filter-chip, .shop-btn, .back-btn, .icon-btn')) Sfx.play('click');
}, true);

// A tiny shared helper so any game can rattle the canvas on a big hit.
function applyShake(ctx, mag){
  if(!settings.shake || settings.reduceMotion || !mag || mag <= 0) return;
  ctx.translate((Math.random()-0.5)*mag, (Math.random()-0.5)*mag);
}
