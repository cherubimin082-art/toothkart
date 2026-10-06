// Product detail page: /product?id=…
const API = location.protocol === 'file:' ? 'http://localhost:4000' : '';
const TOKEN_KEY = 'toothkart_token';
const $ = id => document.getElementById(id);
const imgSrc = u => (/^https?:\/\//.test(u) ? u : API + u);
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 });
const token = localStorage.getItem(TOKEN_KEY);
const main = $('product');

// Build elements with textContent only, so product data can never inject HTML
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
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
async function api(path, opts = {}) {
  const headers = {};
  if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + '/api' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

const thumbOrIcon = (p, alt) => p.image_url
  ? (img => { img.onerror = () => img.replaceWith(el('span', { textContent: '🦷' })); return img; })(el('img', { src: imgSrc(p.image_url), alt }))
  : el('span', { textContent: '🦷' });

// ---------- Cart ----------
async function refreshCount() {
  if (!token) return;
  try { $('cartCount').textContent = (await api('/cart')).count; } catch { /* signed out or offline: leave 0 */ }
}
// Adds to the cart; sends signed-out visitors to sign in first. Returns true when added.
async function addToCart(p, qty) {
  if (!token) { location.href = '/#signin'; return false; }
  try {
    const cart = await api('/cart', { method: 'POST', json: { productId: p.id, quantity: qty } });
    $('cartCount').textContent = cart.count;
    return true;
  } catch (err) {
    if (err.status === 401) { localStorage.removeItem(TOKEN_KEY); location.href = '/#signin'; return false; }
    toast(err.message);
    return false;
  }
}

// ---------- Page ----------
function render(p) {
  document.title = `${p.name} – ToothKart`;
  const inStock = p.stock > 0;
  const off = Math.round(p.discount_percent);

  const crumbs = el('nav', { className: 'pd-crumbs', 'aria-label': 'Breadcrumb' },
    el('a', { href: '/', textContent: 'Home' }),
    ...(p.category ? [' › ', el('a', { href: '/?category=' + encodeURIComponent(p.category), textContent: p.category })] : []),
    ' › ', el('span', { textContent: p.name }));

  // Several images: a column of thumbnails switches the large picture (hover or click)
  const pics = (p.images && p.images.length ? p.images.map(i => i.url) : p.image_url ? [p.image_url] : []);
  const big = el('div', { className: 'pd-img' }, thumbOrIcon(p, p.name));
  const strip = pics.length > 1 ? el('ul', { className: 'pd-thumbs', 'aria-label': 'Product images' }) : null;
  if (strip) {
    const show = (url, btn) => {
      const img = big.querySelector('img');
      if (img) img.src = imgSrc(url); else big.replaceChildren(el('img', { src: imgSrc(url), alt: p.name }));
      strip.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    };
    pics.forEach((url, k) => {
      const b = el('button', { type: 'button', className: k === 0 ? 'on' : '', 'aria-label': `Show image ${k + 1} of ${pics.length}` }, el('img', { src: imgSrc(url), alt: '' }));
      b.onclick = b.onmouseenter = () => show(url, b);
      strip.append(el('li', {}, b));
    });
  }
  const gallery = el('div', { className: 'pd-gallery' + (strip ? ' multi' : '') },
    ...(off > 0 ? [el('span', { className: 'ribbon', textContent: off + '% OFF' })] : []),
    ...(strip ? [strip] : []), big);

  const price = el('div', { className: 'pd-price' },
    ...(off > 0 ? [el('span', { className: 'pd-off', textContent: '−' + off + '%' })] : []),
    el('b', { textContent: inr(p.final_price) }));
  const mrp = off > 0 ? el('p', { className: 'pd-mrp' }, 'M.R.P.: ', el('s', { textContent: inr(p.price) }), el('em', { textContent: ' You save ' + inr(p.price - p.final_price) })) : '';

  const perks = el('ul', { className: 'pd-perks' },
    ...[['🚚', 'Free delivery above ₹999'], ['💵', 'Pay on delivery'], ['↩️', '7-day returns'], ['✅', '100% genuine']].map(([i, t]) =>
      el('li', {}, el('i', { textContent: i, 'aria-hidden': 'true' }), el('span', { textContent: t }))));

  const specs = el('table', { className: 'pd-specs' }, el('tbody', {},
    ...[['Brand', p.brand], ['Category', p.category], ['Availability', inStock ? 'In stock' : 'Out of stock'], ['Product code', 'TK-' + String(p.id).padStart(5, '0')]]
      .filter(r => r[1]).map(([k, v]) => el('tr', {}, el('th', { scope: 'row', textContent: k }), el('td', { textContent: v })))));

  const middle = el('div', { className: 'pd-info' },
    ...(p.brand ? [el('a', { className: 'pd-brand', href: '/?brand=' + encodeURIComponent(p.brand), textContent: 'Visit the ' + p.brand + ' store' })] : []),
    el('h1', { textContent: p.name }),
    el('hr'), price, mrp,
    el('p', { className: 'pd-tax', textContent: 'Inclusive of all taxes' }),
    perks,
    el('h2', { textContent: 'About this item' }),
    el('p', { className: 'pd-desc', textContent: p.description || 'No description has been added for this product yet.' }),
    el('h2', { textContent: 'Product details' }), specs);

  // Buy box
  const qty = el('select', { id: 'qty', 'aria-label': 'Quantity' },
    ...Array.from({ length: Math.min(p.stock, 10) }, (_, k) => el('option', { value: k + 1, textContent: k + 1 })));
  const pin = el('input', { id: 'pin', inputMode: 'numeric', maxLength: 6, placeholder: 'Pincode', 'aria-label': 'Pincode' });
  const pinMsg = el('p', { className: 'pd-pinmsg', role: 'status' });
  const pinForm = el('form', { className: 'pd-pin' }, pin, el('button', { className: 'btn ghost', type: 'submit', textContent: 'Check' }));
  pinForm.onsubmit = e => {
    e.preventDefault();
    pinMsg.textContent = /^\d{6}$/.test(pin.value.trim())
      ? `Delivery to ${pin.value.trim()}: 2–4 business days in metro cities, 5–7 elsewhere. Cash on delivery available.`
      : 'Please enter a valid 6-digit pincode.';
  };
  const add = el('button', { className: 'add pd-add', textContent: 'Add to cart', disabled: !inStock });
  const buy = el('button', { className: 'btn wide pd-buy', textContent: 'Buy now', disabled: !inStock });
  add.onclick = async () => { if (await addToCart(p, +qty.value)) toast(`Added ${qty.value} × "${p.name}"`); };
  buy.onclick = async () => { if (await addToCart(p, +qty.value)) location.href = '/?open=checkout'; };

  const box = el('aside', { className: 'pd-box', 'aria-label': 'Buy box' },
    el('div', { className: 'pd-boxprice', textContent: inr(p.final_price) }),
    el('p', { className: 'pd-ship', textContent: p.final_price >= 999 ? 'FREE delivery on this order' : 'Free delivery on orders above ₹999 (₹60 below)' }),
    pinForm, pinMsg,
    el('p', { className: inStock ? 'pd-stock ok' : 'pd-stock no', textContent: !inStock ? 'Out of stock' : p.stock <= 5 ? `Only ${p.stock} left in stock` : 'In stock' }),
    ...(inStock ? [el('label', { className: 'pd-qty' }, 'Quantity: ', qty)] : []),
    add, buy,
    el('dl', { className: 'pd-sold' }, el('dt', { textContent: 'Sold by' }), el('dd', { textContent: 'ToothKart' }),
      el('dt', { textContent: 'Payment' }), el('dd', { textContent: 'UPI, cards, net banking, COD' }),
      el('dt', { textContent: 'Returns' }), el('dd', {}, el('a', { href: '/returns', textContent: '7-day return window' }))));

  main.replaceChildren(crumbs, el('div', { className: 'pd-grid' }, gallery, middle, box), el('section', { id: 'related', hidden: true }));
  loadRelated(p);
}

async function loadRelated(p) {
  if (!p.category) return;
  try {
    const { products } = await api('/products?limit=5&category=' + encodeURIComponent(p.category));
    const others = products.filter(x => x.id !== p.id).slice(0, 4);
    if (!others.length) return;
    const sec = $('related');
    sec.className = 'pd-related';
    sec.replaceChildren(el('h2', { textContent: 'More in ' + p.category }), el('div', { className: 'products' }, ...others.map(x => {
      const href = '/product?id=' + x.id;
      return el('div', { className: 'card' },
        ...(x.discount_percent > 0 ? [el('span', { className: 'ribbon', textContent: Math.round(x.discount_percent) + '% OFF' })] : []),
        el('a', { className: 'img', href, tabIndex: -1, 'aria-hidden': 'true' }, thumbOrIcon(x, x.name)),
        el('small', { textContent: x.brand || x.category || '' }), el('h3', {}, el('a', { href, textContent: x.name })),
        el('div', { className: 'price' }, el('b', { textContent: inr(x.final_price) }),
          ...(x.discount_percent > 0 ? [el('s', { textContent: inr(x.price) })] : [])));
    })));
    sec.hidden = false;
  } catch { /* related products are optional */ }
}

function showError(msg) {
  document.title = 'Product not found – ToothKart';
  main.replaceChildren(el('div', { className: 'gate' }, el('h2', { textContent: msg }), el('p', { textContent: 'It may have been removed, or the link is wrong.' }), el('a', { className: 'btn', href: '/', textContent: 'Back to the store' })));
}

// ---------- Start ----------
(async () => {
  const id = new URLSearchParams(location.search).get('id');
  if (!/^\d+$/.test(id || '')) return showError('Product not found');
  if (token) {
    api('/auth/me').then(d => { $('accountLink').textContent = '👤 ' + d.user.name.split(' ')[0]; $('accountLink').href = '/account.html'; }).catch(() => {});
    refreshCount();
  }
  try { render(await api('/products/' + id)); }
  catch (err) { showError(err.status === 404 ? 'Product not found' : 'Could not load this product'); }
})();

// Footer (same as the other pages)
{
  const C = window.SITE_CONTENT, f = $('siteFooter');
  f.append(el('div', { className: 'container footer-grid' },
    el('div', {}, el('h4', {}, 'Tooth', el('span', { textContent: 'Kart' })), el('p', { textContent: C.footer.about })),
    ...C.footer.groups.map(g => el('nav', { ariaLabel: g.title }, el('h4', { textContent: g.title }), ...g.links.map(l => el('a', { href: l.href, textContent: l.label })))),
    el('div', {}, el('h4', { textContent: 'Payments' }), el('p', { textContent: C.footer.payments }))),
    el('div', { className: 'legal', textContent: '© 2026 ToothKart. Demo project.' }));
}
