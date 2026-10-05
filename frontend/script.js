// When index.html is opened as a file, talk to the local backend; otherwise use the same origin.
const API = location.protocol === 'file:' ? 'http://localhost:4000' : '';
const TOKEN_KEY = 'toothkart_token';

const slidesData = [
  { tag: 'NEW CLINIC SETUP', t: 'Clinical Starter Kits', p: 'Everything for a new practice, in one bundle.', art: '🦷', theme: 'dark' },
  { tag: 'UP TO 30% OFF', t: 'Surgical Loupes', p: 'Sharper vision and better posture, every procedure.', art: '🔬', theme: 'orange' },
  { tag: 'TOP BRANDS', t: 'Implant Motors', p: 'Precision torque control from trusted brands.', art: '⚙️', theme: 'slate' },
  { tag: 'IN STOCK', t: 'Sterilization Range', p: 'Autoclaves and UV chambers, delivered fast.', art: '♨️', theme: 'light' },
];

const $ = id => document.getElementById(id);
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 });

// Build elements with textContent only, so product data can never inject HTML
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

// Scroll-in animations: elements with .reveal get .in when they enter the screen
const revealObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); }
    }), { threshold: 0.12 })
  : null;
function observeReveals() {
  document.querySelectorAll('.reveal:not(.in)').forEach(n => revealObserver ? revealObserver.observe(n) : n.classList.add('in'));
}

let token = localStorage.getItem(TOKEN_KEY);
let user = null;
let filter = {}; // { q, category, brand }

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + '/api' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (token && (res.status === 401 || (res.status === 403 && data.error === 'Account blocked'))) {
    setSession(null, null);
    if (res.status === 403) toast('Your account has been blocked. Please contact support.');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- Hero slider: slides sideways, text animates in, swipe + pause on hover ----------
let cur = 0, timer;
const hero = document.querySelector('.hero');
const slideEls = slidesData.map(s => {
  const art = el('div', { className: 'art', textContent: s.art });
  art.setAttribute('aria-hidden', 'true');
  return el('div', { className: 'slide ' + s.theme },
    el('div', { className: 'copy' },
      el('span', { className: 'tag', textContent: s.tag }),
      el('h2', { textContent: s.t }),
      el('p', { textContent: s.p }),
      el('button', { className: 'btn', textContent: 'Shop now →', onclick: () => $('productsSection').scrollIntoView({ behavior: 'smooth' }) })),
    art);
});
const dotEls = slidesData.map((_, i) => el('i', { onclick: () => go(i) }));
$('slides').replaceChildren(...slideEls);
$('dots').replaceChildren(...dotEls);

function go(i) {
  cur = (i + slideEls.length) % slideEls.length;
  slideEls.forEach((s, k) => {
    s.style.transform = `translateX(-${cur * 100}%)`;
    s.classList.toggle('active', k === cur);
  });
  dotEls.forEach((d, k) => {
    d.classList.remove('on');
    if (k === cur) { void d.offsetWidth; d.classList.add('on'); } // restart the progress fill
  });
  clearInterval(timer);
  timer = setInterval(() => go(cur + 1), 5000);
}
document.querySelector('.prev').onclick = () => go(cur - 1);
document.querySelector('.next').onclick = () => go(cur + 1);
hero.addEventListener('mouseenter', () => clearInterval(timer));
hero.addEventListener('mouseleave', () => go(cur));

let swipeX = null;
$('slides').addEventListener('pointerdown', e => { swipeX = e.clientX; });
$('slides').addEventListener('pointerup', e => {
  if (swipeX !== null && Math.abs(e.clientX - swipeX) > 50) go(cur + (e.clientX < swipeX ? 1 : -1));
  swipeX = null;
});
go(0);

// ---------- Brands & categories (click to filter) ----------
const brandLink = b => el('a', { className: 'brand', href: '#', textContent: b, onclick: e => { e.preventDefault(); setFilter({ brand: b }); } });

// The brand strip comes from the catalog, so a brand added in the admin appears here
async function loadBrands() {
  try {
    const names = (await api('/brands')).map(b => b.name);
    $('brandsSection').hidden = names.length === 0;
    // Few brands would leave gaps in the sliding strip, so repeat the list until it is long enough,
    // then repeat that whole set once more so the loop is seamless. Only the first set can be focused or read aloud.
    const set = Array.from({ length: Math.ceil(12 / Math.max(names.length, 1)) }, () => names).flat();
    const copy = set.map(brandLink);
    copy.forEach(a => { a.tabIndex = -1; a.setAttribute('aria-hidden', 'true'); });
    $('brands').replaceChildren(...set.map(brandLink), ...copy);
  } catch {
    $('brandsSection').hidden = true;
  }
}

// The category tiles come from the catalog, so a category added in the admin appears here
async function loadCategories() {
  try {
    const list = await api('/categories');
    $('categoriesSection').hidden = list.length === 0;
    $('categories').replaceChildren(...list.map((c, k) => {
      const a = el('a', { className: 'cat reveal', href: '#', onclick: e => { e.preventDefault(); setFilter({ category: c.name }); } },
        el('span', { className: 'ic', textContent: c.icon }), c.name,
        el('small', { textContent: c.products ? `${c.products} product${c.products === 1 ? '' : 's'}` : 'Coming soon' }));
      a.style.setProperty('--d', (k % 6) * 70 + 'ms');
      return a;
    }));
    observeReveals();
  } catch {
    $('categoriesSection').hidden = true; // the products area already explains when the server is unreachable
  }
}

function setFilter(f) {
  filter = f;
  loadProducts();
  $('productsSection').scrollIntoView({ behavior: 'smooth' });
}
$('clearFilter').onclick = () => { $('searchInput').value = ''; setFilter({}); };

// ---------- Search ----------
$('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('searchInput').value.trim();
  setFilter(q ? { q } : {});
});

