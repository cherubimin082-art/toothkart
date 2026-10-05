const $ = s => document.querySelector(s);
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 });
const when = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const KEY = 'toothkart_admin_token';

let token = sessionStorage.getItem(KEY);
let editingId = null;

// Build elements with textContent only, so names and addresses can never inject HTML
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + token };
  if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const res = await fetch('/api' + path, { ...opts, headers });
  if (res.status === 401) { signOut(); throw new Error('Session expired. Please sign in again.'); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function signOut() {
  token = null;
  sessionStorage.removeItem(KEY);
  $('#app').hidden = true;
  $('#login').hidden = false;
}

// ---------- Login ----------
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const f = new FormData(e.target);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    if (data.user.role !== 'admin') throw new Error('This account is not an admin');
    token = data.token;
    sessionStorage.setItem(KEY, token);
    e.target.reset();
    start(data.user);
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});
$('#logout').onclick = signOut;

// ---------- Change my own password ----------
$('#pwBtn').onclick = () => { $('#pwForm').reset(); $('#pwError').textContent = ''; $('#pwDlg').showModal(); };
$('#pwCancel').onclick = () => $('#pwDlg').close();
$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  $('#pwError').textContent = '';
  if (f.next.value !== f.confirm.value) return ($('#pwError').textContent = 'The two new passwords do not match');
  try {
    await api('/auth/password', { method: 'POST', json: { current: f.current.value, next: f.next.value } });
    $('#pwDlg').close();
    alert('Password updated. Use the new one the next time you sign in.');
  } catch (err) { $('#pwError').textContent = err.message; }
});

async function start(user) {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = user.email;
  await Promise.all([loadStats(), loadCategories(), loadBrands(), loadProducts()]);
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === b));
  $('#tab-products').hidden = b.dataset.tab !== 'products';
  $('#tab-categories').hidden = b.dataset.tab !== 'categories';
  $('#tab-brands').hidden = b.dataset.tab !== 'brands';
  $('#tab-orders').hidden = b.dataset.tab !== 'orders';
  $('#tab-suggestions').hidden = b.dataset.tab !== 'suggestions';
  $('#tab-users').hidden = b.dataset.tab !== 'users';
  if (b.dataset.tab === 'suggestions') loadSuggestions();
  if (b.dataset.tab === 'users') loadUsers();
  if (b.dataset.tab === 'categories') loadCategories();
  if (b.dataset.tab === 'brands') loadBrands();
  if (b.dataset.tab === 'orders') loadOrders();
});

// ---------- Stats ----------
async function loadStats() {
  const s = await api('/admin/stats');
  const items = [['Pending orders', s.pendingOrders, 'orders'], ['New suggestions', s.newSuggestions, 'suggestions'], ['Orders', s.orders], ['Revenue', inr(s.revenue)],
    ['Customers', s.customers], ['Blocked users', s.blockedUsers], ['Products', s.products], ['On offer', s.onOffer],
    ['Low stock (≤5)', s.lowStock], ['Units in carts', s.cartItems]];
  // A tile with a tab name turns red and jumps to that tab when it has something waiting
  $('#stats').replaceChildren(...items.map(([label, v, tab]) => {
    const hot = tab && v > 0;
    return el('div', { className: 'stat' + (hot ? ' hot' : ''), onclick: hot ? () => document.querySelector(`[data-tab=${tab}]`).click() : null },
      el('b', { textContent: v }), el('span', { textContent: label }));
  }));
}

// ---------- Products ----------
async function loadProducts() {
  try {
    const q = $('#search').value.trim();
    const data = await api('/products?limit=50' + (q ? '&q=' + encodeURIComponent(q) : ''));
    $('#empty').hidden = data.products.length > 0;
    $('#rows').replaceChildren(...data.products.map(row));
  } catch (err) { alert(err.message); }
}

