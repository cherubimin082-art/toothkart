// Customer dashboard: orders, invoices and profile
const API = location.protocol === 'file:' ? 'http://localhost:4000' : '';
const TOKEN_KEY = 'toothkart_token';
const $ = id => document.getElementById(id);
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 });
const when = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const LABEL = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const STEPS = ['Placed', 'Accepted', 'Shipped', 'Delivered'];
const STEP_OF = { pending: 0, accepted: 1, shipped: 2, delivered: 3 };

// Build elements with textContent only, so order data can never inject HTML
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3000);
}

let token = localStorage.getItem(TOKEN_KEY);

function showGate(title, text, btn) {
  $('dash').hidden = true;
  $('signOut').hidden = true;
  $('gate').hidden = false;
  $('gateTitle').textContent = title;
  $('gateText').textContent = text;
  $('gateBtn').textContent = btn;
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + '/api' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    showGate('Please sign in', 'Your session has ended. Sign in again to continue.', 'Sign in');
    throw new Error('Signed out');
  }
  if (res.status === 403 && data.error === 'Account blocked') {
    localStorage.removeItem(TOKEN_KEY);
    showGate('Account blocked', 'Your account has been blocked. Please contact support.', 'Back to store');
    $('gateBtn').href = 'index.html';
    throw new Error('Blocked');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- Orders ----------
function paymentText(o) {
  if (o.payment_method === 'COD') {
    return o.payment_status === 'paid' ? 'Cash on delivery · Paid' : `Cash on delivery · Pay ${inr(o.total)} on delivery`;
  }
  return o.payment_status === 'paid' ? 'Prepaid · Payment received' : 'Prepaid · Awaiting payment confirmation';
}

function statusNote(o) {
  if (o.status === 'pending') return 'Waiting for ToothKart to accept your order.';
  if (o.status === 'accepted') return 'Your order has been accepted and is being prepared.';
  if (o.status === 'shipped') return 'Your order is on its way.';
  if (o.status === 'delivered') return 'Delivered. Thank you for shopping with us!';
  if (o.status === 'rejected') return 'Sorry, this order could not be accepted.' + (o.reject_reason ? ` Reason: ${o.reject_reason}` : '');
  return 'This order was cancelled.';
}

function tracker(o) {
  const at = STEP_OF[o.status];
  if (at === undefined) return null;
  return el('ol', { className: 'track-steps' }, ...STEPS.map((s, i) => el('li', { className: i <= at ? 'done' : '', textContent: s })));
}

async function downloadInvoice(o, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/orders/${o.id}/invoice`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not download the invoice');
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: `ToothKart-Invoice-${o.invoice_no}.pdf` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function cancelOrder(o) {
  if (!confirm(`Cancel order #${o.id}? This cannot be undone.`)) return;
  try {
    await api(`/orders/${o.id}/cancel`, { method: 'PATCH' });
    toast(`Order #${o.id} cancelled`);
    loadOrders();
  } catch (err) { if (!['Signed out', 'Blocked'].includes(err.message)) toast(err.message); }
}

function orderCard(o) {
  const actions = el('div', { className: 'ocard-actions' });
  if (['accepted', 'shipped', 'delivered'].includes(o.status)) {
    const b = el('button', { className: 'btn', textContent: '⬇ Download invoice (PDF)' });
    b.onclick = () => downloadInvoice(o, b);
    actions.append(b);
  }
  if (o.status === 'pending') actions.append(el('button', { className: 'btn ghost', textContent: 'Cancel order', onclick: () => cancelOrder(o) }));

  const items = el('ul', { className: 'oitems' }, ...o.items.map(i =>
    el('li', {}, el('span', { textContent: `${i.quantity} × ${i.name}` }), el('b', { textContent: inr(i.unit_price * i.quantity) }))));

  const card = el('article', { className: 'ocard' },
    el('div', { className: 'ocard-head' },
      el('div', {}, el('b', { textContent: `Order #${o.id}` }), el('small', { textContent: ` · ${when(o.created_at)}` })),
      el('span', { className: 'badge s-' + o.status, textContent: LABEL[o.status] })),
    tracker(o) || '',
    el('p', { className: 'onote' + (o.status === 'rejected' || o.status === 'cancelled' ? ' bad' : ''), textContent: statusNote(o) }),
    items,
    el('div', { className: 'ofoot' },
      el('div', { className: 'ship' },
        el('small', { textContent: 'Deliver to' }),
        el('span', { textContent: `${o.ship_name}, ${o.ship_address} - ${o.ship_pincode}` }),
        el('span', { textContent: `Phone: ${o.ship_phone}` }),
        el('span', { className: 'pay-line', textContent: paymentText(o) })),
      el('div', { className: 'ototal' }, el('small', { textContent: 'Order total' }), el('b', { textContent: inr(o.total) }))),
    actions);
  return card;
}

async function loadOrders() {
  const orders = await api('/orders');
  $('orders').replaceChildren(...orders.map(orderCard));
  $('noOrders').hidden = orders.length > 0;
  const spent = orders.filter(o => ['accepted', 'shipped', 'delivered'].includes(o.status)).reduce((s, o) => s + o.total, 0);
  const tiles = [['Orders', orders.length], ['Pending', orders.filter(o => o.status === 'pending').length],
    ['Delivered', orders.filter(o => o.status === 'delivered').length], ['Total spent', inr(Math.round(spent * 100) / 100)]];
  $('stats').replaceChildren(...tiles.map(([k, v]) => el('div', { className: 'tile' }, el('b', { textContent: v }), el('span', { textContent: k }))));
}

// ---------- Tabs, profile, password, sign out ----------
document.querySelectorAll('.tabbtn').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabbtn').forEach(t => t.classList.toggle('on', t === b));
  $('tab-orders').hidden = b.dataset.tab !== 'orders';
  $('tab-profile').hidden = b.dataset.tab !== 'profile';
});

$('pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('pwError').textContent = '';
  const f = Object.fromEntries(new FormData(e.target));
  if (f.next !== f.confirm) return ($('pwError').textContent = 'The new passwords do not match');
  try {
    await api('/auth/password', { method: 'POST', json: { current: f.current, next: f.next } });
    e.target.reset();
    toast('Password updated');
  } catch (err) { $('pwError').textContent = err.message; }
});

$('signOut').onclick = () => {
  localStorage.removeItem(TOKEN_KEY);
  location.href = 'index.html';
};

// ---------- Start ----------
(async () => {
  if (!token) return showGate('Please sign in', 'Sign in to see your orders, download invoices and manage your account.', 'Sign in');
  try {
    const { user } = await api('/auth/me');
    if (user.role === 'admin') return showGate('Admin account', 'This is an admin login. Use the admin dashboard to manage the store.', 'Open admin dashboard'), ($('gateBtn').href = '/admin/');
    $('gate').hidden = true;
    $('dash').hidden = false;
    $('signOut').hidden = false;
    $('hello').textContent = `Hello, ${user.name.split(' ')[0]}`;
    $('sub').textContent = user.email || '+91 ' + user.phone;
    $('pName').textContent = user.name;
    $('pEmail').textContent = user.email || '—';
    $('pPhone').textContent = user.phone ? '+91 ' + user.phone : '—';
    $('pwForm').hidden = !user.email; // mobile-OTP accounts have no password
    $('pSince').textContent = when(user.created_at);
    await loadOrders();
  } catch (err) {
    if (!['Signed out', 'Blocked'].includes(err.message)) showGate('Could not load your account', 'Make sure the store server is running, then refresh this page.', 'Back to store');
  }
})();