// ---------- Products (from the database) ----------
async function loadProducts() {
  const params = new URLSearchParams({ limit: 24, ...filter });
  const label = filter.q ? `Results for "${filter.q}"` : filter.onOffer ? 'Offers' : filter.category || filter.brand || 'Products';
  $('productsTitle').textContent = label;
  $('clearFilter').hidden = !Object.keys(filter).length;
  try {
    const data = await api('/products?' + params);
    $('products').replaceChildren(...data.products.map(card));
    observeReveals();
    $('productsEmpty').hidden = data.products.length > 0;
    $('productsEmpty').textContent = Object.keys(filter).length ? 'No products match your search.' : 'No products yet. Add some from the admin dashboard.';
  } catch {
    $('products').replaceChildren();
    $('productsEmpty').hidden = false;
    $('productsEmpty').textContent = 'Could not load products. Start the backend (npm start in the backend folder) and open http://localhost:4000.';
  }
}

function card(p, i) {
  const img = p.image_url
    ? (img => { img.onerror = () => img.replaceWith(el('span', { textContent: '🦷' })); return img; })(el('img', { src: API + p.image_url, alt: p.name, loading: 'lazy' }))
    : el('span', { textContent: '🦷' });
  const price = el('div', { className: 'price' }, el('b', { textContent: inr(p.final_price) }));
  if (p.discount_percent > 0) price.append(el('s', { textContent: inr(p.price) }), el('em', { textContent: 'Save ' + inr(p.price - p.final_price) }));
  const btn = el('button', { className: 'add', textContent: p.stock > 0 ? 'Add to cart' : 'Out of stock', disabled: p.stock <= 0, onclick: () => addToCart(p) });
  const c = el('div', { className: 'card reveal' },
    ...(p.discount_percent > 0 ? [el('span', { className: 'ribbon', textContent: Math.round(p.discount_percent) + '% OFF' })] : []),
    el('div', { className: 'img' }, img),
    el('small', { textContent: p.brand || p.category || '' }), el('h3', { textContent: p.name }), price,
    ...(p.stock > 0 && p.stock <= 5 ? [el('span', { className: 'low', textContent: `Only ${p.stock} left` })] : []),
    btn);
  c.style.setProperty('--d', (i % 4) * 80 + 'ms'); // cards slide in one after another
  return c;
}

// ---------- Auth ----------
const authDlg = $('authDlg');
let mode = 'login';

function setMode(m) {
  mode = m;
  const reg = m === 'register';
  $('authTitle').textContent = reg ? 'Create account' : 'Sign in';
  $('authSubmit').textContent = reg ? 'Create account' : 'Sign in';
  $('nameRow').hidden = !reg;
  $('authForm').name.required = reg;
  $('authForm').password.autocomplete = reg ? 'new-password' : 'current-password';
  $('authSwitchText').textContent = reg ? 'Already have an account?' : 'New to ToothKart?';
  $('authSwitch').textContent = reg ? 'Sign in' : 'Create an account';
  $('authError').textContent = '';
}
function openAuth(m = 'login') { setMode(m); setPane('email'); authDlg.showModal(); }
$('authSwitch').onclick = () => setMode(mode === 'login' ? 'register' : 'login');
$('authClose').onclick = () => authDlg.close();

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const data = await api(mode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', json: f });
    setSession(data.token, data.user);
    e.target.reset();
    authDlg.close();
    toast(`Welcome, ${data.user.name}!`);
    refreshCart();
  } catch (err) {
    $('authError').textContent = err.message;
  }
});

// ---------- Mobile OTP ----------
const otpForm = $('otpForm');
let otpStep = 1, otpPhone = '', resendTimer;