function row(p) {
  const thumb = p.image_url ? el('img', { src: p.image_url, alt: '', onerror: e => e.target.replaceWith(el('div', { className: 'thumb-empty' })) }) : el('div', { className: 'thumb-empty' });
  const edit = el('button', { textContent: 'Edit', onclick: () => openForm(p) });
  const del = el('button', { className: 'del', textContent: 'Delete', onclick: () => remove(p) });
  return el('tr', {},
    el('td', {}, thumb),
    el('td', { textContent: p.name + (p.brand ? ' · ' + p.brand : '') }),
    el('td', { textContent: p.category || '—' }),
    el('td', { textContent: inr(p.price) }),
    el('td', { textContent: p.discount_percent ? p.discount_percent + '%' : '—' }),
    el('td', { textContent: inr(p.final_price) }),
    el('td', {}, el('span', { className: 'badge' + (p.stock <= 5 ? ' low' : ''), textContent: p.stock })),
    el('td', {}, el('div', { className: 'row-actions' }, edit, del)));
}

async function remove(p) {
  if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
  try { await api('/products/' + p.id, { method: 'DELETE' }); await Promise.all([loadProducts(), loadStats()]); }
  catch (err) { alert(err.message); }
}

let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadProducts, 250); });

// ---------- Product form ----------
const form = $('#productForm');
function updateFinal() {
  const price = Number(form.price.value), d = Number(form.discount_percent.value) || 0;
  $('#finalPrice').value = form.price.value === '' ? '' : inr(price * (1 - d / 100));
}
form.price.addEventListener('input', updateFinal);
form.discount_percent.addEventListener('input', updateFinal);

form.image.addEventListener('change', () => {
  const f = form.image.files[0];
  $('#preview').hidden = !f;
  if (f) $('#preview').src = URL.createObjectURL(f);
});

function openForm(p) {
  editingId = p ? p.id : null;
  form.reset();
  $('#formError').textContent = '';
  $('#dlgTitle').textContent = p ? 'Edit product' : 'Add product';
  fillCategorySelect(p ? p.category : '');
  fillBrandSelect(p ? p.brand : '');
  if (p) for (const k of ['name', 'description', 'price', 'discount_percent', 'stock']) form[k].value = p[k] ?? '';
  $('#preview').hidden = !(p && p.image_url);
  if (p && p.image_url) $('#preview').src = p.image_url;
  updateFinal();
  $('#dlg').showModal();
}
$('#newBtn').onclick = () => openForm(null);
$('#cancel').onclick = () => $('#dlg').close();

form.addEventListener('submit', async e => {
  e.preventDefault();
  $('#formError').textContent = '';
  const body = new FormData(form);
  if (!form.image.files[0]) body.delete('image'); // keep the existing image when editing
  try {
    await api(editingId ? '/products/' + editingId : '/products', { method: editingId ? 'PUT' : 'POST', body });
    $('#dlg').close();
    await Promise.all([loadProducts(), loadStats()]);
  } catch (err) { $('#formError').textContent = err.message; }
});

// ---------- Categories ----------
let categories = [];
const NEW_CAT = '__new__';
let catEditing = null;       // the category being edited, or null when adding
let afterCatSaved = null;    // what to do with the saved category (used by the product form)

async function loadCategories() {
  try {
    categories = await api('/categories');
    renderCategories();
  } catch (err) { alert(err.message); }
}

function renderCategories() {
  $('#noCats').hidden = categories.length > 0;
  $('#catRows').replaceChildren(...categories.map(c => {
    const act = (label, cls, fn) => el('button', { className: 'act ' + cls, textContent: label, onclick: fn });
    return el('tr', {},
      el('td', { className: 'cat-icon', textContent: c.icon }),
      el('td', {}, el('b', { textContent: c.name })),
      el('td', {}, el('span', { className: 'badge ' + (c.products ? 'ok' : 'warn'), textContent: c.products ? `${c.products} product${c.products === 1 ? '' : 's'}` : 'Empty' })),
      el('td', {}, el('div', { className: 'order-actions' }, act('Edit', 'alt', () => openCatForm(c)), act('Delete', 'no', () => deleteCategory(c)))));
  }));
}

