(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DAYS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  let data = null;
  const st = { step: 1, service: null, design: null, date: null, time: null, month: null };
  const monthCache = {};

  const S = () => data.settings;
  /** Deja solo los 8 dígitos locales (quita +53 / 0053 si vienen pegados). */
  const localDigits = v => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length > 8 && d.startsWith('0053')) d = d.slice(4);
    else if (d.length > 8 && d.startsWith('53')) d = d.slice(2);
    return d.slice(0, 8);
  };
  function phoneUI(show) {
    const v = $('#fPhone').value, ok = /^\d{8}$/.test(v);
    $('#phoneCount').textContent = `${v.length}/8`;
    $('#phoneGroup').classList.toggle('valid', ok);
    const hint = $('#phoneHint');
    hint.className = 'phone-hint' + (ok ? ' ok' : show && v ? ' err' : '');
    hint.textContent = ok ? '✓ Número válido' : show && v ? `Faltan ${8 - v.length} dígito${8 - v.length === 1 ? '' : 's'}` : '8 dígitos, solo números';
    return ok;
  }
  const waNum = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 8) d = '53' + d; return d; };
  const waLink = text => `https://wa.me/${waNum(S().whatsapp || S().phone)}?text=${encodeURIComponent(text)}`;
  const ampm = t => { let [a, b] = String(t).split(':').map(Number); const ap = a >= 12 ? 'pm' : 'am'; a = a % 12 || 12; return `${a}:${String(b).padStart(2, '0')} ${ap}`; };
  const dObj = d => new Date(d + 'T12:00:00Z');
  const longDate = d => { const x = dObj(d); return `${DAYS_L[x.getUTCDay()]} ${x.getUTCDate()} de ${MONTHS[x.getUTCMonth()]}`; };
  const shifts = () => [
    { id: 'am', label: 'Mañana', e: '☀️', time: S().morning_time || '09:00' },
    { id: 'pm', label: 'Tarde', e: '🌙', time: S().afternoon_time || '13:00' },
  ];
  const shiftName = t => { const s = shifts().find(x => x.time === t); return s ? `turno de la ${s.label.toLowerCase()} (${ampm(t)})` : ampm(t); };

  function icon(name) {
    const n = name.toLowerCase();
    if (n.includes('poligel')) return '💎';
    if (n.includes('rubber')) return '💗';
    if (n.includes('dipping')) return '✨';
    if (n.includes('acr')) return '👑';
    if (n.includes('pie')) return '🌸';
    if (n.includes('gel')) return '💅';
    return '💖';
  }

  function price(p, plain = false) {
    p = Number(p) || 0;
    if (!p) return plain ? 'Consultar precio' : '<span class="gold-text">Consultar</span>';
    const rate = Number(S().rate) || 0;
    const f = n => Math.round(n).toLocaleString('es-ES', { useGrouping: 'always' });
    let main, sub = '';
    if (S().base_currency === 'CUP') { main = `${f(p)} CUP`; if (rate) sub = `≈ ${(p / rate).toFixed(1)} USD`; }
    else if (rate) { main = `${f(p * rate)} CUP`; sub = `${p} USD`; }
    else main = `${p} USD`;
    if (plain) return main + (sub ? ` (${sub})` : '');
    return `<span class="gold-text">${main}</span>${sub ? `<small>${sub}</small>` : ''}`;
  }

  function daysText() {
    const days = String(S().work_days || '').split(',').filter(Boolean).map(Number).sort((a, b) => (a || 7) - (b || 7));
    const seq = days.map(d => d || 7);
    if (seq.length > 2 && seq.every((d, i) => !i || d === seq[i - 1] + 1)) return `${DAY_NAMES[days[0]]} a ${DAY_NAMES[days[days.length - 1]]}`;
    return days.map(d => DAY_NAMES[d]).join(', ');
  }

  // ---------- Render ----------
  function render() {
    const s = S();
    if (s.tagline) $('#tagline').textContent = s.tagline;
    $('#badgeDays').textContent = daysText();
    $('#hours').innerHTML = `<p style="margin-bottom:8px">${h(daysText())}</p>` + shifts().map(x =>
      `<div class="shift-line"><span>${x.e} ${x.label}</span><b class="gold-text">${ampm(x.time)}</b></div>`).join('');
    $('#tel').textContent = s.phone; $('#tel').href = 'tel:' + s.phone;
    const hi = waLink(`Hola ${s.business_name} 💅, quisiera información.`);
    $('#waContact').href = hi; $('#waFab').href = hi;
    if (s.address) { $('#addrCard').classList.remove('hidden'); $('#addr').textContent = s.address; }
    $('#year').textContent = new Date().getFullYear();

    const names = data.services.map(x => x.name.toUpperCase());
    const items = (names.length ? names : ['MANICURE PROFESSIONAL']).map(n => `<span>${h(n)}</span>`).join('');
    $('#marquee').innerHTML = items + items + items + items;

    $('#services').innerHTML = data.services.length ? data.services.map((sv, i) => `
      <article class="service reveal" style="--d:${(i % 3) * 0.08}s">
        ${sv.image_id ? `<img class="cover" src="/img/${sv.image_id}" alt="" loading="lazy">` : `<div class="ico">${icon(sv.name)}</div>`}
        <h3>${h(sv.name)}</h3>
        <p>${h(sv.description)}</p>
        <div class="meta"><span class="price">${price(sv.price)}</span>
          <button class="btn small" data-book-service="${sv.id}">Reservar</button></div>
      </article>`).join('') : '<p class="empty">Pronto publicaremos los servicios.</p>';

    const cats = [...new Set(data.designs.map(d => d.category).filter(Boolean))];
    $('#cats').innerHTML = cats.length ? ['', ...cats].map(c => `<button class="chip${c ? '' : ' on'}" data-cat="${h(c)}">${c ? h(c) : '✨ Todos'}</button>`).join('') : '';
    renderGallery('');
    observe();
  }

  function renderGallery(cat) {
    const list = data.designs.filter(d => !cat || d.category === cat);
    $('#gallery').innerHTML = list.length ? list.map((d, i) => `
      <button class="design reveal" style="--d:${(i % 4) * 0.06}s" data-design="${d.id}" aria-label="${h(d.title)}">
        ${d.image_id ? `<img src="/img/${d.image_id}" alt="" loading="lazy">` : ''}
        ${d.featured ? '<span class="star">★ Del mes</span>' : ''}
        <span class="cap">${h(d.title)}${d.price ? `<small>${price(d.price, true)}</small>` : ''}</span>
      </button>`).join('') : '<p class="empty" style="grid-column:1/-1">Muy pronto subiremos nuestros diseños 💅✨</p>';
    observe();
  }

  // ---------- Animaciones ----------
  let io;
  function observe() {
    if (reduced || !('IntersectionObserver' in window)) { $$('.reveal').forEach(el => el.classList.add('in')); return; }
    io ||= new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal:not(.in)').forEach(el => io.observe(el));
  }

  function sparkles() {
    if (reduced) return;
    const fx = $('#fx');
    const small = innerWidth < 700;
    let html = '';
    for (let i = 0; i < (small ? 18 : 34); i++) {
      html += `<i class="spark${i % 3 ? '' : ' p'}" style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;--s:${4 + Math.random() * 10}px;--t:${2 + Math.random() * 3}s;--d:${Math.random() * 4}s"></i>`;
    }
    for (let i = 0; i < (small ? 6 : 12); i++) {
      html += `<span class="heart" style="left:${Math.random() * 100}%;--s:${12 + Math.random() * 18}px;--t:${10 + Math.random() * 10}s;--d:${Math.random() * 12}s;--x:${-60 + Math.random() * 120}px">♥</span>`;
    }
    fx.innerHTML = html;
  }

  function burst(x, y) {
    if (reduced) return;
    const em = ['💖', '✨', '💅', '💗', '⭐', '🌸'];
    for (let i = 0; i < 26; i++) {
      const el = document.createElement('span');
      el.className = 'burst';
      el.textContent = em[i % em.length];
      const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 160;
      el.style.cssText = `left:${x}px;top:${y}px;--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r - 60}px;--r:${Math.random() * 360}deg;font-size:${14 + Math.random() * 16}px`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }
  }

  addEventListener('scroll', () => {
    $('#top').classList.toggle('scrolled', scrollY > 20);
    $('#mobileCta').classList.toggle('show', scrollY > innerHeight * 0.6);
  }, { passive: true });

  // ---------- Diseño ----------
  function openDesign(id) {
    const d = data.designs.find(x => x.id === id);
    if (!d) return;
    $('#lbTitle').textContent = d.title;
    $('#lbImg').src = d.image_id ? `/img/${d.image_id}` : '';
    $('#lbMeta').innerHTML = [d.category && `🏷️ ${h(d.category)}`, d.price ? `💲 ${price(d.price, true)}` : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');
    $('#lbBook').onclick = () => { $('#lightbox').close(); openBooking(null, d); };
    $('#lightbox').showModal();
  }

  // ---------- Reserva ----------
  function openBooking(serviceId, design) {
    st.service = serviceId || st.service || null;
    st.design = design || null;
    st.time = null;
    $('#formMsg').innerHTML = '';
    $('#svcPick').innerHTML = data.services.map(s => `
      <button type="button" class="svc-opt${s.id === st.service ? ' on' : ''}" data-svc="${s.id}">
        <span class="e">${icon(s.name)}</span>${h(s.name)}<small>${price(s.price, true)}</small></button>`).join('');
    if (st.design) {
      $('#designPicked').classList.remove('hidden');
      $('#pickedImg').src = st.design.image_id ? `/img/${st.design.image_id}` : '';
      $('#pickedTitle').innerHTML = `Diseño: <b>${h(st.design.title)}</b>`;
    } else $('#designPicked').classList.add('hidden');
    $('#fName').value = store.get('leya_name');
    $('#fPhone').value = localDigits(store.get('leya_phone'));
    phoneUI(false);
    $('#fNotes').value = '';
    go(serviceId ? 2 : 1);
    $('#booking').showModal();
  }

  function err(t) {
    $('#formMsg').innerHTML = `<div class="msg err">${h(t)}</div>`;
    $('#booking .sheet').scrollTo({ top: 0, behavior: 'smooth' });
  }

  function go(step) {
    const back = step < st.step;
    st.step = step;
    $('#formMsg').innerHTML = '';
    $$('#booking .pane').forEach(p => {
      const on = Number(p.dataset.step) === step;
      p.classList.toggle('hidden', !on);
      if (on) { p.classList.toggle('back', back); p.style.animation = 'none'; p.offsetHeight; p.style.animation = ''; }
    });
    $$('#progress i').forEach((el, i) => el.classList.toggle('on', i < Math.min(step, 3)));
    $('#progress').classList.toggle('hidden', step === 4);
    $('#booking .sheet').scrollTo({ top: 0 });
    if (step === 2) {
      if (!st.month) st.month = (st.date || data.today).slice(0, 7);
      renderCalendar();
    }
    if (step === 3) {
      const sv = data.services.find(s => s.id === st.service);
      $('#summary').innerHTML = `<div>💅 <b>${h(sv.name)}</b>${st.design ? ` · ${h(st.design.title)}` : ''}</div>
        <div>📅 <span style="text-transform:capitalize">${longDate(st.date)}</span></div><div>🕘 ${h(shiftName(st.time))}</div>`;
      setTimeout(() => { if (!$('#fName').value) $('#fName').focus(); }, 350);
    }
  }

  const monthAdd = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const maxMonth = () => { const d = dObj(data.today); d.setUTCDate(d.getUTCDate() + (Number(S().max_days_ahead) || 30)); return d.toISOString().slice(0, 7); };

  async function getMonth(m, force) {
    if (!force && monthCache[m]) return monthCache[m];
    const res = await fetch(`/api/month?m=${m}`);
    if (!res.ok) throw new Error(`El servidor respondió con error ${res.status}`);
    const r = await res.json();
    monthCache[m] = r.days || {};
    return monthCache[m];
  }

  async function renderCalendar(dir = 0, force = false) {
    const m = st.month;
    const [y, mo] = m.split('-').map(Number);
    $('#calTitle').textContent = `${MONTHS[mo - 1]} ${y}`;
    $('#calPrev').disabled = m <= data.today.slice(0, 7);
    $('#calNext').disabled = m >= maxMonth();
    $('#cal').classList.add('loading');
    let days = {};
    try { days = await getMonth(m, force); }
    catch (e) { err(e instanceof TypeError ? 'Sin conexión. Revisa tu internet e inténtalo de nuevo.' : `No se pudo cargar el almanaque (${e.message}).`); }
    if (st.month !== m) return;
    $('#cal').classList.remove('loading');
    const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
    const offset = (first + 6) % 7; // semana empieza en lunes
    const total = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    let html = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<div class="cal-wd">${d}</div>`).join('');
    html += '<div></div>'.repeat(offset);
    for (let i = 1; i <= total; i++) {
      const d = `${m}-${String(i).padStart(2, '0')}`;
      const status = days[d] || 'closed';
      const cls = ['cal-day', status, d === data.today ? 'today' : '', d === st.date ? 'on' : ''].join(' ');
      html += `<button type="button" class="${cls}" data-date="${d}" ${status !== 'open' ? 'disabled' : ''} aria-label="${longDate(d)}${status === 'full' ? ', lleno' : ''}">${i}</button>`;
    }
    const grid = $('#calGrid');
    grid.innerHTML = html;
    grid.classList.remove('anim', 'back');
    if (dir) { grid.offsetHeight; grid.classList.add('anim'); if (dir < 0) grid.classList.add('back'); }
    if (st.date && st.date.startsWith(m)) loadShifts(); else if (!st.date) $('#shifts').innerHTML = '';
  }

  async function loadShifts() {
    const box = $('#shifts');
    box.innerHTML = shifts().map(x => `<button type="button" class="shift" disabled><span class="e">${x.e}</span>${x.label}<small>…</small></button>`).join('');
    try {
      const res = await fetch(`/api/shifts?date=${st.date}`);
      if (!res.ok) throw new Error(res.status);
      const r = await res.json();
      const list = r.shifts?.length ? r.shifts : shifts().map(x => ({ ...x, free: false }));
      if (!list.some(x => x.time === st.time && x.free)) st.time = null;
      box.innerHTML = list.map(x => {
        const e = x.id === 'am' ? '☀️' : '🌙';
        return `<button type="button" class="shift${st.time === x.time ? ' on' : ''}" data-time="${x.time}" ${x.free ? '' : 'disabled'}>
          <span class="e">${e}</span>${x.label}<small>${x.free ? ampm(x.time) : 'Ocupado'}</small></button>`;
      }).join('');
    } catch { box.innerHTML = '<p class="muted">No se pudieron cargar los turnos.</p>'; }
  }

  async function submit(e) {
    e.preventDefault();
    const name = $('#fName').value.trim(), phone = $('#fPhone').value.trim();
    if (name.length < 2) return err('Escribe tu nombre 🙂');
    if (!/^\d{8}$/.test(phone)) {
      phoneUI(true);
      $('#phoneGroup').classList.remove('invalid'); $('#phoneGroup').offsetHeight; $('#phoneGroup').classList.add('invalid');
      $('#fPhone').focus();
      return err('El teléfono debe tener exactamente 8 números (sin el +53).');
    }
    const btn = $('#submit');
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service_id: st.service, design_id: st.design?.id, date: st.date, time: st.time, name, phone, notes: $('#fNotes').value, website: $('#fWebsite').value }),
      });
      const r = await res.json();
      if (!res.ok) {
        if (res.status === 409) { delete monthCache[st.month]; st.time = null; go(2); }
        return err(r.error || 'No se pudo enviar.');
      }
      store.set('leya_name', name); store.set('leya_phone', phone);
      delete monthCache[st.date.slice(0, 7)];
      const sv = data.services.find(s => s.id === st.service);
      const when = `${longDate(st.date)}, ${shiftName(st.time)}`;
      $('#summaryDone').innerHTML = `<div>💅 <b>${h(sv.name)}</b>${st.design ? ` · ${h(st.design.title)}` : ''}</div><div>📅 ${h(when)}</div><div>👤 ${h(name)}</div>`;
      $('#waDone').href = waLink(`Hola 💅 Soy ${name}, acabo de pedir cita para ${sv.name}${st.design ? ` (diseño: ${st.design.title})` : ''} el ${when}.`);
      go(4);
      const rect = $('.okmark').getBoundingClientRect();
      setTimeout(() => burst(rect.left + rect.width / 2, rect.top + rect.height / 2), 200);
    } catch {
      err('Sin conexión. Inténtalo de nuevo.');
    } finally {
      btn.disabled = false; btn.textContent = '✨ Enviar solicitud';
    }
  }

  // ---------- Eventos ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-book],[data-book-service],[data-design],[data-cat],[data-close],[data-svc],[data-date],[data-time],[data-next],[data-prev]');
    if (!t || !data) return;
    if (t.hasAttribute('data-close')) return t.closest('dialog').close();
    if (t.hasAttribute('data-book')) return openBooking();
    if (t.dataset.bookService) return openBooking(Number(t.dataset.bookService));
    if (t.dataset.design) return openDesign(Number(t.dataset.design));
    if (t.hasAttribute('data-cat')) { $$('.chip').forEach(c => c.classList.toggle('on', c === t)); return renderGallery(t.dataset.cat); }
    if (t.dataset.svc) {
      st.service = Number(t.dataset.svc);
      $$('.svc-opt').forEach(b => b.classList.toggle('on', b === t));
      return setTimeout(() => go(2), 220);
    }
    if (t.dataset.date) {
      st.date = t.dataset.date;
      $$('.cal-day').forEach(b => b.classList.toggle('on', b === t));
      return loadShifts();
    }
    if (t.dataset.time) {
      st.time = t.dataset.time;
      $$('.shift').forEach(b => b.classList.toggle('on', b === t));
      return;
    }
    if (t.hasAttribute('data-prev')) return go(st.step - 1);
    if (t.hasAttribute('data-next')) {
      if (st.step === 1 && !st.service) return err('Elige un servicio 💅');
      if (st.step === 2 && !st.date) return err('Elige un día en el almanaque 📅');
      if (st.step === 2 && !st.time) return err('Elige el turno de la mañana o de la tarde 🕘');
      return go(st.step + 1);
    }
  });
  $('#calPrev').addEventListener('click', () => { st.month = monthAdd(st.month, -1); renderCalendar(-1); });
  $('#calNext').addEventListener('click', () => { st.month = monthAdd(st.month, 1); renderCalendar(1); });
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  $('#unpick').addEventListener('click', () => { st.design = null; $('#designPicked').classList.add('hidden'); });
  $('#form').addEventListener('submit', submit);
  // Teléfono: solo números, máximo 8 (también al pegar)
  $('#fPhone').addEventListener('beforeinput', e => {
    if (e.data && /\D/.test(e.data) && e.inputType !== 'insertFromPaste') e.preventDefault();
  });
  $('#fPhone').addEventListener('input', e => {
    const el = e.target, clean = localDigits(el.value);
    if (el.value !== clean) el.value = clean;
    $('#phoneGroup').classList.remove('invalid');
    if (phoneUI(false) && /tel[eé]fono/i.test($('#formMsg').textContent)) $('#formMsg').innerHTML = '';
  });
  $('#fPhone').addEventListener('blur', () => phoneUI(true));

  sparkles();
  observe();
  fetch('/api/catalog').then(r => r.json()).then(d => {
    data = d; render();
    // Enlaces directos: #agendar abre la reserva, #agendar-3 con el servicio 3 ya elegido
    const m = location.hash.match(/^#agendar(?:-(\d+))?$/);
    if (m) openBooking(m[1] && data.services.some(s => s.id === Number(m[1])) ? Number(m[1]) : null);
  })
    .catch(() => { $('#services').innerHTML = '<p class="empty">No se pudo cargar el catálogo. Revisa tu conexión y recarga.</p>'; });
})();
