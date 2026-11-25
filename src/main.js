import './style.css';
import { supabase, isConfigured } from './supabase.js';

const $ = (id) => document.getElementById(id);
const screen = $('screen');
let currentUser = null;
let profile = null;
let ownerItems = [];
let editingId = null;

const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validUrl = (value) => {
  if (!value) return '';
  try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : ''; }
  catch { return ''; }
};
const money = (v) => v === '' || v == null ? 'Price not added' : '₹' + Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
const toast = (message) => {
  const el=$('toast'); el.textContent=message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2600);
};
const route = () => {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts.length >= 2 && parts[0] === 'w' ? {type:'public',username:decodeURIComponent(parts[1])} : {type:'owner'};
};
const go = (path) => { history.pushState({},'',path); renderRoute(); };
window.addEventListener('popstate',renderRoute);

function setupTheme() {
  if(localStorage.getItem('wishlink-dark')==='1') document.body.classList.add('dark');
  $('themeBtn').textContent=document.body.classList.contains('dark')?'☀':'☾';
}
$('themeBtn').addEventListener('click',()=>{
  document.body.classList.toggle('dark');
  const dark=document.body.classList.contains('dark');
  localStorage.setItem('wishlink-dark',dark?'1':'0');
  $('themeBtn').textContent=dark?'☀':'☾';
});

function renderSetup() {
  screen.innerHTML=`<section class="panel narrow"><p class="eyebrow">ONE QUICK SETUP</p><h1>Connect your WishLink</h1>
  <p class="muted">This upgraded version uses Supabase so your wishlist can be shared with friends and synced online.</p>
  <ol class="steps"><li>Create a free Supabase project.</li><li>Run the SQL in <b>supabase/schema.sql</b> using Supabase SQL Editor.</li><li>Copy <b>.env.example</b> to <b>.env</b> and add your project URL and publishable/anon key.</li><li>Restart the development server.</li></ol>
  <p class="notice">Never put your Supabase service-role key in this app. Use only the publishable/anon key.</p>
  <p>Setup instructions are in <b>README.md</b> inside the project ZIP.</p></section>`;
}

async function renderRoute() {
  if(!isConfigured) return renderSetup();
  const r=route();
  if(r.type==='public') return renderPublic(r.username);
  const {data:{session}}=await supabase.auth.getSession();
  currentUser=session?.user||null;
  if(!currentUser) return renderAuth();
  await loadOwner();
  renderDashboard();
}

async function ensureProfile(username) {
  const { data: existing, error: readError } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (readError) throw readError;

  // Reuse the existing profile instead of inserting it again.
  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: currentUser.id,
      username
    })
    .select('id, username')
    .single();

  if (error) {
    // Check whether another request created the profile meanwhile.
    const { data: retry, error: retryError } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (retryError) throw retryError;
    if (retry) return retry;

    throw error;
  }

  return data;
}

function renderAuth() {
  screen.innerHTML=`<section class="panel narrow auth"><p class="eyebrow">YOUR LITTLE SHOPPING SPACE</p><h1>Welcome to <span>WishLink</span> ♡</h1>
  <p class="muted">Create your wishlist and share it with people you love.</p>
  <div class="tabs"><button class="tab active" id="loginTab">Log in</button><button class="tab" id="signupTab">Create account</button></div>
  <form id="authForm"><label>Email</label><input id="email" type="email" required autocomplete="email" placeholder="you@example.com">
  <label>Password</label><input id="password" type="password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters">
  <div id="usernameWrap" class="hidden"><label>WishLink username</label><input id="username" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" placeholder="e.g. akshita"></div>
  <button class="primary full" id="authSubmit">Log in</button></form><p class="tiny muted" id="authHint">New here? Create an account to get your own shareable WishLink.</p></section>`;
  let mode='login';
  const setMode=(m)=>{
    mode=m; $('loginTab').classList.toggle('active',m==='login'); $('signupTab').classList.toggle('active',m==='signup');
    $('usernameWrap').classList.toggle('hidden',m==='login'); $('username').required=m==='signup';
    $('authSubmit').textContent=m==='login'?'Log in':'Create my WishLink';
    $('authHint').textContent=m==='login'?'New here? Create an account to get your own shareable WishLink.':'After signing up, check your email if confirmation is enabled.';
  };
  $('loginTab').onclick=()=>setMode('login'); $('signupTab').onclick=()=>setMode('signup');
  $('authForm').onsubmit=async(e)=>{
    e.preventDefault(); const email=$('email').value.trim(),password=$('password').value;
    $('authSubmit').disabled=true;
    try {
      if(mode==='login'){
        const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) throw error;
        toast('Welcome back!'); await renderRoute();
      } else {
        const username=$('username').value.trim().toLowerCase();
        if(!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Username must be 3–24 letters, numbers or underscores.');
        const {data,error}=await supabase.auth.signUp({email,password});
        if(error) throw error;
        if (data.user && data.session) {
  currentUser = data.user;

  await ensureProfile(username);

  toast('Your WishLink account is ready!');
  await renderRoute();
        } else {
          toast('Check your email to confirm, then log in. Create your username after confirmation.');
          setMode('login');
        }
      }
    } catch(err){toast(err.message||'Something went wrong.');}
    finally {
  const button = $('authSubmit');
  if (button) button.disabled = false;
}
  };
}