// The product form's dropdown: every category, plus a shortcut to add a new one
function fillCategorySelect(selected) {
  const sel = $('#catSelect');
  const names = categories.map(c => c.name);
  const opts = [el('option', { value: '', textContent: 'Choose a category…', disabled: true })];
  if (selected && !names.includes(selected)) opts.push(el('option', { value: selected, textContent: selected + ' (not in list)' }));
  opts.push(...categories.map(c => el('option', { value: c.name, textContent: `${c.icon} ${c.name}` })));
  opts.push(el('option', { value: NEW_CAT, textContent: '+ Add new category…' }));
  sel.replaceChildren(...opts);
  sel.value = selected || '';
  sel.dataset.last = sel.value;
}

$('#catSelect').addEventListener('change', e => {
  const sel = e.target;
  if (sel.value !== NEW_CAT) { sel.dataset.last = sel.value; return; }
  sel.value = sel.dataset.last || '';              // go back to the previous choice until the new one is saved
  afterCatSaved = c => fillCategorySelect(c.name);
  openCatForm(null);
});

function openCatForm(c) {
  catEditing = c;
  $('#catForm').reset();
  $('#catError').textContent = '';
  $('#catDlgTitle').textContent = c ? 'Edit category' : 'Add category';
  if (c) { $('#catForm').name.value = c.name; $('#catForm').icon.value = c.icon; }
  $('#catDlg').showModal();
}
$('#newCatBtn').onclick = () => { afterCatSaved = null; openCatForm(null); };
$('#catCancel').onclick = () => { afterCatSaved = null; $('#catDlg').close(); };

$('#catForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#catError').textContent = '';
  const f = e.target;
  try {
    const saved = await api(catEditing ? '/categories/' + catEditing.id : '/categories', { method: catEditing ? 'PATCH' : 'POST', json: { name: f.name.value, icon: f.icon.value } });
    $('#catDlg').close();
    await Promise.all([loadCategories(), loadProducts()]);
    if (afterCatSaved) afterCatSaved(saved);
    afterCatSaved = null;
  } catch (err) { $('#catError').textContent = err.message; }
});

async function deleteCategory(c) {
  const note = c.products ? `\n\nIts ${c.products} product${c.products === 1 ? '' : 's'} will be kept but left without a category.` : '';
  if (!confirm(`Delete the category "${c.name}"?${note}`)) return;
  try {
    await api('/categories/' + c.id, { method: 'DELETE' });
    await Promise.all([loadCategories(), loadProducts()]);
  } catch (err) { alert(err.message); }
}

// ---------- Brands ----------
let brands = [];
const NEW_BRAND = '__newbrand__';
let brandEditing = null;     // the brand being renamed, or null when adding
let afterBrandSaved = null;  // what to do with the saved brand (used by the product form)

async function loadBrands() {
  try {
    brands = await api('/brands');
    renderBrands();
  } catch (err) { alert(err.message); }
}

function renderBrands() {
  $('#noBrands').hidden = brands.length > 0;
  $('#brandRows').replaceChildren(...brands.map(b => {
    const act = (label, cls, fn) => el('button', { className: 'act ' + cls, textContent: label, onclick: fn });
    return el('tr', {},
      el('td', {}, el('b', { textContent: b.name })),
      el('td', {}, el('span', { className: 'badge ' + (b.products ? 'ok' : 'warn'), textContent: b.products ? `${b.products} product${b.products === 1 ? '' : 's'}` : 'Empty' })),
      el('td', {}, el('div', { className: 'order-actions' }, act('Edit', 'alt', () => openBrandForm(b)), act('Delete', 'no', () => deleteBrand(b)))));
  }));
}

// The product form's brand dropdown: optional, with a shortcut to add a new brand
function fillBrandSelect(selected) {
  const sel = $('#brandSelect');
  const opts = [el('option', { value: '', textContent: 'No brand' })];
  if (selected && !brands.some(b => b.name === selected)) opts.push(el('option', { value: selected, textContent: selected + ' (not in list)' }));
  opts.push(...brands.map(b => el('option', { value: b.name, textContent: b.name })));
  opts.push(el('option', { value: NEW_BRAND, textContent: '+ Add new brand…' }));
  sel.replaceChildren(...opts);
  sel.value = selected || '';
  sel.dataset.last = sel.value;
}

