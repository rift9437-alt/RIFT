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
  bigHitboxes: false   // larger click targets on small controls
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

  const sb = document.getElementById('sound-toggle-btn');
  if(sb){
    sb.textContent = settings.sound ? '🔊' : '🔇';
    sb.title = settings.sound ? 'Mute sound' : 'Unmute sound';
  }
  [['sound','setting-sound'],['scanlines','setting-scanlines'],['shake','setting-shake'],
   ['reduceMotion','setting-reduce-motion'],['highContrast','setting-high-contrast'],
   ['bigHitboxes','setting-big-hitboxes']].forEach(([key,id])=>{
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