function setPane(p) {
  document.querySelectorAll('.auth-tabs button').forEach(b => b.classList.toggle('on', b.dataset.pane === p));
  $('authForm').hidden = p !== 'email';
  otpForm.hidden = p !== 'otp';
  if (p === 'otp') showOtpStep(1);
}
document.querySelectorAll('.auth-tabs button').forEach(b => b.onclick = () => setPane(b.dataset.pane));
$('otpClose').onclick = () => authDlg.close();

function showOtpStep(n) {
  otpStep = n;
  $('otpStep1').hidden = n !== 1;
  $('otpStep2').hidden = n !== 2;
  $('otpLinks').hidden = n !== 2;
  otpForm.phone.required = n === 1;
  otpForm.code.required = n === 2;
  $('otpSubmit').textContent = n === 1 ? 'Send OTP' : 'Verify & sign in';
  $('otpError').textContent = '';
  if (n === 1) { clearInterval(resendTimer); otpForm.code.value = ''; setTimeout(() => otpForm.phone.focus(), 50); }
  else setTimeout(() => otpForm.code.focus(), 50);
}

function startResendCountdown(seconds) {
  clearInterval(resendTimer);
  const btn = $('otpResend');
  let left = seconds;
  const tick = () => {
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Resend OTP in ${left}s` : 'Resend OTP';
    if (left-- <= 0) clearInterval(resendTimer);
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

async function sendOtp(phone) {
  const data = await api('/auth/otp/send', { method: 'POST', json: { phone } });
  otpPhone = phone.replace(/\D/g, '').slice(-10);
  $('otpSentTo').textContent = `We sent a 6-digit code to +91 ${otpPhone}.`;
  showOtpStep(2);
  startResendCountdown(data.resend_in || 30);
  if (data.dev_code) toast(`Test mode: your OTP is ${data.dev_code}`);
}

otpForm.addEventListener('submit', async e => {
  e.preventDefault();
  $('otpSubmit').disabled = true;
  $('otpError').textContent = '';
  try {
    if (otpStep === 1) {
      await sendOtp(otpForm.phone.value.trim());
    } else {
      const data = await api('/auth/otp/verify', { method: 'POST', json: { phone: otpPhone, code: otpForm.code.value.trim(), name: otpForm.name.value.trim() } });
      setSession(data.token, data.user);
      otpForm.reset();
      authDlg.close();
      toast(data.created ? `Welcome to ToothKart, ${data.user.name}!` : `Welcome back, ${data.user.name}!`);
      refreshCart();
    }
  } catch (err) {
    $('otpError').textContent = err.message;
  } finally {
    $('otpSubmit').disabled = false;
  }
});
$('otpResend').onclick = async () => {
  $('otpError').textContent = '';
  try { await sendOtp(otpPhone); toast('A new code has been sent'); }
  catch (err) { $('otpError').textContent = err.message; }
};
$('otpChange').onclick = () => showOtpStep(1);

function setSession(t, u) {
  token = t;
  user = u;
  if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
  $('accountBtn').textContent = u ? `👤 ${u.name.split(' ')[0]}` : '👤 Sign in';
  if (!u) renderCart(null);
}
// Signed in: open the customer dashboard (orders, invoices, profile). Signed out: show the sign-in form.
$('accountBtn').onclick = () => {
  if (!user) return openAuth('login');
  location.href = 'account.html';
};
if (location.hash === '#signin') setTimeout(() => !user && openAuth('login'), 300);

// ---------- Cart ----------
function renderCart(cart) {
  const badge = $('cartCount'), n = cart ? cart.count : 0;
  if (String(n) !== badge.textContent) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
  badge.textContent = n;
  const body = $('cartItems'), foot = $('cartFoot');
  if (!cart || !cart.items.length) {
    body.replaceChildren(el('p', { className: 'empty', textContent: user ? 'Your cart is empty.' : 'Sign in to see your cart.' }));
    foot.replaceChildren();
    return;
  }
  body.replaceChildren(...cart.items.map(({ product: p, quantity, line_total }) => {
    const thumb = p.image_url ? (img => { img.onerror = () => img.replaceWith(el('span', { textContent: '🦷' })); return img; })(el('img', { src: API + p.image_url, alt: '' })) : el('span', { textContent: '🦷' });
    const qty = el('div', { className: 'qty' },
      el('button', { textContent: '−', onclick: () => setQty(p.id, quantity - 1), 'aria-label': 'Decrease' }),
      el('span', { textContent: quantity }),
      el('button', { textContent: '+', onclick: () => setQty(p.id, quantity + 1), 'aria-label': 'Increase' }));
    return el('div', { className: 'line' }, el('div', { className: 'thumb' }, thumb),
      el('div', { className: 'info' }, el('b', { textContent: p.name }), el('small', { textContent: inr(p.final_price) + ' each' }), qty),
      el('div', { className: 'side' }, el('b', { textContent: inr(line_total) }),
        el('button', { className: 'link', textContent: 'Remove', onclick: () => removeItem(p.id) })));
  }));
  const row = (k, v, cls = '') => el('div', { className: 'sum ' + cls }, el('span', { textContent: k }), el('span', { textContent: v }));
  foot.replaceChildren(row('Subtotal', inr(cart.subtotal)), row('Discount', '− ' + inr(cart.discount), 'save'), row('Total', inr(cart.total), 'total'),
    el('button', { className: 'btn wide', textContent: 'Checkout', onclick: openCheckout }));
}

async function refreshCart() {
  if (!token) return renderCart(null);
  try { renderCart(await api('/cart')); } catch { renderCart(null); }
}

async function addToCart(p) {
  if (!user) { toast('Please sign in to add items'); return openAuth('login'); }
  try {
    renderCart(await api('/cart', { method: 'POST', json: { productId: p.id, quantity: 1 } }));
    toast(`Added "${p.name}"`);
  } catch (err) { toast(err.message); }
}
async function setQty(id, q) {
  try { renderCart(q < 1 ? await api('/cart/' + id, { method: 'DELETE' }) : await api('/cart/' + id, { method: 'PATCH', json: { quantity: q } })); }
  catch (err) { toast(err.message); }
}
async function removeItem(id) {
  try { renderCart(await api('/cart/' + id, { method: 'DELETE' })); } catch (err) { toast(err.message); }
}

function openDrawer() {
  if (!user) { toast('Please sign in to view your cart'); return openAuth('login'); }
  refreshCart();
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('scrim').hidden = false;
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('scrim').hidden = true;
}
$('cartBtn').onclick = openDrawer;
$('drawerClose').onclick = closeDrawer;
$('scrim').onclick = closeDrawer;

// ---------- Checkout (cash on delivery or prepaid) ----------
function openCheckout() {
  $('checkoutError').textContent = '';
  const f = $('checkoutForm');
  if (user && !f.name.value) f.name.value = user.name;
  if (user && user.phone && !f.phone.value) f.phone.value = user.phone;
  if (!f.pincode.value && /^\d{6}$/.test($('pincodeText').textContent)) f.pincode.value = $('pincodeText').textContent;
  $('checkoutDlg').showModal();
}
$('checkoutClose').onclick = () => $('checkoutDlg').close();
$('checkoutForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('placeBtn').disabled = true;
  try {
    const order = await api('/orders', { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
    $('checkoutDlg').close();
    e.target.reset();
    closeDrawer();
    renderCart(null);
    toast(`Order #${order.id} placed (${order.payment_method === 'COD' ? 'cash on delivery' : 'prepaid'}). Total ${inr(order.total)}. We'll confirm it shortly.`);
    refreshCart();
    loadProducts(); // stock has changed
  } catch (err) {
    $('checkoutError').textContent = err.message;
  } finally {
    $('placeBtn').disabled = false;
  }
});