$('#brandSelect').addEventListener('change', e => {
  const sel = e.target;
  if (sel.value !== NEW_BRAND) { sel.dataset.last = sel.value; return; }
  sel.value = sel.dataset.last || '';              // go back to the previous choice until the new one is saved
  afterBrandSaved = b => fillBrandSelect(b.name);
  openBrandForm(null);
});

function openBrandForm(b) {
  brandEditing = b;
  $('#brandForm').reset();
  $('#brandError').textContent = '';
  $('#brandDlgTitle').textContent = b ? 'Edit brand' : 'Add brand';
  if (b) $('#brandForm').name.value = b.name;
  $('#brandDlg').showModal();
}
$('#newBrandBtn').onclick = () => { afterBrandSaved = null; openBrandForm(null); };
$('#brandCancel').onclick = () => { afterBrandSaved = null; $('#brandDlg').close(); };

$('#brandForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#brandError').textContent = '';
  try {
    const saved = await api(brandEditing ? '/brands/' + brandEditing.id : '/brands', { method: brandEditing ? 'PATCH' : 'POST', json: { name: e.target.name.value } });
    $('#brandDlg').close();
    await Promise.all([loadBrands(), loadProducts()]);
    if (afterBrandSaved) afterBrandSaved(saved);
    afterBrandSaved = null;
  } catch (err) { $('#brandError').textContent = err.message; }
});

async function deleteBrand(b) {
  const note = b.products ? `\n\nIts ${b.products} product${b.products === 1 ? '' : 's'} will be kept but left without a brand.` : '';
  if (!confirm(`Delete the brand "${b.name}"?${note}`)) return;
  try {
    await api('/brands/' + b.id, { method: 'DELETE' });
    await Promise.all([loadBrands(), loadProducts()]);
  } catch (err) { alert(err.message); }
}

// ---------- Orders: accept / reject / ship / deliver / cancel, payment, PDF invoice ----------
const FILTERS = ['all', 'pending', 'accepted', 'shipped', 'delivered', 'rejected', 'cancelled'];
let orderFilter = 'pending';
let allOrders = [];

async function loadOrders() {
  try {
    allOrders = await api('/orders/admin/all');
    renderOrders();
  } catch (err) { alert(err.message); }
}

function renderOrders() {
  const count = f => (f === 'all' ? allOrders.length : allOrders.filter(o => o.status === f).length);
  $('#orderFilters').replaceChildren(...FILTERS.map(f =>
    el('button', { className: 'chip' + (f === orderFilter ? ' on' : ''), textContent: `${f[0].toUpperCase() + f.slice(1)} (${count(f)})`, onclick: () => { orderFilter = f; renderOrders(); } })));
  const shown = orderFilter === 'all' ? allOrders : allOrders.filter(o => o.status === orderFilter);
  $('#noOrders').hidden = shown.length > 0;
  $('#orderRows').replaceChildren(...shown.map(orderRow));
}

