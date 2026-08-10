/* =========================================================
   GIFTING — send any shop item to a friend using your tokens.
   ========================================================= */
let giftTargetItemId = null;

function openGiftModal(itemId, itemName){
  giftTargetItemId = itemId;
  document.getElementById('gift-modal-item-label').textContent = `Send "${itemName}" to a friend. It'll be deducted from your tokens.`;
  document.getElementById('gift-modal-error').textContent = '';
  document.getElementById('gift-modal-success').textContent = '';
  const select = document.getElementById('gift-friend-select');
  const friends = wallet.friends || [];
  select.innerHTML = friends.length
    ? friends.map(f => `<option value="${f}">${f}</option>`).join('')
    : `<option value="">No friends added yet</option>`;
  document.getElementById('gift-modal').classList.remove('hidden');
}

function closeGiftModal(){
  document.getElementById('gift-modal').classList.add('hidden');
  giftTargetItemId = null;
}

async function confirmSendGift(){
  const err = document.getElementById('gift-modal-error');
  const ok = document.getElementById('gift-modal-success');
  err.textContent = ''; ok.textContent = '';
  const friend = document.getElementById('gift-friend-select').value;
  if(!friend){ err.textContent = 'Add a friend first (Community screen).'; return; }
  if(!giftTargetItemId) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/shop/gift`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, friend, itemId: giftTargetItemId})
    });
    const data = await res.json();
    if(!res.ok){
      err.textContent = data.error || 'Gift failed.';
      return;
    }
    wallet = data;
    updateTokenDisplay();
    ok.textContent = `Sent to ${friend}!`;
    renderShop();
    setTimeout(closeGiftModal, 1200);
  }catch(e){
    console.error('Gift failed:', e);
    err.textContent = 'Could not reach the server — try again.';
  }
}

function showGiftToast(gift){
  const stack = document.getElementById('gift-toast-stack');
  if(!stack) return;
  const toast = document.createElement('div');
  toast.className = 'shop-card';
  toast.style.cssText = 'padding:12px 14px; font-family:var(--font-mono); font-size:12px; box-shadow:0 10px 30px rgba(0,0,0,0.5); animation:flicker .01s;';
  toast.textContent = `🎁 ${gift.from} sent you ${gift.itemName}`;
  stack.appendChild(toast);
  setTimeout(() => { toast.style.transition = 'opacity .4s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 5000);
}

async function checkPendingGifts(){
  if(!currentUser) return;
  try{
    const res = await apiFetch(`${LB_API_BASE}/wallet?user=${encodeURIComponent(currentUser)}`);
    if(!res.ok) return;
    const data = await res.json();
    if(Array.isArray(data.pendingGifts) && data.pendingGifts.length){
      data.pendingGifts.forEach(showGiftToast);
      wallet = data;
      updateTokenDisplay();
      await apiFetch(`${LB_API_BASE}/shop/gifts/ack`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({user: currentUser})
      });
    }
  }catch(e){ /* non-critical, ignore */ }
}

async function handleEquip(itemId){
  const msg = document.getElementById('shop-message');
  msg.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/wallet/equip`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, itemId})
    });
    const data = await res.json();
    if(!res.ok){
      msg.textContent = data.error || 'Could not equip that.';
      return;
    }
    wallet = data;
    applyTheme(wallet.equipped);
    updateTokenDisplay();
    renderShop();
  }catch(e){
    console.error('Equip failed:', e);
    msg.textContent = 'Could not reach the server — try again.';
  }
}

async function handleToggleCompanion(companion){
  const msg = document.getElementById('shop-message');
  msg.textContent = '';
  try{
    const res = await apiFetch(`${LB_API_BASE}/wallet/companion`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({user: currentUser, companion})
    });
    const data = await res.json();
    if(!res.ok){
      msg.textContent = data.error || 'Could not update that.';
      return;
    }
    wallet = data;
    renderShop();
  }catch(e){
    console.error('Companion toggle failed:', e);
    msg.textContent = 'Could not reach the server — try again.';
  }
}
