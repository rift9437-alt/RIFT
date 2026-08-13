/* =========================================================
   SFX — tiny procedural sound engine (no audio files)
   =========================================================
   Every sound is synthesised on the fly with WebAudio, so the page stays a
   single self-contained file. Sfx.play(name) is safe to call anywhere: if the
   browser blocks audio or the user muted it, it quietly does nothing. */
const Sfx = (function(){
  let audio = null;
  let master = null;

  const RECIPES = {
    click:   { osc:'square',   f0:520, f1:640,  dur:0.05, vol:0.07 },
    select:  { osc:'square',   f0:420, f1:840,  dur:0.09, vol:0.09 },
    shoot:   { osc:'sawtooth', f0:820, f1:170,  dur:0.10, vol:0.10 },
    laser:   { osc:'square',   f0:1200,f1:320,  dur:0.09, vol:0.08 },
    hit:     { osc:'square',   f0:260, f1:90,   dur:0.11, vol:0.12 },
    thud:    { osc:'sine',     f0:190, f1:55,   dur:0.17, vol:0.16 },
    coin:    { osc:'triangle', f0:880, f1:1340, dur:0.11, vol:0.10 },
    perfect: { osc:'triangle', f0:700, f1:1760, dur:0.20, vol:0.11 },
    alarm:   { osc:'square',   f0:300, f1:190,  dur:0.26, vol:0.09 },
    explode: { noise:true,     f0:900, f1:60,   dur:0.36, vol:0.16 },
    whoosh:  { noise:true,     f0:300, f1:1800, dur:0.20, vol:0.07 },
    win:     { chord:[523,659,784,1046], step:0.09, dur:0.34, vol:0.09 },
    lose:    { chord:[392,330,262,196],  step:0.11, dur:0.34, vol:0.09 }
  };

  function ctxOrNull(){
    if(audio) {
      if(audio.state === 'suspended') audio.resume().catch(()=>{});
      return audio;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    try{
      audio = new AC();
      master = audio.createGain();
      master.gain.value = (typeof settings !== 'undefined' && typeof settings.sfxVolume === 'number')
        ? settings.sfxVolume : 0.85;
      master.connect(audio.destination);
    }catch(e){ audio = null; }
    return audio;
  }

  let noiseBuffer = null;
  function getNoise(ac){
    if(noiseBuffer) return noiseBuffer;
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i] = Math.random()*2 - 1;
    return noiseBuffer;
  }

  function tone(ac, at, type, f0, f1, dur, vol){
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  function noise(ac, at, f0, f1, dur, vol){
    const src = ac.createBufferSource();
    src.buffer = getNoise(ac);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(f0, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), at + dur);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  function play(name, pitchMult){
    if(!settings.sound) return;
    const r = RECIPES[name];
    if(!r) return;
    const ac = ctxOrNull();
    if(!ac) return;
    const now = ac.currentTime + 0.001;
    const m = pitchMult || 1;
    try{
      if(r.chord){
        r.chord.forEach((f,i)=> tone(ac, now + i*r.step, 'triangle', f*m, f*m, r.dur, r.vol));
      } else if(r.noise){
        noise(ac, now, r.f0*m, r.f1*m, r.dur, r.vol);
      } else {
        tone(ac, now, r.osc, r.f0*m, r.f1*m, r.dur, r.vol);
      }
    }catch(e){ /* audio is a nice-to-have, never break the game for it */ }
  }

  // Settings owns the number; this just applies it. Ramped rather than set so
  // dragging the slider doesn't click through the speakers.
  function setVolume(v){
    if(!master || !audio) return;
    const clamped = Math.max(0, Math.min(1, Number(v)));
    if(!Number.isFinite(clamped)) return;
    try{ master.gain.setTargetAtTime(clamped, audio.currentTime, 0.02); }
    catch(e){ master.gain.value = clamped; }
  }

  return { play, setVolume };
})();