function orderRow(o) {
  const payBadge = el('span', { className: 'badge ' + (o.payment_status === 'paid' ? 'ok' : 'warn'), textContent: o.payment_status === 'paid' ? 'Paid' : 'Unpaid' });
  const act = (label, cls, fn) => el('button', { className: 'act ' + cls, textContent: label, onclick: fn });
  const actions = el('div', { className: 'order-actions' });
  if (o.status === 'pending') actions.append(act('✓ Accept', 'go', () => setStatus(o, 'accepted')), act('✕ Reject', 'no', () => reject(o)));
  if (o.status === 'accepted') actions.append(act('Ship', 'go', () => setStatus(o, 'shipped')), act('Cancel', 'no', () => setStatus(o, 'cancelled')));
  if (o.status === 'shipped') actions.append(act('Mark delivered', 'go', () => setStatus(o, 'delivered')));
  if (o.payment_method === 'PREPAID' && o.payment_status === 'unpaid' && ['accepted', 'shipped', 'delivered'].includes(o.status)) {
    actions.append(act('Mark paid', 'alt', () => setPayment(o, 'paid')));
  }
  if (['accepted', 'shipped', 'delivered'].includes(o.status)) {
    const inv = act('⬇ Invoice PDF', 'alt', () => downloadInvoice(o, inv));
    actions.append(inv);
  }
  return el('tr', {},
    el('td', {}, el('b', { textContent: '#' + o.id }), el('div', { className: 'sub', textContent: when(o.created_at) })),
    el('td', {}, el('b', { textContent: o.customer_name || 'Unknown' }), el('div', { className: 'sub', textContent: o.customer_email || '' }),
      ...(o.account_removed ? [el('span', { className: 'badge bad', textContent: 'Account removed' })] : [])),
    el('td', { className: 'wide' }, el('b', { textContent: o.ship_name }), el('div', { className: 'sub', textContent: `${o.ship_address} - ${o.ship_pincode}` }),
      el('div', { className: 'sub', textContent: 'Phone: ' + o.ship_phone })),
    el('td', { className: 'wide', textContent: o.items.map(i => `${i.quantity}× ${i.name}`).join(', ') }),
    el('td', {}, el('b', { textContent: o.payment_method === 'COD' ? 'Cash on delivery' : 'Prepaid' }), el('div', {}, payBadge)),
    el('td', { textContent: inr(o.total) }),
    el('td', {}, el('span', { className: 'badge s-' + o.status, textContent: o.status }),
      ...(o.reject_reason ? [el('div', { className: 'sub', textContent: 'Reason: ' + o.reject_reason })] : [])),
    el('td', {}, actions));
}

async function setStatus(o, status, reason) {
  if (status === 'cancelled' && !confirm(`Cancel order #${o.id}? The stock goes back to the shelf and this cannot be undone.`)) return;
  try {
    await api(`/orders/${o.id}/status`, { method: 'PATCH', json: { status, reason } });
    await Promise.all([loadOrders(), loadStats(), loadProducts()]);
  } catch (err) { alert(err.message); }
}

function reject(o) {
  const reason = prompt(`Reject order #${o.id} from ${o.customer_name}?\n\nReason (shown to the customer, optional):`);
  if (reason === null) return; // cancelled the prompt
  setStatus(o, 'rejected', reason);
}

async function setPayment(o, payment_status) {
  try {
    await api(`/orders/${o.id}/payment`, { method: 'PATCH', json: { payment_status } });
    await loadOrders();
  } catch (err) { alert(err.message); }
}

// The invoice endpoint needs the sign-in token, so fetch it and save the result as a PDF download
async function downloadInvoice(o, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(`/api/orders/${o.id}/invoice`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not create the invoice');
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: `ToothKart-Invoice-${o.invoice_no}.pdf` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) { alert(err.message); }
  btn.disabled = false;
}

// ---------- Suggestions ----------
async function loadSuggestions() {
  try {
    const list = await api('/suggestions');
    $('#noSuggest').hidden = list.length > 0;
    $('#suggestRows').replaceChildren(...list.map(s => {
      const act = (label, cls, fn) => el('button', { className: 'act ' + cls, textContent: label, onclick: fn });
      const actions = el('div', { className: 'order-actions' });
      if (s.status === 'new') actions.append(act('Mark reviewed', 'alt', () => setSuggestion(s, 'reviewed')));
      if (s.status !== 'done') actions.append(act('✓ Done', 'go', () => setSuggestion(s, 'done')));
      if (s.status !== 'new') actions.append(act('Reopen', 'alt', () => setSuggestion(s, 'new')));
      actions.append(act('Delete', 'no', () => deleteSuggestion(s)));
      // Only http(s) links become clickable, so a pasted "javascript:" address can never run
      const link = s.url && /^https?:\/\//i.test(s.url)
        ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', textContent: s.url.replace(/^https?:\/\//i, '').slice(0, 30) + (s.url.length > 38 ? '…' : '') })
        : '—';
      return el('tr', {},
        el('td', {}, el('div', { textContent: when(s.created_at) })),
        el('td', { className: 'wide' }, el('b', { textContent: s.product_name })),
        el('td', { textContent: s.brand || '—' }),
        el('td', {}, link),
        el('td', {}, el('div', { textContent: s.user_name || 'Visitor' }), el('div', { className: 'sub', textContent: s.email || 'no email' })),
        el('td', { className: 'wide', textContent: s.comment || '—' }),
        el('td', {}, el('span', { className: 'badge ' + (s.status === 'done' ? 'ok' : s.status === 'new' ? 'warn' : 's-accepted'), textContent: s.status })),
        el('td', {}, actions));
    }));
  } catch (err) { alert(err.message); }
}

