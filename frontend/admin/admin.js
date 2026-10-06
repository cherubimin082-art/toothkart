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
  $('#tab-returns').hidden = b.dataset.tab !== 'returns';
  $('#tab-revenue').hidden = b.dataset.tab !== 'revenue';
  if (b.dataset.tab === 'revenue') loadRevenue();
  $('#tab-suggestions').hidden = b.dataset.tab !== 'suggestions';
  $('#tab-users').hidden = b.dataset.tab !== 'users';
  if (b.dataset.tab === 'returns') loadOrders();
  if (b.dataset.tab === 'suggestions') loadSuggestions();
  if (b.dataset.tab === 'users') loadUsers();
  if (b.dataset.tab === 'categories') loadCategories();
  if (b.dataset.tab === 'brands') loadBrands();
  if (b.dataset.tab === 'orders') loadOrders();
});

// ---------- Stats ----------
async function loadStats() {
  const s = await api('/admin/stats');
  const items = [['Pending orders', s.pendingOrders, 'orders'], ['Pending returns', s.pendingReturns, 'returns'], ['New suggestions', s.newSuggestions, 'suggestions'], ['Orders', s.orders], ['Revenue', inr(s.revenue), 'revenue'],
    ['Customers', s.customers], ['Blocked users', s.blockedUsers], ['Products', s.products], ['On offer', s.onOffer],
    ['Low stock (≤5)', s.lowStock], ['Units in carts', s.cartItems]];
  // A tile with a tab name turns red and jumps to that tab when it has something waiting
  $('#stats').replaceChildren(...items.map(([label, v, tab]) => {
    const hot = tab && tab !== 'revenue' && v > 0;
    return el('div', { className: 'stat' + (hot ? ' hot' : ''), onclick: hot || tab === 'revenue' ? () => document.querySelector(`[data-tab=${tab}]`).click() : null },
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
  // profit on one unit = selling price after discount minus cost
  const cost = form.cost_price.value;
  const unit = price * (1 - d / 100) - Number(cost);
  $('#unitProfit').value = cost === '' || form.price.value === '' ? '' : `${inr(unit)} (${price ? Math.round((unit / (price * (1 - d / 100) || 1)) * 100) : 0}%)`;
}
form.price.addEventListener('input', updateFinal);
form.discount_percent.addEventListener('input', updateFinal);
form.cost_price.addEventListener('input', updateFinal);

// ---- Images: existing ones (can be removed or made main) plus the files just picked ----
const MAX_IMAGES = 8;
let keptImages = [];      // images already saved for this product, in order: [{ id, url }]
let removedIds = [];      // saved images the admin removed
let mainId = null;        // saved image chosen as the main picture
let newPreviews = [];     // object URLs of the picked files
let pickedFiles = [];     // files picked so far; every pick is added to this list instead of replacing it

function renderGallery() {
  newPreviews.forEach(u => URL.revokeObjectURL(u));
  const files = pickedFiles;
  newPreviews = files.map(f => URL.createObjectURL(f));
  const show = keptImages.length + files.length > 0;
  $('#galleryEdit').hidden = !show;
  const total = keptImages.length + files.length;
  $('#galleryHint').textContent = total > MAX_IMAGES
    ? `Too many images: ${total}. The most is ${MAX_IMAGES}.`
    : `${total} of ${MAX_IMAGES} images. ` + (keptImages.length ? 'Use “Make main” to choose the first picture, or ✕ to remove one.' : '');
  const mainSaved = keptImages.find(i => i.id === mainId) || keptImages[0];
  $('#thumbs').replaceChildren(
    ...keptImages.map(i => {
      const isMain = mainSaved && i.id === mainSaved.id;
      return el('li', { className: isMain ? 'is-main' : '' },
        el('img', { src: i.url, alt: '' }),
        isMain ? el('span', { className: 'tag', textContent: 'Main' }) : el('button', { type: 'button', className: 'mk', textContent: 'Make main', onclick: () => { mainId = i.id; renderGallery(); } }),
        el('button', { type: 'button', className: 'rm', textContent: '✕', 'aria-label': 'Remove this image', onclick: () => { removedIds.push(i.id); keptImages = keptImages.filter(k => k !== i); renderGallery(); } }));
    }),
    ...newPreviews.map((u, k) => el('li', { className: !keptImages.length && k === 0 ? 'is-main' : '' },
      el('img', { src: u, alt: '' }), el('span', { className: 'tag new', textContent: !keptImages.length && k === 0 ? 'Main · new' : 'New' }),
      el('button', { type: 'button', className: 'rm', textContent: '✕', 'aria-label': 'Remove this image', onclick: () => { pickedFiles = pickedFiles.filter((_, j) => j !== k); renderGallery(); } }))));
}
// Each pick adds to the list (a plain file input would forget the earlier pick)
form.images.addEventListener('change', () => {
  for (const f of form.images.files) {
    if (!pickedFiles.some(p => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified)) pickedFiles.push(f);
  }
  form.images.value = '';
  renderGallery();
  $('#galleryEdit').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // show the pictures that were just added
});

function openForm(p) {
  editingId = p ? p.id : null;
  form.reset();
  keptImages = p ? [...(p.images || [])] : [];
  pickedFiles = [];
  removedIds = [];
  mainId = null;
  $('#formError').textContent = '';
  $('#dlgTitle').textContent = p ? 'Edit product' : 'Add product';
  fillCategorySelect(p ? p.category : '');
  fillBrandSelect(p ? p.brand : '');
  if (p) for (const k of ['name', 'description', 'price', 'discount_percent', 'stock', 'cost_price']) form[k].value = p[k] ?? '';
  renderGallery();
  updateFinal();
  $('#dlg').showModal();
}
$('#newBtn').onclick = () => openForm(null);
$('#cancel').onclick = () => $('#dlg').close();

form.addEventListener('submit', async e => {
  e.preventDefault();
  $('#formError').textContent = '';
  if (keptImages.length + pickedFiles.length > MAX_IMAGES) return ($('#formError').textContent = `A product can have at most ${MAX_IMAGES} images`);
  // Hosting limits the size of one request (about 4.5 MB on Vercel), so images are sent in small batches:
  // the first request saves the product details with the first batch, later requests add the rest.
  const BATCH_BYTES = 3.5 * 1024 * 1024;
  const batches = [[]];
  let size = 0;
  for (const f of pickedFiles) {
    if (batches.at(-1).length && size + f.size > BATCH_BYTES) { batches.push([]); size = 0; }
    batches.at(-1).push(f);
    size += f.size;
  }
  const submit = $('#productForm button[type=submit]');
  submit.disabled = true;
  try {
    const body = new FormData(form);
    body.delete('images');
    for (const f of batches[0]) body.append('images', f);
    if (editingId) {
      body.set('remove_images', JSON.stringify(removedIds));
      if (mainId) body.set('main_image', mainId);
    }
    const saved = await api(editingId ? '/products/' + editingId : '/products', { method: editingId ? 'PUT' : 'POST', body });
    // The product now exists (and the removals are done): if a later batch fails, Save carries on from there
    editingId = saved.id;
    keptImages = saved.images;
    removedIds = [];
    mainId = null;
    pickedFiles = pickedFiles.filter(f => !batches[0].includes(f));
    for (let k = 1; k < batches.length; k++) {
      submit.textContent = `Uploading images… ${k + 1}/${batches.length}`;
      const more = new FormData();
      for (const f of batches[k]) more.append('images', f);
      const res = await api('/products/' + editingId, { method: 'PUT', body: more });
      keptImages = res.images;
      pickedFiles = pickedFiles.filter(f => !batches[k].includes(f));
    }
    $('#dlg').close();
    await Promise.all([loadProducts(), loadStats()]);
  } catch (err) {
    $('#formError').textContent = err.message + (editingId ? ' (the product was saved; press Save to retry the remaining images)' : '');
    renderGallery();
    loadProducts();
  } finally {
    submit.disabled = false;
    submit.textContent = 'Save';
  }
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
  renderReturns();
}

// ---------- Returns: approve / reject, then mark refunded ----------
const RETURN_FILTERS = ['requested', 'approved', 'refunded', 'rejected', 'all'];
let returnFilter = 'requested';

function renderReturns() {
  const all = allOrders.filter(o => o.return_request);
  const count = f => (f === 'all' ? all.length : all.filter(o => o.return_request.status === f).length);
  $('#returnFilters').replaceChildren(...RETURN_FILTERS.map(f =>
    el('button', { className: 'chip' + (f === returnFilter ? ' on' : ''), textContent: `${f[0].toUpperCase() + f.slice(1)} (${count(f)})`, onclick: () => { returnFilter = f; renderReturns(); } })));
  const shown = (returnFilter === 'all' ? all : all.filter(o => o.return_request.status === returnFilter))
    .sort((a, b) => String(b.return_request.created_at).localeCompare(a.return_request.created_at));
  $('#noReturns').hidden = shown.length > 0;
  $('#returnRows').replaceChildren(...shown.map(returnRow));
}

function returnRow(o) {
  const r = o.return_request;
  const act = (label, cls, fn) => el('button', { className: 'act ' + cls, textContent: label, onclick: fn });
  const actions = el('div', { className: 'order-actions' });
  if (r.status === 'requested') actions.append(act('✓ Approve', 'go', () => setReturn(o, 'approved')), act('✕ Reject', 'no', () => rejectReturn(o)));
  if (r.status === 'approved') actions.append(act('Mark refunded', 'go', () => setReturn(o, 'refunded')));
  const refundTo = o.payment_method === 'COD' ? 'Refund to bank account / UPI' : 'Refund to original payment method';
  return el('tr', {},
    el('td', {}, el('b', { textContent: '#' + o.id }), el('div', { className: 'sub', textContent: 'Delivered ' + when(o.delivered_at || o.created_at) })),
    el('td', {}, el('b', { textContent: o.customer_name || 'Unknown' }), el('div', { className: 'sub', textContent: o.customer_email || '' }),
      el('div', { className: 'sub', textContent: 'Phone: ' + o.ship_phone })),
    el('td', { className: 'wide', textContent: o.items.map(i => `${i.quantity}× ${i.name}`).join(', ') }),
    el('td', { textContent: inr(o.total) }),
    el('td', {}, el('b', { textContent: o.payment_method === 'COD' ? 'Cash on delivery' : 'Prepaid' }), el('div', { className: 'sub', textContent: refundTo })),
    el('td', { className: 'wide' }, el('b', { textContent: r.reason }), ...(r.details ? [el('div', { className: 'sub', textContent: r.details })] : []),
      ...(r.admin_note ? [el('div', { className: 'sub', textContent: 'Your note: ' + r.admin_note })] : [])),
    el('td', { textContent: when(r.created_at) }),
    el('td', {}, el('span', { className: 'badge ' + (r.status === 'rejected' ? 'bad' : r.status === 'requested' ? 'warn' : 'ok'), textContent: r.status })),
    el('td', {}, actions));
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
      ...(o.reject_reason ? [el('div', { className: 'sub', textContent: 'Reason: ' + o.reject_reason })] : []),
      ...returnInfo(o)),
    el('td', {}, actions));
}

// On the Orders tab a return only shows its status; it is handled in the Returns tab
function returnInfo(o) {
  const r = o.return_request;
  if (!r) return [];
  return [el('div', { className: 'sub' }, el('span', { className: 'badge ' + (r.status === 'rejected' ? 'bad' : r.status === 'requested' ? 'warn' : 'ok'), textContent: 'Return: ' + r.status }))];
}

async function setReturn(o, status, note) {
  if (status === 'refunded' && !confirm(`Mark the return for order #${o.id} as refunded? Pay the customer ${inr(o.total)} (${o.payment_method === 'COD' ? 'to their bank/UPI' : 'to the original payment method'}) first.`)) return;
  try {
    await api(`/orders/${o.id}/return`, { method: 'PATCH', json: { status, note } });
    await Promise.all([loadOrders(), loadStats()]);
  } catch (err) { alert(err.message); }
}

function rejectReturn(o) {
  const note = prompt(`Reject the return for order #${o.id}?\n\nReason (shown to the customer, optional):`);
  if (note === null) return;
  setReturn(o, 'rejected', note);
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

// ---------- Revenue & profit ----------
const REV_RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '12 months'], ['all', 'All time']];
let revRange = '30';
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};
const pct = v => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%');
const money = v => (v === null || v === undefined ? '—' : inr(v));

async function loadRevenue() {
  $('#revRanges').replaceChildren(...REV_RANGES.map(([k, label]) =>
    el('button', { className: 'chip' + (k === revRange ? ' on' : ''), textContent: label, onclick: () => { revRange = k; loadRevenue(); } })));
  try {
    renderRevenue(await api('/admin/analytics?range=' + revRange));
  } catch (err) { alert(err.message); }
}

function renderRevenue(d) {
  const c = d.current, label = REV_RANGES.find(r => r[0] === d.range)[1];
  const hasCost = c.coverage !== null && c.coverage > 0;

  // Warn when profit is not based on all sales
  const notice = $('#revNotice');
  const parts = [];
  if (d.inventory.missing_cost > 0) parts.push(`${d.inventory.missing_cost} of ${d.inventory.products} products have no cost price`);
  if (c.revenue > 0 && (c.coverage === null || c.coverage < 99.9)) parts.push(hasCost ? `profit covers ${pct(c.coverage)} of this period's sales` : 'no sales in this period have a cost price, so profit cannot be shown');
  notice.hidden = parts.length === 0;
  notice.replaceChildren(el('b', { textContent: 'Profit needs cost prices. ' }), parts.join('; ') + '. Open Products → Edit and fill in “Cost price” to complete the picture.');

  // Tiles
  const delta = v => (v === null || v === undefined ? null : el('small', { className: v >= 0 ? 'up' : 'down', textContent: `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}% vs previous ${label}` }));
  const tile = (title, value, sub, cls = '') => el('div', { className: 'rv-kpi ' + cls }, el('span', { textContent: title }), el('b', { textContent: value }), ...(sub ? [typeof sub === 'string' ? el('small', { textContent: sub }) : sub] : []));
  $('#revKpis').replaceChildren(
    tile('Revenue', inr(c.revenue), delta(d.changes && d.changes.revenue) || `${c.orders} order${c.orders === 1 ? '' : 's'}`, 'main'),
    tile('Total profit', hasCost ? inr(c.profit) : '—', hasCost ? (delta(d.changes && d.changes.profit) || `Margin ${pct(c.margin)}`) : 'Add cost prices', 'profit'),
    tile('Profit margin', hasCost ? pct(c.margin) : '—', hasCost ? `On ${pct(c.coverage)} of sales` : null),
    tile('Orders', String(c.orders), delta(d.changes && d.changes.orders) || null),
    tile('Average order value', inr(c.avg_order)),
    tile('Units sold', String(c.units)),
    tile('Cost of goods', hasCost ? inr(c.cost) : '—'),
    tile('Discounts given', inr(c.discounts), 'Offers & discounts customers used'),
    tile('Refunded', inr(d.returns.refunded_amount), `${d.returns.refunded_orders} order${d.returns.refunded_orders === 1 ? '' : 's'} refunded`));

  // Chart
  $('#revChartTitle').textContent = `${d.granularity === 'month' ? 'Monthly' : 'Daily'} revenue and profit`;
  $('#revChart').replaceChildren(buildChart(d.series, d.granularity, hasCost));

  // Breakdown lists
  const rows = (list, withProfit = true) => {
    if (!list.length) return el('p', { className: 'muted', textContent: 'No sales in this period.' });
    const top = Math.max(...list.map(r => r.revenue), 1);
    return el('ul', { className: 'rv-list' }, ...list.map(r => el('li', {},
      el('div', { className: 'rv-row' }, el('span', { className: 'rv-name', textContent: r.label, title: r.label }),
        el('span', { className: 'rv-num', textContent: inr(r.revenue) }),
        ...(withProfit ? [el('span', { className: 'rv-num pro' + (r.profit === null ? ' na' : r.profit < 0 ? ' neg' : ''), textContent: r.profit === null ? 'no cost' : inr(r.profit) })] : [])),
      el('div', { className: 'rv-bar' }, el('i', { style: `width:${Math.max(2, (r.revenue / top) * 100)}%` })),
      el('small', { className: 'muted', textContent: `${r.units} unit${r.units === 1 ? '' : 's'}` }))));
  };
  $('#revProducts').replaceChildren(rows(d.top_products));
  $('#revCategories').replaceChildren(rows(d.categories));
  $('#revBrands').replaceChildren(rows(d.brands));

  const split = c.cod + c.prepaid;
  $('#revPayments').replaceChildren(
    el('div', { className: 'rv-split' }, el('i', { className: 'cod', style: `width:${split ? (c.cod / split) * 100 : 0}%` }), el('i', { className: 'pre', style: `width:${split ? (c.prepaid / split) * 100 : 0}%` })),
    kv([['Cash on delivery', inr(c.cod)], ['Prepaid', inr(c.prepaid)], ['Not yet paid (to collect)', inr(c.unpaid)]]));

  const order = ['pending', 'accepted', 'shipped', 'delivered', 'rejected', 'cancelled'];
  $('#revStatuses').replaceChildren(d.statuses.length
    ? el('ul', { className: 'rv-chips' }, ...order.filter(s => d.statuses.some(x => x.status === s)).map(s => {
      const x = d.statuses.find(y => y.status === s);
      return el('li', {}, el('span', { className: 'badge s-' + s, textContent: s }), el('b', { textContent: x.orders }), el('small', { textContent: inr(x.amount) }));
    }))
    : el('p', { className: 'muted', textContent: 'No orders in this period.' }));

  const r = d.returns;
  $('#revReturns').replaceChildren(kv([['Return requests', String(r.requests)], ['Return rate (of delivered orders)', pct(r.rate)], ['Waiting to be handled', String(r.pending)], ['Amount refunded', inr(r.refunded_amount)]]));
  const cu = d.customers;
  $('#revCustomers').replaceChildren(kv([['Customers who bought', String(cu.buyers)], ['Repeat customers', cu.buyers ? `${cu.repeat} (${pct(Math.round((cu.repeat / cu.buyers) * 1000) / 10)})` : '—'], ['New sign-ups', String(cu.new)]]));
  const inv = d.inventory;
  $('#revStock').replaceChildren(kv([['Units in stock', String(inv.units)], ['Value at selling price', inr(inv.retail_value)],
    ['Value at cost', inv.missing_cost ? `${inr(inv.cost_value)} (partial)` : inr(inv.cost_value)],
    ['Potential profit', inv.missing_cost ? '—' : inr(inv.retail_value - inv.cost_value)]]));
}

function kv(pairs) {
  return el('dl', { className: 'rv-kv' }, ...pairs.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
}

// Revenue as bars, profit as a line (hand-drawn SVG, no chart library)
function buildChart(series, granularity, hasCost) {
  const W = 800, H = 280, L = 58, R = 14, T = 14, B = 34;
  const label = b => (granularity === 'month' ? new Date(b + '-01T00:00:00Z').toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : new Date(b + 'T00:00:00Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const maxV = Math.max(1, ...series.map(p => p.revenue), ...(hasCost ? series.map(p => p.profit) : [0]));
  const minV = Math.min(0, ...(hasCost ? series.map(p => p.profit) : [0]));
  // Round axis steps (1, 2, 2.5, 5 × 10ⁿ) so the labels are clean and never repeat
  const rough = (maxV - Math.min(0, minV)) / 4, mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rough);
  const top = Math.ceil(maxV / step) * step, bottom = Math.floor(minV / step) * step;
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, k) => bottom + k * step);
  const fmtAxis = v => (Math.abs(v) >= 1e5 ? '₹' + +(v / 1e5).toFixed(2) + 'L' : Math.abs(v) >= 1e3 ? '₹' + +(v / 1e3).toFixed(2) + 'k' : '₹' + Math.round(v));
  const lo = bottom, span = top - lo;
  const x0 = i => L + (i + 0.5) * ((W - L - R) / series.length);
  const y = v => T + (1 - (v - lo) / span) * (H - T - B);
  const bw = Math.max(2, Math.min(34, ((W - L - R) / series.length) * 0.62));
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Revenue and profit over time', class: 'rv-svg' });
  for (const v of ticks) {
    s.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }),
      svg('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'ax' }, fmtAxis(v)));
  }
  const every = Math.ceil(series.length / 8);
  series.forEach((p, i) => {
    const bar = svg('rect', { x: x0(i) - bw / 2, y: y(Math.max(p.revenue, 0)), width: bw, height: Math.max(0, y(0) - y(Math.max(p.revenue, 0))), rx: 3, class: 'bar' });
    bar.append(svg('title', {}, `${label(p.bucket)}\nRevenue ${inr(p.revenue)}${hasCost ? '\nProfit ' + inr(p.profit) : ''}\nOrders ${p.orders}`));
    s.append(bar);
    if (i % every === 0) s.append(svg('text', { x: x0(i), y: H - 12, 'text-anchor': 'middle', class: 'ax' }, label(p.bucket)));
  });
  if (hasCost) {
    s.append(svg('polyline', { points: series.map((p, i) => `${x0(i)},${y(p.profit)}`).join(' '), class: 'pline', fill: 'none' }));
    if (series.length <= 45) series.forEach((p, i) => { if (p.revenue) s.append(svg('circle', { cx: x0(i), cy: y(p.profit), r: 3.5, class: 'pdot' })); });
  }
  return s;
}
