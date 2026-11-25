import './style.css';
import { supabase, isConfigured } from './supabase.js';

const $ = (id) => document.getElementById(id);
const screen = $('screen');

const APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '');
const ANDROID_APK_URL = ''; // Add your APK URL here when ready.
const IMAGE_BUCKET = 'wish-images';

let currentUser = null;
let profile = null;
let ownerItems = [];
let reservations = [];
let transactions = [];
let budgets = [];
let editingId = null;
let activePage = 'dashboard';
let selectedMonth = new Date().toISOString().slice(0, 7);

const categories = ['Everything', 'Tech', 'Fashion', 'Beauty', 'Books', 'Home', 'Health', 'Food', 'Travel', 'Other'];
const expenseCategories = ['Shopping', 'Food', 'Travel', 'Education', 'Bills', 'Entertainment', 'Health', 'Other'];

const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const money = (v) => '₹' + Number(v || 0).toLocaleString('en-IN', {
  maximumFractionDigits: 2
});

const today = () => new Date().toISOString().slice(0, 10);
const monthDate = (month) => `${month}-01`;

const validUrl = (value) => {
  if (!value) return '';
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
};

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function route() {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts.length >= 2 && parts[0] === 'w'
    ? { type: 'public', username: decodeURIComponent(parts[1]) }
    : { type: 'owner' };
}

function go(path) {
  history.pushState({}, '', path);
  renderRoute();
}

window.addEventListener('popstate', renderRoute);

function setupTheme() {
  if (localStorage.getItem('wishlink-dark') === '1') {
    document.body.classList.add('dark');
  }
  updateThemeButton();
}

function updateThemeButton() {
  const button = $('themeBtn');
  if (button) button.textContent = document.body.classList.contains('dark') ? '☀' : '☾';
}

$('themeBtn')?.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('wishlink-dark', document.body.classList.contains('dark') ? '1' : '0');
  updateThemeButton();
});

function renderSetup() {
  screen.innerHTML = `
    <section class="panel narrow">
      <p class="eyebrow">SETUP REQUIRED</p>
      <h1>Connect your WishLink</h1>
      <p class="muted">Add your Supabase project URL and publishable key to your .env file.</p>
      <p>Never put your Supabase service-role key in frontend code.</p>
    </section>`;
}

async function renderRoute() {
  if (!isConfigured) return renderSetup();

  const r = route();
  if (r.type === 'public') return renderPublic(r.username);

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) return toast(error.message);

  currentUser = session?.user || null;

  if (!currentUser) return renderAuth();

  try {
    await loadOwner();
    if (!profile) return renderProfileSetup();
    renderApp();
  } catch (err) {
    screen.innerHTML = `<section class="panel"><h2>Could not load WishLink</h2><p class="muted">${esc(err.message)}</p><button class="primary" id="retryLoad">Try again</button></section>`;
    $('retryLoad')?.addEventListener('click', renderRoute);
  }
}

async function ensureProfile(username) {
  const { data: existing, error: readError } = await supabase
    .from('profiles').select('id,username').eq('id', currentUser.id).maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: currentUser.id, username })
    .select('id,username')
    .single();

  if (error) {
    const { data: retry, error: retryError } = await supabase
      .from('profiles').select('id,username').eq('id', currentUser.id).maybeSingle();
    if (retryError) throw retryError;
    if (retry) return retry;
    throw error;
  }
  return data;
}

function renderAuth() {
  screen.innerHTML = `
    <section class="auth-layout">
      <div class="auth-intro">
        <p class="eyebrow">YOUR PERSONAL WISHLIST AND EXPENSE SPACE</p>
        <h1>Everything you want, organised in one place.</h1>
        <p class="muted">Save products, share your wishlist and keep track of your spending.</p>
      </div>
      <section class="panel auth-card">
        <div class="brand-mark">W</div>
        <h2>Welcome to WishLink</h2>
        <p class="muted">Sign in or create your account.</p>
        <div class="tabs">
          <button class="tab active" id="loginTab" type="button">Log in</button>
          <button class="tab" id="signupTab" type="button">Create account</button>
        </div>
        <form id="authForm">
          <label>Email address</label>
          <input id="email" type="email" required autocomplete="email" placeholder="you@example.com">
          <label>Password</label>
          <input id="password" type="password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters">
          <div id="usernameWrap" class="hidden">
            <label>Choose a username</label>
            <input id="username" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" placeholder="e.g. akshita">
          </div>
          <button class="primary full" id="authSubmit">Log in</button>
        </form>
        <p class="tiny muted" id="authHint">New to WishLink? Create an account to get started.</p>
      </section>
    </section>`;

  let mode = 'login';

  const setMode = (next) => {
    mode = next;
    $('loginTab').classList.toggle('active', next === 'login');
    $('signupTab').classList.toggle('active', next === 'signup');
    $('usernameWrap').classList.toggle('hidden', next === 'login');
    $('username').required = next === 'signup';
    $('authSubmit').textContent = next === 'login' ? 'Log in' : 'Create my account';
    $('authHint').textContent = next === 'login'
      ? 'New to WishLink? Create an account to get started.'
      : 'If email confirmation is enabled, check your inbox before logging in.';
  };

  $('loginTab').onclick = () => setMode('login');
  $('signupTab').onclick = () => setMode('signup');

  $('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const button = $('authSubmit');
    button.disabled = true;

    try {
      const email = $('email').value.trim();
      const password = $('password').value;

      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await renderRoute();
      } else {
        const username = $('username').value.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(username)) {
          throw new Error('Username must contain 3–24 lowercase letters, numbers or underscores.');
        }

        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.user && data.session) {
          currentUser = data.user;
          await ensureProfile(username);
          toast('Your account is ready.');
          await renderRoute();
        } else {
          toast('Check your email to confirm your account, then log in.');
          setMode('login');
        }
      }
    } catch (err) {
      toast(err.message || 'Something went wrong.');
    } finally {
      if ($('authSubmit')) $('authSubmit').disabled = false;
    }
  };
}

