/* =========================================================
   SETTINGS (sound / scanlines / screen shake)
   ========================================================= */
const SETTINGS_KEY = 'level7_settings';
let settings = { sound: true, scanlines: true, shake: true };

function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(raw) settings = Object.assign(settings, JSON.parse(raw));
  }catch(e){ /* private mode / no storage — defaults are fine */ }
  applySettings();
}

function saveSettings(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){}
}

function applySettings(){
  document.body.classList.toggle('no-scanlines', !settings.scanlines);
  const sb = document.getElementById('sound-toggle-btn');
  if(sb){
    sb.textContent = settings.sound ? '🔊' : '🔇';
    sb.title = settings.sound ? 'Mute sound' : 'Unmute sound';
  }
  [['sound','setting-sound'],['scanlines','setting-scanlines'],['shake','setting-shake']].forEach(([key,id])=>{
    const el = document.getElementById(id);
    if(el) el.classList.toggle('on', !!settings[key]);
  });
}

function toggleSetting(key){
  settings[key] = !settings[key];
  saveSettings();
  applySettings();
  if(key === 'sound' && settings.sound) Sfx.play('select');
}

function toggleSound(){ toggleSetting('sound'); }
function openSettings(){ Sfx.play('click'); document.getElementById('settings-modal').classList.remove('hidden'); applySettings(); }
function closeSettings(){ Sfx.play('click'); document.getElementById('settings-modal').classList.add('hidden'); }

// One delegated listener gives every button in the arcade a click blip.
document.addEventListener('click', e=>{
  if(e.target.closest('.btn, .option-btn, .cabinet, .filter-chip, .shop-btn, .back-btn, .icon-btn')) Sfx.play('click');
}, true);

// A tiny shared helper so any game can rattle the canvas on a big hit.
function applyShake(ctx, mag){
  if(!settings.shake || !mag || mag <= 0) return;
  ctx.translate((Math.random()-0.5)*mag, (Math.random()-0.5)*mag);
}
