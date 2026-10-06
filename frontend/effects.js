// Extra motion for the whole site: scroll progress, hero sparkles, card tilt, ripples, count-up numbers,
// fly-to-cart, product-image zoom and soft page transitions. Everything is skipped for visitors who ask for reduced motion.
(function () {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hoverDevice = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const make = (tag, cls, parent) => { const e = document.createElement(tag); e.className = cls; (parent || document.body).append(e); return e; };

  // ---------- Scroll progress bar ----------
  const bar = make('div', 'fx-progress');
  bar.setAttribute('aria-hidden', 'true');
  const onScroll = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (still) return; // the rest is motion only

  // ---------- Hero: floating sparkles ----------
  const hero = document.querySelector('.hero');
  if (hero) {
    const box = make('div', 'fx-sparks', hero);
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 16; i++) {
      const s = make('span', 'fx-spark', box);
      const size = 4 + Math.random() * 8;
      s.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${6 + Math.random() * 8}s;animation-delay:${-Math.random() * 12}s`;
    }
  }

  // ---------- Button ripple ----------
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('.btn, .add, .hbtn, .search button, .totop');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2;
    const rip = document.createElement('span');
    rip.className = 'fx-ripple';
    rip.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.style.overflow = 'hidden';
    b.append(rip);
    rip.addEventListener('animationend', () => rip.remove());
  });

  // ---------- 3D tilt + glare on product cards (works for cards added later too) ----------
  if (hoverDevice) {
    document.addEventListener('pointermove', e => {
      const c = e.target.closest && e.target.closest('.card');
      if (!c) return;
      const r = c.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      c.style.setProperty('--mx', x * 100 + '%');
      c.style.setProperty('--my', y * 100 + '%');
      c.style.transform = `perspective(800px) rotateX(${(0.5 - y) * 9}deg) rotateY(${(x - 0.5) * 9}deg) translateY(-9px)`;
    });
    document.addEventListener('pointerout', e => {
      const c = e.target.closest && e.target.closest('.card');
      if (c && !c.contains(e.relatedTarget)) c.style.transform = '';
    });
  }

  // ---------- Count-up numbers (trust strip, about page stats) ----------
  const counted = new WeakSet();
  const countUp = el => {
    if (counted.has(el)) return;
    counted.add(el);
    const m = el.textContent.trim().match(/^([\d.,]+)(.*)$/);
    if (!m) return;
    const target = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(target)) return;
    const decimals = (m[1].split('.')[1] || '').length;
    const t0 = performance.now(), dur = 1400;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), v = target * (1 - Math.pow(1 - k, 3));
      el.textContent = v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + m[2];
      if (k < 1) requestAnimationFrame(step); else el.textContent = m[0];
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { countUp(en.target); io.unobserve(en.target); } }), { threshold: 0.6 });
    const watch = () => document.querySelectorAll('.trust b, .ip-stats b').forEach(el => { if (!counted.has(el)) io.observe(el); });
    watch();
    new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });
  }

  // The cart button bounces with a ring when the item lands, and a "+1" floats up from it
  function cartHit(cart, btn) {
    cart.classList.remove('fx-cart-hit');
    void cart.offsetWidth;
    cart.classList.add('fx-cart-hit');
    setTimeout(() => cart.classList.remove('fx-cart-hit'), 800);
    const qty = btn.classList.contains('pd-add') ? +(document.getElementById('qty')?.value || 1) : 1;
    const r = cart.getBoundingClientRect();
    const plus = make('span', 'fx-plus');
    plus.textContent = '+' + qty;
    plus.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + 6}px`;
    plus.addEventListener('animationend', () => plus.remove());
  }

  // ---------- Fly to cart + "Added" feedback ----------
  document.addEventListener('click', e => {
    const btn = e.target.closest('.add, .pd-add');
    if (!btn || btn.disabled || !localStorage.getItem('toothkart_token')) return; // signed-out clicks open sign-in instead
    const target = document.getElementById('cartBtn') || [...document.querySelectorAll('.actions a.hbtn')].find(a => /cart/i.test(a.textContent));
    const source = btn.closest('.card, .pd-grid')?.querySelector('img, .img span, .pd-img span');
    if (target && source) {
      const s = source.getBoundingClientRect(), t = target.getBoundingClientRect();
      const size = Math.min(s.width, s.height, 140);
      const dx = t.left + t.width / 2 - (s.left + s.width / 2), dy = t.top + t.height / 2 - (s.top + s.height / 2);
      // The picture flies in an arc to the cart; three fading copies follow it as a trail
      for (let k = 0; k < 4; k++) {
        const fly = source.cloneNode(true);
        fly.className = 'fx-fly' + (k ? ' ghost' : '');
        fly.style.cssText = `left:${s.left + s.width / 2 - size / 2}px;top:${s.top + s.height / 2 - size / 2}px;width:${size}px;height:${size}px;font-size:${size * 0.7}px;` + (k ? `opacity:${0.35 - k * 0.08}` : '');
        document.body.append(fly);
        const anim = fly.animate([
          { transform: 'translate(0,0) scale(1) rotate(0)', opacity: k ? 0.35 - k * 0.08 : 1 },
          { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 90}px) scale(.65) rotate(-14deg)`, offset: 0.5 },
          { transform: `translate(${dx}px,${dy}px) scale(.08) rotate(20deg)`, opacity: 0.15 }],
        { duration: 850, delay: k * 70, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'backwards' });
        anim.onfinish = () => { fly.remove(); if (k === 0) cartHit(target, btn); };
      }
    }
    if (!btn.dataset.fxBusy) {
      btn.dataset.fxBusy = '1';
      const old = btn.textContent;
      btn.textContent = '✓ Added';
      btn.classList.add('fx-added');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('fx-added'); delete btn.dataset.fxBusy; }, 1200);
    }
  });

  // ---------- Product page: zoom into the picture under the pointer ----------
  if (hoverDevice) {
    document.addEventListener('pointermove', e => {
      const box = e.target.closest && e.target.closest('.pd-img');
      if (!box) return;
      const img = box.querySelector('img');
      if (!img) return;
      const r = box.getBoundingClientRect();
      img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    });
  }

  // ---------- Soft page transition ----------
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target || a.hasAttribute('download')) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search)) return; // other site, or same page / #anchor
    e.preventDefault();
    document.body.classList.add('fx-leaving');
    setTimeout(() => { location.href = u.href; }, 220);
  });
  addEventListener('pageshow', e => { if (e.persisted) document.body.classList.remove('fx-leaving'); }); // back button
})();