function renderProfileSetup() {
  screen.innerHTML = `
    <section class="panel narrow">
      <p class="eyebrow">ONE LAST STEP</p>
      <h2>Create your public WishLink username</h2>
      <p class="muted">This username will be part of the link you share with friends.</p>
      <form id="profileForm">
        <label>Username</label>
        <input id="newUsername" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" placeholder="e.g. akshita">
        <button class="primary full">Create my WishLink</button>
      </form>
      <button class="text-btn" id="profileLogout">Log out</button>
    </section>`;

  $('profileForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const username = $('newUsername').value.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Use 3–24 letters, numbers or underscores.');
      await ensureProfile(username);
      await renderRoute();
    } catch (err) {
      toast(err.message);
    }
  };

  $('profileLogout').onclick = logout;
}

async function loadOwner() {
  const [p, w, r, t, b] = await Promise.all([
    supabase.from('profiles').select('id,username').eq('id', currentUser.id).maybeSingle(),
    supabase.from('wishes').select('*').eq('owner_id', currentUser.id).order('created_at', { ascending: false }),
    supabase.rpc('get_my_reservations'),
    supabase.from('shopping_transactions').select('*').eq('owner_id', currentUser.id).order('occurred_on', { ascending: false }),
    supabase.from('shopping_budgets').select('*').eq('owner_id', currentUser.id).order('budget_month', { ascending: false })
  ]);

  if (p.error) throw p.error;
  if (w.error) throw w.error;
  if (r.error) throw r.error;
  if (t.error) throw t.error;
  if (b.error) throw b.error;

  profile = p.data;
  reservations = r.data || [];
  transactions = t.data || [];
  budgets = b.data || [];

  const reservationMap = new Map(reservations.map(item => [item.wish_id, item]));
  ownerItems = (w.data || []).map(item => ({
    ...item,
    reservation: reservationMap.get(item.id) || null,
    reserved: reservationMap.has(item.id)
  }));
}

function monthTransactions(month = selectedMonth) {
  return transactions.filter(t => String(t.occurred_on).slice(0, 7) === month);
}

function spendingForMonth(month = selectedMonth) {
  return monthTransactions(month)
    .filter(t => t.transaction_type === 'purchase' || t.transaction_type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
}

function giftsForMonth(month = selectedMonth) {
  return monthTransactions(month)
    .filter(t => t.transaction_type === 'gift')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
}

function budgetForMonth(month = selectedMonth) {
  return budgets.find(b => String(b.budget_month).slice(0, 7) === month);
}

function monthLabel(month) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric'
  });
}

function navItem(page, label, icon) {
  return `<button class="nav-item ${activePage === page ? 'active' : ''}" data-page="${page}">
    <span class="nav-icon">${icon}</span><span>${label}</span>
  </button>`;
}

