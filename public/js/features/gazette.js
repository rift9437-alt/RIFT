/* =========================================================
   THE LEVEL 7 GAZETTE + ARCHIVE
   =========================================================
   Two halves of the same screen. The Gazette's front page is written from
   whatever actually happened in the arcade — record gaps, the newest clan,
   who's been grinding. The Archive is the building's backstory, released a
   fragment at a time as you meet each condition; a sealed entry shows only
   the hint for what opens it, which makes the archive a list of things to
   go and try. */
let gazetteCache = null;
let loreCache = null;

async function loadGazette(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/gazette`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    gazetteCache = await res.json();
  }catch(e){
    console.error('Gazette load failed:', e);
  }
  return gazetteCache;
}

async function loadLore(){
  try{
    const res = await apiFetch(`${LB_API_BASE}/lore`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Bad response: ' + res.status);
    loreCache = await res.json();
  }catch(e){
    console.error('Lore load failed:', e);
  }
  return loreCache;
}

function issueDate(iso){
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

async function openGazette(){
  showScreen('gazette-screen');
  document.getElementById('gazette-front').innerHTML =
    '<div class="clan-empty">Setting the type…</div>';
  document.getElementById('gazette-archive').innerHTML = '';
  await Promise.all([loadGazette(), loadLore()]);
  renderGazette();
}

function renderGazette(){
  const front = document.getElementById('gazette-front');
  if(front){
    const stories = (gazetteCache && gazetteCache.stories) || [];
    front.innerHTML = `
      <div class="gaz-masthead">
        <div class="gaz-title">THE LEVEL 7 GAZETTE</div>
        <div class="gaz-rule"></div>
        <div class="gaz-dateline">
          <span>No. 7</span>
          <span>${issueDate(gazetteCache && gazetteCache.issued)}</span>
          <span>Price: one token</span>
        </div>
      </div>
      ${stories.length ? stories.map(s => `
        <article class="gaz-story gaz-${s.kind}">
          <h4>${s.headline}</h4>
          <p>${s.body}</p>
        </article>`).join('')
      : '<div class="clan-empty">Slow news day. Go and set a record.</div>'}`;
  }

  const arch = document.getElementById('gazette-archive');
  if(arch){
    const entries = (loreCache && loreCache.entries) || [];
    arch.innerHTML = `
      <div class="arch-head">
        THE ARCHIVE
        <span>${(loreCache && loreCache.unlocked) || 0} / ${(loreCache && loreCache.total) || entries.length} recovered</span>
      </div>
      ${entries.map((e, i) => e.unlocked ? `
        <div class="arch-entry">
          <div class="arch-num">${String(i + 1).padStart(2, '0')}</div>
          <div>
            <h5>${e.title}</h5>
            <p>${e.body}</p>
          </div>
        </div>` : `
        <div class="arch-entry arch-sealed">
          <div class="arch-num">${String(i + 1).padStart(2, '0')}</div>
          <div>
            <h5>SEALED</h5>
            <p>${e.hint || 'Keep playing.'}</p>
          </div>
        </div>`).join('')}`;
  }
}
