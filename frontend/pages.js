// Builds the footer pages (contact, shipping-policy, returns, about, careers, events) from site-content.js.
// Each page's HTML file only needs <main id="page" data-page="..."> and a <footer id="siteFooter">.
(function () {
  const C = window.SITE_CONTENT;
  const main = document.getElementById('page');
  const key = main.dataset.page;
  const page = C.pages[key];

  // Small helper: h('a', {href:'/x'}, 'text', childNode)
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v; else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid);
    return el;
  }
  const list = items => h('ul', { class: 'ip-list' }, items.map(t => h('li', {}, t)));
  const card = (title, ...body) => h('section', { class: 'ip-card reveal' }, h('h2', {}, title), ...body);

  // ---------- Page bodies ----------
  function contact() {
    const kids = [];
    kids.push(h('div', { class: 'ip-grid' },
      card('Get in touch', h('dl', { class: 'ip-details' }, page.details.map(d => [
        h('dt', {}, d.label),
        h('dd', {}, d.href ? h('a', { href: d.href }, d.value) : d.value, d.note ? h('small', {}, d.note) : null)
      ]))),
      contactForm()
    ));
    kids.push(card(page.faq.title, page.faq.items.map(f =>
      h('details', { class: 'ip-faq' }, h('summary', {}, f.q), h('p', {}, f.a)))));
    return kids;
  }

  function contactForm() {
    const field = (id, label, extra, tag) => h('div', { class: 'ip-field' },
      h('label', { for: id }, label, ' ', h('em', { class: 'req', 'aria-hidden': 'true' }, '*')),
      h(tag || 'input', Object.assign({ id, name: id }, extra), ),
      h('span', { class: 'ip-err', id: id + 'Err', role: 'alert' }));
    const form = h('form', { class: 'ip-form', novalidate: '' },
      h('h2', {}, page.form.title),
      field('name', 'Name', { autocomplete: 'name', maxlength: '80' }),
      field('email', 'Email', { type: 'email', autocomplete: 'email', maxlength: '150' }),
      field('phone', 'Phone', { type: 'tel', inputmode: 'numeric', autocomplete: 'tel-national', maxlength: '16', placeholder: '10-digit mobile number' }),
      field('subject', 'Subject', { maxlength: '120' }),
      field('message', 'Message', { rows: '5', maxlength: '2000' }, 'textarea'),
      h('button', { class: 'btn', type: 'submit' }, 'Send message'),
      h('p', { class: 'ip-ok', id: 'formOk', role: 'status', hidden: '' }, page.form.success));
    const wrap = h('section', { class: 'ip-card reveal' }, form);

    const rules = {
      name: v => v.length < 2 && 'Please enter your name.',
      email: v => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && 'Please enter a valid email address.',
      phone: v => !/^(\+?91[\s-]?)?\d{10}$/.test(v.replace(/\s/g, '')) && 'Please enter a 10-digit mobile number.',
      subject: v => v.length < 3 && 'Please add a short subject.',
      message: v => v.length < 10 && 'Please write at least 10 characters.'
    };
    const check = name => {
      const input = form.elements[name];
      const msg = rules[name](input.value.trim());
      form.querySelector('#' + name + 'Err').textContent = msg || '';
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      return !msg;
    };
    Object.keys(rules).forEach(n => form.elements[n].addEventListener('blur', () => check(n)));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const results = Object.keys(rules).map(check);
      const firstBad = Object.keys(rules).find((n, i) => !results[i]);
      if (firstBad) { form.elements[firstBad].focus(); return; }
      form.reset();
      const ok = form.querySelector('#formOk');
      ok.hidden = false;
      ok.focus();
    });
    return wrap;
  }

  function policy() {
    const kids = (page.sections || []).map(s => card(s.title, s.items ? list(s.items) : h('p', {}, s.text)));
    if (page.steps) {
      kids.push(card(page.stepsTitle, h('ol', { class: 'ip-steps' }, page.steps.map(s => h('li', {}, s)))));
    }
    if (page.note) kids.push(h('p', { class: 'ip-note reveal' }, page.note));
    return kids;
  }

  function about() {
    return [
      ...page.sections.map(s => card(s.title, s.items ? list(s.items) : h('p', {}, s.text))),
      h('div', { class: 'ip-cols' }, page.highlights.map(x => h('section', { class: 'ip-card reveal' }, h('h3', {}, x.title), h('p', {}, x.text)))),
      h('section', { class: 'ip-stats reveal', 'aria-label': 'ToothKart in numbers' },
        page.stats.map(s => h('div', {}, h('b', {}, s.value), h('span', {}, s.label))))
    ];
  }

  function careers() {
    const mail = (role) => 'mailto:' + page.email + '?subject=' + encodeURIComponent('Application: ' + role);
    return [
      h('p', { class: 'ip-lead reveal' }, page.culture),
      card(page.rolesTitle, h('ul', { class: 'ip-rows' }, page.roles.map(r =>
        h('li', {},
          h('div', {}, h('h3', {}, r.title), h('p', {}, r.location + ' · ' + r.type)),
          h('a', { class: 'btn', href: mail(r.title), 'aria-label': page.applyLabel + ' for ' + r.title }, page.applyLabel))))),
      h('p', { class: 'ip-note reveal' }, page.generalText + ' ', h('a', { href: 'mailto:' + page.email }, page.email), '.')
    ];
  }

  function events() {
    const mail = (t) => 'mailto:' + page.registerEmail + '?subject=' + encodeURIComponent('Register: ' + t);
    return [
      h('h2', { class: 'ip-h2' }, page.upcomingTitle),
      h('div', { class: 'ip-cols' }, page.upcoming.map(ev =>
        h('article', { class: 'ip-card ip-event reveal' },
          h('h3', {}, ev.title),
          h('p', { class: 'ip-meta' }, h('span', {}, '📅 ' + ev.date), h('span', {}, '📍 ' + ev.location)),
          h('p', {}, ev.text),
          h('a', { class: 'btn', href: mail(ev.title), 'aria-label': page.registerLabel + ' for ' + ev.title }, page.registerLabel)))),
      card(page.pastTitle, h('ul', { class: 'ip-rows plain' }, page.past.map(p =>
        h('li', {}, h('div', {}, h('h3', {}, p.title), h('p', {}, p.date + ' · ' + p.location))))))
    ];
  }

  const builders = { contact, 'shipping-policy': policy, returns: policy, about, careers, events };

  // ---------- Render ----------
  document.title = page.title + ' – ToothKart';
  main.append(
    h('section', { class: 'ip-hero' }, h('div', { class: 'container' },
      h('h1', {}, page.title), h('p', {}, page.intro))),
    h('div', { class: 'container ip-body' }, builders[key]())
  );

  // Footer: same markup as the storefront footer; the current page is highlighted
  const footer = document.getElementById('siteFooter');
  const here = '/' + key;
  footer.append(
    h('div', { class: 'container footer-grid' },
      h('div', {}, h('h4', {}, 'Tooth', h('span', {}, 'Kart')), h('p', {}, C.footer.about)),
      C.footer.groups.map(g => h('nav', { 'aria-label': g.title }, h('h4', {}, g.title),
        g.links.map(l => h('a', { href: l.href, class: l.href === here ? 'active' : false, 'aria-current': l.href === here ? 'page' : false }, l.label)))),
      h('div', {}, h('h4', {}, 'Payments'), h('p', {}, C.footer.payments))),
    h('div', { class: 'legal' }, '© 2026 ToothKart. Demo project.'));

  // Scroll-in animation, same as the storefront
  const els = main.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
    els.forEach(el => io.observe(el));
  } else els.forEach(el => el.classList.add('in'));

  const top = document.querySelector('.header');
  const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
})();