// ---------- Pincode ----------
$('pincodeBtn').onclick = () => {
  const v = prompt('Enter 6-digit pincode');
  if (v && /^\d{6}$/.test(v)) $('pincodeText').textContent = v;
};

// ---------- Navigation links, header and back-to-top ----------
document.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  const t = a.dataset.nav;
  if (t === 'offers') return setFilter({ onOffer: 'true' });
  if (t === 'products') return setFilter({});
  if (t === 'soon') return toast('Coming soon');
  $(t + 'Section').scrollIntoView({ behavior: 'smooth' });
}));
// ---------- Suggest a product ----------
$('suggestBtn').onclick = () => {
  $('suggestError').textContent = '';
  if (user && user.email && !$('suggestForm').email.value) $('suggestForm').email.value = user.email;
  $('suggestDlg').showModal();
};
$('suggestClose').onclick = () => $('suggestDlg').close();
$('suggestForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('suggestSubmit').disabled = true;
  $('suggestError').textContent = '';
  try {
    await api('/suggestions', { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    $('suggestDlg').close();
    toast("Thank you! We've received your suggestion.");
  } catch (err) {
    $('suggestError').textContent = err.message;
  } finally {
    $('suggestSubmit').disabled = false;
  }
});
$('toTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
window.addEventListener('scroll', () => {
  $('header').classList.toggle('scrolled', window.scrollY > 40);
  $('toTop').classList.toggle('show', window.scrollY > 600);
}, { passive: true });

// ---------- Start ----------
observeReveals();
loadBrands();
loadCategories();
loadProducts();
if (token) {
  api('/auth/me').then(d => { setSession(token, d.user); refreshCart(); }).catch(() => setSession(null, null));
}