async function loadOwner() {
  const [{data:prof,error:pErr},{data:rows,error:wErr},{data:reservations,error:rErr}]=await Promise.all([
    supabase.from('profiles').select('id,username').eq('id',currentUser.id).maybeSingle(),
    supabase.from('wishes').select('*').eq('owner_id',currentUser.id).order('created_at',{ascending:false}),
    supabase.rpc('get_my_reservations')
  ]);
  if(pErr) throw pErr; if(wErr) throw wErr; if(rErr) throw rErr;
  profile=prof;
  const reservationMap=new Map((reservations||[]).map(r=>[r.wish_id,r]));
  ownerItems=(rows||[]).map(w=>({...w,reservation:reservationMap.get(w.id)||null,reserved:reservationMap.has(w.id)}));
}
function renderDashboard() {
  if(!profile){
    screen.innerHTML=`<section class="panel narrow"><p class="eyebrow">ONE LAST STEP</p><h2>Choose your WishLink username</h2><p class="muted">Your account is ready. Pick a public username for your shareable link.</p><form id="profileForm"><label>Username</label><input id="newUsername" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" placeholder="e.g. akshita"><button class="primary full">Create my WishLink</button></form><button class="text-btn" id="logoutBtn">Log out</button></section>`;
    $('profileForm').onsubmit = async (e) => {
  e.preventDefault();

  const username = $('newUsername').value.trim().toLowerCase();

  try {
    await ensureProfile(username);
    await loadOwner();
    renderDashboard();
  } catch (err) {
    toast(err.message || 'Could not create username.');
  }
};
    $('logoutBtn').onclick=()=>supabase.auth.signOut().then(renderRoute); return;
  }
  const pending=ownerItems.filter(x=>!x.delivered).length,done=ownerItems.length-pending;
  const shareUrl=`${location.origin}/w/${encodeURIComponent(profile.username)}`;
  screen.innerHTML=`<section class="hero"><div><p class="eyebrow">YOUR PERSONAL GIFT LIST</p><h1>Make a wish.<br>Share a little joy.</h1><p>Save the things you love. Let friends surprise you.</p></div><div class="hero-heart">♡</div></section>
  <section class="share panel"><div><p class="eyebrow">YOUR SHAREABLE WISHLINK</p><h2>${esc(profile.username)}</h2><p class="muted">Anyone with this link can view your public wishlist.</p></div><div class="share-actions"><button id="copyLink" class="primary">Copy WishLink ↗</button><button id="shareLink" class="secondary">Share</button></div><code>${esc(shareUrl)}</code></section>
  <section class="stats"><article><b>${ownerItems.length}</b><small>Total wishes</small></article><article><b>${pending}</b><small>Not delivered</small></article><article><b>${done}</b><small>Delivered</small></article></section>
  <section class="panel"><div class="section-title"><div><p class="eyebrow">ADD SOMETHING LOVELY</p><h2 id="formTitle">My wishlist</h2></div><span class="plus">＋</span></div>
  <form id="wishForm"><label>Product name *</label><input id="name" required maxlength="90" placeholder="e.g. Wireless headphones">
  <div class="two"><div><label>Price (₹)</label><input id="price" type="number" min="0" step=".01" placeholder="Optional"></div><div><label>Category</label><select id="category"><option>Everything</option><option>Tech</option><option>Fashion</option><option>Beauty</option><option>Books</option><option>Home</option><option>Other</option></select></div></div>
  <label>Product link</label><input id="link" type="url" placeholder="https://...">
  <label>Image URL (optional)</label><input id="image" type="url" placeholder="https://...">
  <label>Notes (optional)</label><textarea id="notes" rows="2" maxlength="240" placeholder="Colour, size, or why you want it"></textarea>
  <div class="form-actions"><button type="button" id="cancelEdit" class="secondary hidden">Cancel</button><button class="primary" id="saveWish">＋ Add wish</button></div></form></section>
  <section class="panel"><div class="section-title"><div><p class="eyebrow">YOUR COLLECTION</p><h2>All wishes</h2></div></div><div id="ownerList" class="wish-grid">${ownerItems.map(ownerCard).join('')||'<p class="muted">Your wishlist is empty. Add your first wish above.</p>'}</div></section>
  <div class="logout-row"><span class="tiny muted">Signed in as ${esc(currentUser.email)}</span><button id="logoutBtn" class="text-btn">Log out</button></div>`;
  $('copyLink').onclick=async()=>{await navigator.clipboard.writeText(shareUrl);toast('WishLink copied!');};
  $('shareLink').onclick=async()=>{
    if(navigator.share){try{await navigator.share({title:'My WishLink',text:'Here are a few things I would love!',url:shareUrl});}catch{}}
    else {await navigator.clipboard.writeText(shareUrl);toast('WishLink copied!');}
  };
  $('logoutBtn').onclick=async()=>{await supabase.auth.signOut();currentUser=null;go('/');};
  $('wishForm').onsubmit=saveWish;
  $('cancelEdit').onclick=()=>{editingId=null;$('wishForm').reset();$('formTitle').textContent='My wishlist';$('saveWish').textContent='＋ Add wish';$('cancelEdit').classList.add('hidden');};
  $('ownerList').onclick=ownerAction;
}
function ownerCard(w) {
  return `<article class="wish-card"><div class="wish-card-main">${w.image_url?`<img src="${esc(w.image_url)}" alt="" onerror="this.style.display='none'">`:'<div class="image-placeholder">♡</div>'}<div class="wish-info"><span class="pill">${esc(w.category)}</span><h3>${esc(w.name)}</h3><b>${esc(money(w.price))}</b>${w.notes?`<p class="muted">${esc(w.notes)}</p>`:''}${w.delivered?'<span class="delivered-label">✓ Delivered</span>':w.reserved?`<span class="reserved-label">🎁 Reserved</span><p class="reservation-detail">${w.reservation?.reveal_name?`From ${esc(w.reservation.gifter_name||'A friend')}`:'Gifter chose to stay anonymous'}${w.reservation?.message?`<br>“${esc(w.reservation.message)}”`:''}</p>`:'<span class="available-label">♡ Available</span>'}</div></div><div class="card-tools"><button data-do="edit" data-id="${w.id}">Edit</button><button data-do="delete" data-id="${w.id}">Delete</button>${w.reserved&&!w.delivered?`<button class="confirm" data-do="deliver" data-id="${w.id}">Confirm delivered</button>`:''}${w.delivered?`<button data-do="undeliver" data-id="${w.id}">Move back</button>`:''}</div></article>`;
}
async function saveWish(e) {
  e.preventDefault();
  const data={owner_id:currentUser.id,name:$('name').value.trim(),price:$('price').value===''?null:Number($('price').value),category:$('category').value,product_url:$('link').value.trim()||null,image_url:$('image').value.trim()||null,notes:$('notes').value.trim()||null};
  if(data.product_url&&!validUrl(data.product_url))return toast('Enter a valid http or https product link.');
  if(data.image_url&&!validUrl(data.image_url))return toast('Enter a valid http or https image URL.');
  try {
    const result=editingId?await supabase.from('wishes').update(data).eq('id',editingId).eq('owner_id',currentUser.id):await supabase.from('wishes').insert(data);
    if(result.error)throw result.error;
    editingId=null;await loadOwner();renderDashboard();toast('Wishlist saved ♡');
  } catch(err){toast(err.message||'Could not save this wish.');}
}
async function ownerAction(e) {
  const b=e.target.closest('button[data-do]');if(!b)return;
  const w=ownerItems.find(x=>x.id===b.dataset.id);if(!w)return;
  try {
    if(b.dataset.do==='edit'){
      editingId=w.id;$('name').value=w.name;$('price').value=w.price??'';$('category').value=w.category;$('link').value=w.product_url||'';$('image').value=w.image_url||'';$('notes').value=w.notes||'';
      $('formTitle').textContent='Edit your wish';$('saveWish').textContent='Save changes';$('cancelEdit').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});return;
    }
    if(b.dataset.do==='delete'){
      if(!confirm(`Delete "${w.name}"? Any active reservation will also be removed.`))return;
      const {error}=await supabase.from('wishes').delete().eq('id',w.id);if(error)throw error;
    }
    if(b.dataset.do==='deliver'){
      if(!confirm('Confirm that this product has arrived?'))return;
      const {error}=await supabase.from('wishes').update({delivered:true}).eq('id',w.id);if(error)throw error;
    }
    if(b.dataset.do==='undeliver'){
      const {error}=await supabase.rpc('release_my_reservation',{p_wish_id:w.id});if(error)throw error;
      const {error:updateError}=await supabase.from('wishes').update({delivered:false}).eq('id',w.id);if(updateError)throw updateError;
    }
    await loadOwner();renderDashboard();toast('Wishlist updated.');
  }catch(err){toast(err.message||'Action failed.');}
}