function renderApp() {
  const shareUrl = `${APP_URL}/w/${encodeURIComponent(profile.username)}`;

  screen.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand"><span class="brand-mark">W</span><span>WishLink</span></div>
        <div class="sidebar-user">
          <div class="avatar">${esc(profile.username.slice(0, 1).toUpperCase())}</div>
          <div><b>${esc(profile.username)}</b><small>Personal space</small></div>
        </div>
        <nav class="side-nav">
          ${navItem('dashboard', 'Overview', '▦')}
          ${navItem('wishlist', 'My wishlist', '♡')}
          ${navItem('purchases', 'Purchases', '✓')}
          ${navItem('gifts', 'Gift history', '◇')}
          ${navItem('expenses', 'Expense tracker', '↗')}
          ${navItem('budget', 'Monthly budget', '₹')}
        </nav>
        <div class="sidebar-bottom">
          <a class="nav-item" href="${esc(shareUrl)}" target="_blank" rel="noopener">↗ <span>Public WishLink</span></a>
          <a class="nav-item" href="${ANDROID_APK_URL || '#'}" ${ANDROID_APK_URL ? 'download' : 'data-apk-placeholder'}>↓ <span>Download Android app</span></a>
          <button class="nav-item" id="themeToggle">◐ <span>Change appearance</span></button>
          <button class="nav-item" id="logoutButton">⇥ <span>Log out</span></button>
        </div>
      </aside>

      <div class="app-main">
        <header class="app-topbar">
          <button class="icon-button mobile-menu" id="menuToggle" aria-label="Open menu">☰</button>
          <div><span class="topbar-title">Your space</span><small>Organise the things that matter to you.</small></div>
          <div class="topbar-actions">
            <button class="secondary small-button" id="copyShare">Copy WishLink</button>
            <button class="primary small-button" data-page="wishlist">＋ Add item</button>
          </div>
        </header>

        <main class="app-content" id="pageContent"></main>
      </div>

      <nav class="bottom-nav">
        ${navItem('dashboard', 'Home', '⌂')}
        ${navItem('wishlist', 'Wishes', '♡')}
        ${navItem('expenses', 'Expenses', '₹')}
        ${navItem('gifts', 'Gifts', '◇')}
        ${navItem('budget', 'Budget', '▤')}
      </nav>
    </div>`;

  $('copyShare').onclick = () => copyText(shareUrl, 'WishLink copied.');
  $('logoutButton').onclick = logout;
  $('themeToggle').onclick = toggleTheme;
  $('menuToggle').onclick = () => $('sidebar').classList.toggle('open');

  screen.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => {
      activePage = button.dataset.page;
      renderApp();
      $('sidebar')?.classList.remove('open');
    });
  });

  screen.querySelector('[data-apk-placeholder]')?.addEventListener('click', (e) => {
    e.preventDefault();
    toast('Your Android APK download link will appear here when it is ready.');
  });

  renderPage();
}

function renderPage() {
  const target = $('pageContent');
  if (!target) return;

  if (activePage === 'dashboard') target.innerHTML = dashboardPage();
  if (activePage === 'wishlist') target.innerHTML = wishlistPage();
  if (activePage === 'purchases') target.innerHTML = purchasesPage();
  if (activePage === 'gifts') target.innerHTML = giftsPage();
  if (activePage === 'expenses') target.innerHTML = expensesPage();
  if (activePage === 'budget') target.innerHTML = budgetPage();

  bindPageEvents();
}

function dashboardPage() {
  const budget = budgetForMonth();
  const spent = spendingForMonth();
  const gifts = giftsForMonth();
  const remaining = budget ? Number(budget.amount) - spent : null;
  const recent = transactions.slice(0, 5);
  const pending = ownerItems.filter(w => !w.delivered).length;

  return `
    <section class="welcome-row">
      <div><p class="eyebrow">OVERVIEW</p><h1>Welcome back, ${esc(profile.username)}.</h1>
      <p class="muted">A clear view of your wishlist, purchases and monthly spending.</p></div>
      <div class="month-chip">${esc(monthLabel(selectedMonth))}</div>
    </section>

    <section class="metric-grid">
      <article class="metric-card"><span class="metric-label">Monthly spending</span><strong>${money(spent)}</strong><small>Purchases + other expenses</small></article>
      <article class="metric-card"><span class="metric-label">Budget remaining</span><strong>${remaining === null ? 'Not set' : money(remaining)}</strong><small>${budget ? `From ${money(budget.amount)} budget` : 'Set a monthly budget'}</small></article>
      <article class="metric-card"><span class="metric-label">Gift value received</span><strong>${money(gifts)}</strong><small>Tracked separately from spending</small></article>
      <article class="metric-card"><span class="metric-label">Wishlist items</span><strong>${ownerItems.length}</strong><small>${pending} still on your list</small></article>
    </section>

    <section class="dashboard-grid">
      <article class="panel">
        <div class="section-heading"><div><p class="eyebrow">MONTHLY BUDGET</p><h2>Spending summary</h2></div><button class="text-btn" data-page="budget">Manage budget →</button></div>
        ${budget ? `
          <div class="budget-number"><strong>${money(spent)}</strong><span>of ${money(budget.amount)}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, spent / Math.max(1, Number(budget.amount)) * 100)}%"></div></div>
          <p class="muted tiny">${remaining >= 0 ? `${money(remaining)} remaining this month` : `${money(Math.abs(remaining))} over your budget`}</p>
        ` : `<p class="muted">You haven't set a budget for this month yet.</p><button class="primary" data-page="budget">Set monthly budget</button>`}
      </article>
      <article class="panel">
        <div class="section-heading"><div><p class="eyebrow">GIFT SAVINGS</p><h2>Gifts received</h2></div><span class="soft-icon">◇</span></div>
        <strong class="large-number">${money(gifts)}</strong>
        <p class="muted">Estimated value of gifts received this month. These are not included in your personal expenses.</p>
        <button class="text-btn" data-page="gifts">View gift history →</button>
      </article>
    </section>

    <section class="panel">
      <div class="section-heading"><div><p class="eyebrow">RECENT ACTIVITY</p><h2>Latest transactions</h2></div><button class="text-btn" data-page="expenses">See all →</button></div>
      ${recent.length ? `<div class="transaction-list">${recent.map(transactionRow).join('')}</div>` : `<div class="empty-state"><h3>No activity yet</h3><p>Your purchases, gifts and expenses will appear here.</p></div>`}
    </section>

    <section class="panel share-panel">
      <div><p class="eyebrow">YOUR PUBLIC WISHLINK</p><h2>${esc(profile.username)}</h2><p class="muted">Share your list so friends can reserve gifts for you.</p></div>
      <button class="primary" id="dashboardCopy">Copy link</button>
    </section>`;
}

function wishlistPage() {
  const items = ownerItems;
  return `
    <section class="page-heading"><div><p class="eyebrow">YOUR COLLECTION</p><h1>My wishlist</h1><p class="muted">Save products you want and keep their details organised.</p></div></section>
    <section class="panel">
      <div class="section-heading"><div><h2 id="wishFormTitle">${editingId ? 'Edit wishlist item' : 'Add a product'}</h2><p class="muted tiny">Upload a product picture or paste an image URL.</p></div></div>
      <form id="wishForm" class="form-grid">
        <div class="field-full"><label>Product name *</label><input id="wishName" required maxlength="90" placeholder="e.g. Wireless headphones"></div>
        <div><label>Expected price (₹)</label><input id="wishPrice" type="number" min="0" step=".01" placeholder="Optional"></div>
        <div><label>Category</label><select id="wishCategory">${categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field-full"><label>Product link</label><input id="wishLink" type="url" placeholder="https://..."></div>
        <div class="field-full"><label>Product image URL (optional)</label><input id="wishImageUrl" type="url" placeholder="https://..."></div>
        <div class="field-full"><label>Or upload a product screenshot / image</label><input id="wishImageFile" type="file" accept="image/png,image/jpeg,image/jpg,image/webp"><small class="muted">PNG, JPG, JPEG or WebP. Maximum 5 MB.</small></div>
        <div class="field-full"><label>Notes</label><textarea id="wishNotes" maxlength="240" rows="2" placeholder="Colour, size or other details"></textarea></div>
        <div class="form-actions field-full">
          ${editingId ? '<button type="button" class="secondary" id="cancelWishEdit">Cancel</button>' : ''}
          <button class="primary" id="saveWishButton">${editingId ? 'Save changes' : '＋ Add to wishlist'}</button>
        </div>
      </form>
    </section>
    <section class="section-heading list-heading"><div><h2>All items</h2><p class="muted tiny">${items.length} wishlist items</p></div></section>
    <section class="wish-grid">${items.length ? items.map(ownerCard).join('') : `<div class="empty-state"><h3>Your wishlist is empty</h3><p>Add your first product above.</p></div>`}</section>`;
}

function ownerCard(w) {
  return `
    <article class="product-card">
      ${w.image_url
        ? `<img class="product-image" src="${esc(w.image_url)}" alt="${esc(w.name)}" loading="lazy">`
        : `<div class="product-image product-image-empty">No image</div>`}
      <div class="product-card-body">
        <span class="pill">${esc(w.category)}</span>
        <h3>${esc(w.name)}</h3>
        <strong>${money(w.price)}</strong>
        ${w.notes ? `<p class="muted tiny">${esc(w.notes)}</p>` : ''}
        <div class="status-line">
          ${w.purchased_by_owner ? '<span class="status status-purchased">Bought by you</span>'
            : w.delivered ? '<span class="status status-gift">Gift received</span>'
            : w.reserved ? '<span class="status status-reserved">Reserved</span>'
            : '<span class="status status-available">Available</span>'}
        </div>
        ${w.product_url ? `<a class="product-link" href="${esc(w.product_url)}" target="_blank" rel="noopener">View product ↗</a>` : ''}
        <div class="card-actions">
          <button class="secondary" data-action="edit" data-id="${w.id}">Edit</button>
          <button class="secondary" data-action="delete" data-id="${w.id}">Delete</button>
        </div>
        ${!w.delivered && !w.purchased_by_owner ? `
          <div class="card-actions">
            <button class="primary" data-action="buy" data-id="${w.id}">Mark as bought</button>
            ${w.reserved ? `<button class="secondary" data-action="gift" data-id="${w.id}">Confirm gift received</button>` : ''}
          </div>` : ''}
      </div>
    </article>`;
}

function purchasesPage() {
  const rows = transactions.filter(t => t.transaction_type === 'purchase');
  return `
    <section class="page-heading"><div><p class="eyebrow">YOUR PURCHASES</p><h1>Purchased items</h1><p class="muted">Products you bought for yourself.</p></div></section>
    <section class="metric-grid single-metric">
      <article class="metric-card"><span class="metric-label">Total purchases recorded</span><strong>${money(rows.reduce((s, t) => s + Number(t.amount), 0))}</strong><small>${rows.length} purchase records</small></article>
    </section>
    <section class="panel"><div class="section-heading"><h2>Purchase history</h2></div>
      ${rows.length ? `<div class="transaction-list">${rows.map(transactionRow).join('')}</div>` : `<div class="empty-state"><h3>No purchases recorded</h3><p>Use “Mark as bought” on a wishlist item to record a purchase.</p></div>`}
    </section>`;
}

function giftsPage() {
  const rows = transactions.filter(t => t.transaction_type === 'gift');
  const total = rows.reduce((sum, t) => sum + Number(t.amount), 0);
  return `
    <section class="page-heading"><div><p class="eyebrow">GIFT HISTORY</p><h1>Gifts received</h1><p class="muted">Keep a record of gifts and the value you saved.</p></div></section>
    <section class="metric-grid single-metric">
      <article class="metric-card"><span class="metric-label">Total estimated gift value</span><strong>${money(total)}</strong><small>${rows.length} gifts recorded</small></article>
    </section>
    <section class="panel"><div class="section-heading"><h2>Gift history</h2></div>
      ${rows.length ? `<div class="transaction-list">${rows.map(transactionRow).join('')}</div>` : `<div class="empty-state"><h3>No gifts recorded yet</h3><p>When you confirm a reserved item as received, it will appear here.</p></div>`}
    </section>`;
}

function expensesPage() {
  const rows = monthTransactions();
  const spendRows = rows.filter(t => t.transaction_type !== 'gift');
  return `
    <section class="page-heading"><div><p class="eyebrow">MONEY TRACKER</p><h1>Expense tracker</h1><p class="muted">Track purchases and other spending in one place.</p></div></section>
    <section class="month-selector"><label>Showing month</label><input type="month" id="expenseMonth" value="${esc(selectedMonth)}"></section>
    <section class="metric-grid">
      <article class="metric-card"><span class="metric-label">Total expenses</span><strong>${money(spendRows.reduce((s, t) => s + Number(t.amount), 0))}</strong><small>Purchases and manual expenses</small></article>
      <article class="metric-card"><span class="metric-label">Other expenses</span><strong>${money(spendRows.filter(t => t.transaction_type === 'expense').reduce((s, t) => s + Number(t.amount), 0))}</strong><small>Manually entered expenses</small></article>
      <article class="metric-card"><span class="metric-label">Purchases</span><strong>${money(spendRows.filter(t => t.transaction_type === 'purchase').reduce((s, t) => s + Number(t.amount), 0))}</strong><small>Wishlist purchases</small></article>
    </section>
    <section class="panel">
      <div class="section-heading"><div><h2>Add an expense</h2><p class="muted tiny">For expenses not linked to a wishlist item.</p></div></div>
      <form id="expenseForm" class="form-grid">
        <div class="field-full"><label>Expense title *</label><input id="expenseTitle" required maxlength="120" placeholder="e.g. Grocery shopping"></div>
        <div><label>Amount (₹) *</label><input id="expenseAmount" required type="number" min="0.01" step=".01"></div>
        <div><label>Category</label><select id="expenseCategory">${expenseCategories.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div><label>Where did you spend?</label><input id="expenseMerchant" placeholder="Store / website"></div>
        <div><label>Date</label><input id="expenseDate" type="date" value="${today()}" required></div>
        <div class="field-full"><label>Notes</label><textarea id="expenseNotes" rows="2" placeholder="Optional details"></textarea></div>
        <div class="field-full"><button class="primary">Save expense</button></div>
      </form>
    </section>
    <section class="panel"><div class="section-heading"><h2>Transactions for ${esc(monthLabel(selectedMonth))}</h2></div>
      ${rows.length ? `<div class="transaction-list">${rows.map(transactionRow).join('')}</div>` : `<div class="empty-state"><h3>No transactions this month</h3><p>Your spending records will appear here.</p></div>`}
    </section>`;
}

function budgetPage() {
  const budget = budgetForMonth();
  const spent = spendingForMonth();
  const gifts = giftsForMonth();
  return `
    <section class="page-heading"><div><p class="eyebrow">MONTHLY PLANNING</p><h1>Budget manager</h1><p class="muted">Set a monthly online-shopping and spending budget.</p></div></section>
    <section class="month-selector"><label>Choose month</label><input type="month" id="budgetMonth" value="${esc(selectedMonth)}"></section>
    <section class="panel budget-panel">
      <p class="eyebrow">YOUR BUDGET</p>
      <h2>${esc(monthLabel(selectedMonth))}</h2>
      <form id="budgetForm" class="budget-form">
        <label>Monthly budget amount (₹)</label>
        <input id="budgetAmount" type="number" min="0" step=".01" required value="${budget ? Number(budget.amount) : ''}" placeholder="e.g. 5000">
        <button class="primary">Save monthly budget</button>
      </form>
      ${budget ? `
        <div class="budget-summary">
          <div><span class="muted">Spent</span><strong>${money(spent)}</strong></div>
          <div><span class="muted">Remaining</span><strong>${money(Number(budget.amount) - spent)}</strong></div>
          <div><span class="muted">Gift value</span><strong>${money(gifts)}</strong></div>
        </div>
        <div class="progress-track large-progress"><div class="progress-fill" style="width:${Math.min(100, spent / Math.max(1, Number(budget.amount)) * 100)}%"></div></div>
        <p class="muted tiny">${Math.round(spent / Math.max(1, Number(budget.amount)) * 100)}% of your budget used. Gifts are not included in spending.</p>
      ` : '<p class="muted">No budget saved for this month yet.</p>'}
    </section>`;
}

function transactionRow(t) {
  const isGift = t.transaction_type === 'gift';
  const isPurchase = t.transaction_type === 'purchase';
  const typeLabel = isGift ? 'Gift received' : isPurchase ? 'Purchase' : 'Expense';

  return `
    <div class="transaction-row">
      <div class="transaction-symbol ${isGift ? 'gift-symbol' : ''}">${isGift ? '◇' : isPurchase ? '✓' : '₹'}</div>
      <div class="transaction-description">
        <strong>${esc(t.title)}</strong>
        <small>${esc(typeLabel)} · ${esc(t.category || 'Other')} · ${esc(t.occurred_on)}</small>
        ${t.merchant ? `<small>${esc(t.merchant)}</small>` : ''}
      </div>
      <strong class="${isGift ? 'gift-amount' : ''}">${isGift ? '+' : '−'}${money(t.amount)}</strong>
      ${t.transaction_type === 'expense' ? `<button class="text-btn delete-transaction" data-transaction="${t.id}">Delete</button>` : ''}
    </div>`;
}

function bindPageEvents() {
  screen.querySelectorAll('[data-page]').forEach(button => {
    button.onclick = () => {
      activePage = button.dataset.page;
      renderApp();
    };
  });

  $('dashboardCopy')?.addEventListener('click', () => copyText(`${APP_URL}/w/${profile.username}`, 'WishLink copied.'));
  $('wishForm')?.addEventListener('submit', saveWish);
  $('cancelWishEdit')?.addEventListener('click', cancelWishEdit);
  $('wish-grid')?.addEventListener('click', ownerAction);
  screen.querySelector('.wish-grid')?.addEventListener('click', ownerAction);

  $('expenseForm')?.addEventListener('submit', saveExpense);
  $('budgetForm')?.addEventListener('submit', saveBudget);

  $('expenseMonth')?.addEventListener('change', (e) => {
    selectedMonth = e.target.value || selectedMonth;
    renderPage();
  });

  $('budgetMonth')?.addEventListener('change', (e) => {
    selectedMonth = e.target.value || selectedMonth;
    renderPage();
  });

  screen.querySelectorAll('[data-transaction]').forEach(button => {
    button.addEventListener('click', () => deleteTransaction(button.dataset.transaction));
  });
}

async function uploadWishImage(file) {
  if (!file) return null;

  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Choose a PNG, JPG, JPEG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image must be smaller than 5 MB.');

  const extension = file.name.split('.').pop().toLowerCase();
  const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type
  });

  if (error) throw error;

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function saveWish(e) {
  e.preventDefault();
  const button = $('saveWishButton');
  button.disabled = true;

  try {
    const file = $('wishImageFile').files[0];
    let imageUrl = $('wishImageUrl').value.trim() || null;

    if (imageUrl && !validUrl(imageUrl)) throw new Error('Enter a valid image URL.');
    if (file) imageUrl = await uploadWishImage(file);

    const data = {
      owner_id: currentUser.id,
      name: $('wishName').value.trim(),
      price: $('wishPrice').value === '' ? null : Number($('wishPrice').value),
      category: $('wishCategory').value,
      product_url: $('wishLink').value.trim() || null,
      image_url: imageUrl,
      notes: $('wishNotes').value.trim() || null
    };

    if (data.product_url && !validUrl(data.product_url)) throw new Error('Enter a valid product link.');
    if (data.price !== null && (!Number.isFinite(data.price) || data.price < 0)) throw new Error('Enter a valid price.');

    const result = editingId
      ? await supabase.from('wishes').update(data).eq('id', editingId).eq('owner_id', currentUser.id)
      : await supabase.from('wishes').insert(data);

    if (result.error) throw result.error;

    editingId = null;
    await loadOwner();
    renderApp();
    toast('Wishlist item saved.');
  } catch (err) {
    toast(err.message || 'Could not save the wishlist item.');
  } finally {
    if ($('saveWishButton')) $('saveWishButton').disabled = false;
  }
}

function cancelWishEdit() {
  editingId = null;
  renderApp();
}

async function ownerAction(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) return;

  const wish = ownerItems.find(w => w.id === button.dataset.id);
  if (!wish) return;

  const action = button.dataset.action;

  try {
    if (action === 'edit') {
      editingId = wish.id;
      renderApp();

      $('wishName').value = wish.name;
      $('wishPrice').value = wish.price ?? '';
      $('wishCategory').value = wish.category;
      $('wishLink').value = wish.product_url || '';
      $('wishImageUrl').value = wish.image_url || '';
      $('wishNotes').value = wish.notes || '';
      $('wishFormTitle').textContent = 'Edit wishlist item';
      $('saveWishButton').textContent = 'Save changes';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (action === 'delete') {
      if (!confirm(`Delete "${wish.name}" from your wishlist?`)) return;
      const { error } = await supabase.from('wishes').delete().eq('id', wish.id).eq('owner_id', currentUser.id);
      if (error) throw error;
    }

    if (action === 'buy') {
      const amountInput = prompt(`How much did you pay for "${wish.name}"?`, String(wish.price ?? ''));
      if (amountInput === null) return;
      const amount = Number(amountInput);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid purchase amount.');

      const dateInput = prompt('Purchase date (YYYY-MM-DD):', today());
      if (dateInput === null) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) throw new Error('Enter the date as YYYY-MM-DD.');

      const { error: txError } = await supabase.from('shopping_transactions').insert({
        owner_id: currentUser.id,
        wish_id: wish.id,
        transaction_type: 'purchase',
        title: wish.name,
        category: wish.category || 'Shopping',
        amount,
        merchant: wish.product_url ? new URL(wish.product_url).hostname : null,
        occurred_on: dateInput
      });
      if (txError) throw txError;

      const { error } = await supabase.from('wishes').update({
        purchased_by_owner: true,
        actual_paid: amount,
        purchased_at: dateInput,
        delivered: true
      }).eq('id', wish.id);
      if (error) throw error;
    }

    if (action === 'gift') {
      if (!confirm(`Confirm that "${wish.name}" was received as a gift? Its estimated value will be recorded as savings, not as your expense.`)) return;

      const amount = Number(wish.price || 0);
      const { error: txError } = await supabase.from('shopping_transactions').insert({
        owner_id: currentUser.id,
        wish_id: wish.id,
        transaction_type: 'gift',
        title: wish.name,
        category: wish.category || 'Gift',
        amount,
        occurred_on: today()
      });
      if (txError) throw txError;

      const { error } = await supabase.from('wishes').update({
        delivered: true,
        purchased_by_owner: false,
        actual_paid: null,
        purchased_at: today()
      }).eq('id', wish.id);
      if (error) throw error;
    }

    await loadOwner();
    renderApp();
    toast('Wishlist updated.');
  } catch (err) {
    toast(err.message || 'Could not complete that action.');
  }
}

async function saveExpense(e) {
  e.preventDefault();

  try {
    const amount = Number($('expenseAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');

    const { error } = await supabase.from('shopping_transactions').insert({
      owner_id: currentUser.id,
      transaction_type: 'expense',
      title: $('expenseTitle').value.trim(),
      amount,
      category: $('expenseCategory').value,
      merchant: $('expenseMerchant').value.trim() || null,
      occurred_on: $('expenseDate').value,
      notes: $('expenseNotes').value.trim() || null
    });

    if (error) throw error;
    await loadOwner();
    renderApp();
    toast('Expense saved.');
  } catch (err) {
    toast(err.message || 'Could not save expense.');
  }
}

async function saveBudget(e) {
  e.preventDefault();

  try {
    const amount = Number($('budgetAmount').value);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid budget amount.');

    const { error } = await supabase.from('shopping_budgets').upsert({
      owner_id: currentUser.id,
      budget_month: monthDate(selectedMonth),
      amount
    }, { onConflict: 'owner_id,budget_month' });

    if (error) throw error;
    await loadOwner();
    renderApp();
    toast('Monthly budget saved.');
  } catch (err) {
    toast(err.message || 'Could not save budget.');
  }
}

async function deleteTransaction(id) {
  if (!confirm('Delete this manual expense record?')) return;

  const { error } = await supabase.from('shopping_transactions')
    .delete()
    .eq('id', id)
    .eq('owner_id', currentUser.id)
    .eq('transaction_type', 'expense');

  if (error) return toast(error.message);

  await loadOwner();
  renderApp();
  toast('Expense deleted.');
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch {
    prompt('Copy your WishLink:', value);
  }
}

async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  profile = null;
  ownerItems = [];
  transactions = [];
  go('/');
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('wishlink-dark', document.body.classList.contains('dark') ? '1' : '0');
  updateThemeButton();
}

async function renderPublic(username) {
  screen.innerHTML = '<div class="loading">Loading this WishLink…</div>';

  try {
    const { data, error } = await supabase.rpc('get_public_wishlist', { p_username: username });
    if (error) throw error;

    if (!data || data.length === 0) {
      const { data: owner, error: ownerError } = await supabase.rpc('get_public_profile', { p_username: username });
      if (ownerError) throw ownerError;
      if (!owner?.length) throw new Error('This WishLink does not exist.');
    }

    publicMarkup(username, data || []);
  } catch (err) {
    screen.innerHTML = `
      <section class="panel narrow public-error">
        <p class="eyebrow">WISHLINK</p><h1>Wishlist not found</h1>
        <p class="muted">${esc(err.message)}</p><a href="/" class="primary inline">Open WishLink</a>
      </section>`;
  }
}

function publicMarkup(username, rows) {
  const cards = rows.map(w => `
    <article class="public-card">
      ${w.image_url
        ? `<img class="public-image" src="${esc(w.image_url)}" alt="${esc(w.name)}" loading="lazy">`
        : `<div class="public-image product-image-empty">No image</div>`}
      <div class="public-info">
        <span class="pill">${esc(w.category)}</span>
        <h3>${esc(w.name)}</h3>
        <strong>${money(w.price)}</strong>
        ${w.notes ? `<p class="muted">${esc(w.notes)}</p>` : ''}
        ${w.delivered ? '<span class="status status-gift">Already received</span>'
          : w.reserved ? '<span class="status status-reserved">Someone is gifting this</span>'
          : `<button class="primary full reserve-btn" data-id="${w.id}">Reserve this gift</button>`}
        ${w.product_url ? `<a class="product-link" href="${esc(w.product_url)}" target="_blank" rel="noopener">View product ↗</a>` : ''}
      </div>
    </article>`).join('');

  screen.innerHTML = `
    <div class="public-page">
      <header class="public-topbar"><a href="/" class="public-brand"><span class="brand-mark">W</span> WishLink</a><span>Public wishlist</span></header>
      <section class="public-hero">
        <p class="eyebrow">A WISHLIST BY</p><h1>${esc(username)}</h1>
        <p>Choose a wish and make someone's day.</p>
      </section>
      <section class="public-grid">${cards || '<div class="empty-state"><h3>This wishlist is empty</h3><p>There are no wishes to show yet.</p></div>'}</section>
      <p class="public-note">WishLink does not process payments. Reservations help avoid duplicate gifts; purchase the item directly from the retailer.</p>
    </div>`;

  screen.querySelectorAll('.reserve-btn').forEach(button => {
    button.onclick = () => reserve(button.dataset.id, username);
  });
}

async function reserve(wishId, username) {
  const name = prompt('What name should we show? Leave blank to stay anonymous.');
  if (name === null) return;

  const message = prompt('Add a short gift message? (Optional)') || '';
  const reveal = confirm('Would you like the wishlist owner to see your name?\n\nOK = show my name\nCancel = stay anonymous');

  const { error } = await supabase.rpc('reserve_wish', {
    p_wish_id: wishId,
    p_gifter_name: reveal ? (name.trim() || 'A friend') : null,
    p_message: message.trim().slice(0, 180),
    p_reveal_name: reveal
  });

  if (error) {
    toast(error.message.includes('already') ? 'Someone has already reserved this wish.' : error.message);
    return;
  }

  toast('Your gift reservation has been saved.');
  await renderPublic(username);
}

setupTheme();

if (isConfigured) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
      if (route().type === 'owner') renderRoute();
    }
  });
}

renderRoute();