async function setSuggestion(s, status) {
  try { await api('/suggestions/' + s.id, { method: 'PATCH', json: { status } }); await Promise.all([loadSuggestions(), loadStats()]); }
  catch (err) { alert(err.message); }
}

async function deleteSuggestion(s) {
  if (!confirm(`Delete the suggestion "${s.product_name}"? This cannot be undone.`)) return;
  try { await api('/suggestions/' + s.id, { method: 'DELETE' }); await Promise.all([loadSuggestions(), loadStats()]); }
  catch (err) { alert(err.message); }
}

// ---------- Users: block / unblock / remove ----------
let allUsers = [];

async function loadUsers() {
  try {
    allUsers = await api('/admin/users');
    renderUsers();
  } catch (err) { alert(err.message); }
}

function renderUsers() {
  const q = $('#userSearch').value.trim().toLowerCase();
  const shown = allUsers.filter(u => !q || u.name.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phone || '').includes(q));
  $('#noUsers').hidden = shown.length > 0;
  $('#userRows').replaceChildren(...shown.map(u => {
    const actions = el('div', { className: 'order-actions' });
    if (u.role === 'customer') {
      actions.append(
        el('button', { className: 'act ' + (u.blocked ? 'go' : 'no'), textContent: u.blocked ? 'Unblock' : 'Block', onclick: () => blockUser(u, !u.blocked) }),
        el('button', { className: 'act no', textContent: 'Remove', onclick: () => removeUser(u) }));
    } else {
      actions.append(el('span', { className: 'sub', textContent: 'Protected' }));
    }
    return el('tr', {},
      el('td', { textContent: u.id }), el('td', { textContent: u.name }), el('td', { textContent: u.email || '—' }),
      el('td', { textContent: u.phone ? '+91 ' + u.phone : '—' }), el('td', { textContent: u.role }),
      el('td', {}, el('span', { className: 'badge ' + (u.blocked ? 'bad' : 'ok'), textContent: u.blocked ? 'Blocked' : 'Active' })),
      el('td', { textContent: u.orders }), el('td', { textContent: when(u.created_at) }), el('td', {}, actions));
  }));
}
$('#userSearch').addEventListener('input', renderUsers);

async function blockUser(u, blocked) {
  const msg = blocked
    ? `Block ${u.name} (${u.email || u.phone})?\n\nThey will be signed out immediately and cannot sign in until you unblock them.`
    : `Unblock ${u.name}? They will be able to sign in again.`;
  if (!confirm(msg)) return;
  try {
    await api(`/admin/users/${u.id}/block`, { method: 'PATCH', json: { blocked } });
    await Promise.all([loadUsers(), loadStats()]);
  } catch (err) { alert(err.message); }
}

async function removeUser(u) {
  if (!confirm(`Remove ${u.name} (${u.email || u.phone}) permanently?\n\nTheir account and cart are deleted and cannot be restored. Their past orders stay in the Orders tab.`)) return;
  try {
    await api('/admin/users/' + u.id, { method: 'DELETE' });
    await Promise.all([loadUsers(), loadStats()]);
  } catch (err) { alert(err.message); }
}

// ---------- Resume session ----------
if (token) {
  api('/auth/me').then(d => d.user.role === 'admin' ? start(d.user) : signOut()).catch(() => {});
}