async function renderPublic(username) {
  screen.innerHTML='<div class="loading">Loading this WishLink…</div>';
  try {
    const {data,error}=await supabase.rpc('get_public_wishlist',{p_username:username});
    if(error)throw error;
    if(!data||data.length===0){
      // A valid profile with no wishes is represented by an empty result too; call profile lookup RPC.
      const {data:owner,error:ownerError}=await supabase.rpc('get_public_profile',{p_username:username});
      if(ownerError)throw ownerError;
      if(!owner||owner.length===0)throw new Error('This WishLink does not exist.');
      return publicMarkup(username,[]);
    }
    publicMarkup(username,data);
  }catch(err){screen.innerHTML=`<section class="panel narrow"><div class="hero-heart">♡</div><h1>WishLink not found</h1><p class="muted">${esc(err.message)}</p><a class="primary inline" href="/">Open WishLink</a></section>`;}
}
function publicMarkup(username,rows) {
  const cards=rows.map(w=>`<article class="public-card">${w.image_url?`<img class="public-image" src="${esc(w.image_url)}" alt="" onerror="this.style.display='none'">`:'<div class="public-placeholder">♡</div>'}<div class="public-info"><span class="pill">${esc(w.category)}</span><h3>${esc(w.name)}</h3><b>${esc(money(w.price))}</b>${w.notes?`<p class="muted">${esc(w.notes)}</p>`:''}
  ${w.delivered?'<span class="delivered-label">✓ Already received</span>':w.reserved?'<span class="reserved-label">🎁 Someone is gifting this</span>':`<button class="primary full reserve-btn" data-id="${w.id}">I want to gift this 🎁</button>`}
  ${w.product_url?`<a class="product-link" href="${esc(w.product_url)}" target="_blank" rel="noopener noreferrer">View product ↗</a>`:''}</div></article>`).join('');
  screen.innerHTML=`<section class="public-hero"><p class="eyebrow">A LITTLE SOMETHING I'M WISHING FOR</p><h1>${esc(username)}'s WishLink ♡</h1><p>Pick a wish and make someone's day.</p></section><section class="public-grid">${cards||'<p class="muted">This wishlist is waiting for its first wish.</p>'}</section><p class="public-note">You can reserve a gift here, then purchase it from the retailer. WishLink does not process payments.</p>`;
  screen.querySelectorAll('.reserve-btn').forEach(btn=>btn.onclick=()=>reserve(btn.dataset.id));
}
async function reserve(wishId) {
  const name=prompt('What name should we show? Leave blank to stay anonymous.');
  if(name===null)return;
  const message=prompt('Add a short gift message? (Optional)')||'';
  const reveal=confirm('Would you like the wishlist owner to see your name?\\n\\nOK = show my name\\nCancel = keep me anonymous');
  const {error}=await supabase.rpc('reserve_wish',{p_wish_id:wishId,p_gifter_name:reveal?(name.trim()||'A friend'):null,p_message:message.trim().slice(0,180),p_reveal_name:reveal});
  if(error){toast(error.message.includes('already')?'Someone has already reserved this wish.':'Could not reserve this gift: '+error.message);return;}
  toast('Your gift reservation is saved. Thank you! 🎁');
  const username=route().username;await renderPublic(username);
}

setupTheme();
if(isConfigured) supabase.auth.onAuthStateChange(()=>{if(route().type==='owner')renderRoute();});
renderRoute();
