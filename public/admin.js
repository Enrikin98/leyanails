(() => {
  const $ = s => document.querySelector(s);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ss = {
    get() { try { return sessionStorage.getItem('leya_admin') || ''; } catch { return ''; } },
    set(v) { try { v ? sessionStorage.setItem('leya_admin', v) : sessionStorage.removeItem('leya_admin'); } catch {} },
  };
  let key = ss.get();
  let D = null;
  let filter = 'upcoming';
  let newImage = null;

  const STATUS = { pending: '⏳ Pendiente', confirmed: '✅ Confirmada', rejected: '❌ Rechazada', cancelled: '🚫 Cancelada', done: '💅 Realizada' };
  const DAYS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const longDate = d => { const x = new Date(d + 'T12:00:00Z'); return `${DAYS_L[x.getUTCDay()]} ${x.getUTCDate()} de ${MONTHS[x.getUTCMonth()]}`; };
  const ampm = t => { let [a, b] = t.split(':').map(Number); const ap = a >= 12 ? 'pm' : 'am'; a = a % 12 || 12; return `${a}:${String(b).padStart(2, '0')} ${ap}`; };
  const shiftName = t => t === D.settings.morning_time ? `☀️ Mañana (${ampm(t)})` : t === D.settings.afternoon_time ? `🌙 Tarde (${ampm(t)})` : ampm(t);
  const waNum = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 8) d = '53' + d; return d; };

  function toast(t) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = t;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  async function api(path, method = 'GET', body) {
    const res = await fetch('/api/admin' + path, {
      method, headers: { 'content-type': 'application/json', 'x-admin-key': key },
      body: body ? JSON.stringify(body) : undefined,
    });
    const r = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error('Contraseña incorrecta'); }
    if (!res.ok) throw new Error(r.error || 'Error');
    return r;
  }

  /** Reduce la foto en el navegador (para ahorrar datos y espacio). */
  function resizeImage(file, max = 1000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        const url = c.toDataURL('image/jpeg', 0.8);
        resolve({ preview: url, mime: 'image/jpeg', data: url.split(',')[1] });
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.src = URL.createObjectURL(file);
    });
  }
  const uploadImage = async img => (await api('/images', 'POST', { mime: img.mime, data: img.data })).id;

  function priceText(p) {
    p = Number(p) || 0;
    if (!p) return 'Consultar';
    const rate = Number(D.settings.rate) || 0;
    if (D.settings.base_currency === 'CUP') return rate ? `${p} CUP ≈ ${(p / rate).toFixed(1)} USD` : `${p} CUP`;
    return rate ? `${p} USD = ${Math.round(p * rate)} CUP` : `${p} USD`;
  }

  // ---------- Carga ----------
  async function load() {
    D = await api('/data');
    renderAppts(); renderBlocked(); renderServices(); renderDesigns(); renderSettings();
  }

  // ---------- Citas ----------
  function renderAppts() {
    let list = D.appointments;
    if (filter === 'upcoming') list = list.filter(a => a.date >= D.today && ['pending', 'confirmed'].includes(a.status));
    if (filter === 'pending') list = list.filter(a => a.status === 'pending' && a.date >= D.today);
    if (filter === 'past') list = list.filter(a => a.date < D.today || !['pending', 'confirmed'].includes(a.status)).reverse();
    if (!list.length) { $('#apptList').innerHTML = '<div class="panel empty">No hay citas aquí.</div>'; return; }
    let html = '', last = '';
    for (const a of list) {
      if (a.date !== last) { html += `<div class="date-h">${a.date === D.today ? 'Hoy · ' : ''}${longDate(a.date)}</div>`; last = a.date; }
      const wa = `https://wa.me/${waNum(a.phone)}?text=${encodeURIComponent(
        a.status === 'confirmed'
          ? `Hola ${a.client_name} 💅 Tu cita en ${D.settings.business_name} para ${a.service_name} el ${longDate(a.date)}, ${shiftName(a.time).replace(/^\S+ /, 'turno de la ').toLowerCase()} está confirmada. ¡Te espero!`
          : `Hola ${a.client_name}, te escribo de ${D.settings.business_name} por tu cita del ${longDate(a.date)}, ${shiftName(a.time).replace(/^\S+ /, 'turno de la ').toLowerCase()}.`)}`;
      html += `<div class="appt">
        <div class="appt-top"><b>${shiftName(a.time)} · ${h(a.client_name)}</b><span class="badge ${a.status}">${STATUS[a.status] || a.status}</span></div>
        <div>${h(a.service_name)}${a.design_title ? ` · diseño: ${h(a.design_title)}` : ''}</div>
        <div><a href="tel:${h(a.phone)}">${h(a.phone)}</a></div>
        ${a.notes ? `<div class="muted">📝 ${h(a.notes)}</div>` : ''}
        <div class="actions">
          ${a.status === 'pending' ? `<button class="btn small" data-st="confirmed" data-id="${a.id}">Confirmar</button><button class="btn small ghost" data-st="rejected" data-id="${a.id}">Rechazar</button>` : ''}
          ${a.status === 'confirmed' ? `<button class="btn small ghost" data-st="done" data-id="${a.id}">Realizada</button><button class="btn small ghost" data-st="cancelled" data-id="${a.id}">Cancelar</button>` : ''}
          <a class="btn small wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>
          ${['rejected', 'cancelled', 'done'].includes(a.status) ? `<button class="btn small ghost" data-del-appt="${a.id}">Eliminar</button>` : ''}
        </div></div>`;
    }
    $('#apptList').innerHTML = html;
  }

  function renderBlocked() {
    $('#blockedList').innerHTML = D.blocked.length ? D.blocked.map(b => `
      <div class="appt-top" style="padding:8px 0;border-top:1px solid var(--line)">
        <span style="text-transform:capitalize">${longDate(b.date)}${b.reason ? ` <span class="muted">· ${h(b.reason)}</span>` : ''}</span>
        <button class="btn small ghost" data-unblock="${b.date}">Quitar</button></div>`).join('') : '<p class="help">No hay días bloqueados.</p>';
  }

  // ---------- Servicios ----------
  function renderServices() {
    $('#currencyHelp').textContent = `Precios en ${D.settings.base_currency}. ` + (Number(D.settings.rate) ? `Tasa actual: ${D.settings.rate} CUP/USD.` : 'Sin tasa (cámbiala en Ajustes).');
    $('#serviceList').innerHTML = D.services.map(s => `
      <form class="item" data-service="${s.id}">
        <label class="thumb" style="${s.image_id ? `background-image:url(/img/${s.image_id})` : ''}">${s.image_id ? '' : '📷<br>Foto'}<input type="file" accept="image/*" data-svc-photo></label>
        <div>
          <div class="row">
            <div class="field"><label>Nombre</label><input name="name" value="${h(s.name)}" required></div>
            <div class="field"><label>Precio (${D.settings.base_currency})</label><input name="price" type="number" min="0" step="any" value="${s.price || ''}"></div>
            <div class="field"><label>Orden</label><input name="sort" type="number" value="${s.sort}"></div>
          </div>
          <div class="field"><label>Descripción</label><input name="description" value="${h(s.description)}"></div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Visible</label>
            <span class="help">${priceText(s.price)}</span>
            <span style="flex:1"></span>
            <button type="button" class="btn small ghost" data-del-svc="${s.id}">Eliminar</button>
            <button class="btn small">Guardar</button>
          </div>
        </div>
      </form>`).join('') || '<p class="help">No hay servicios.</p>';
  }

  // ---------- Diseños ----------
  function renderDesigns() {
    const cats = [...new Set(D.designs.map(d => d.category).filter(Boolean))];
    $('#catList').innerHTML = cats.map(c => `<option value="${h(c)}">`).join('');
    $('#designList').innerHTML = D.designs.map(d => `
      <form class="dcard" data-design="${d.id}">
        ${d.image_id ? `<img src="/img/${d.image_id}" alt="" loading="lazy">` : ''}
        <div class="b">
          <input name="title" value="${h(d.title)}" placeholder="Título">
          <input name="category" value="${h(d.category)}" placeholder="Categoría" list="catList">
          <input name="price" type="number" min="0" step="any" value="${d.price ?? ''}" placeholder="Precio">
          <label class="check"><input type="checkbox" name="featured" ${d.featured ? 'checked' : ''}> ★ Del mes</label>
          <label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Visible</label>
          <div style="display:flex;gap:6px"><button class="btn small" style="flex:1">Guardar</button><button type="button" class="btn small ghost" data-del-design="${d.id}" aria-label="Eliminar">🗑</button></div>
        </div>
      </form>`).join('') || '<p class="help">Aún no hay diseños.</p>';
  }

  // ---------- Ajustes ----------
  function renderSettings() {
    const f = $('#settingsForm');
    for (const el of f.elements) if (el.name && el.name in D.settings) el.value = D.settings[el.name];
    const on = String(D.settings.work_days).split(',');
    $('#weekdays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d =>
      `<label><input type="checkbox" value="${d}" ${on.includes(String(d)) ? 'checked' : ''}> ${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d]}</label>`).join('');
    loadTgStatus();
  }

  async function loadTgStatus() {
    try {
      const s = await api('/telegram/status');
      if (!s.configured) { $('#tgStatus').innerHTML = '⚠️ Falta el <b>TELEGRAM_TOKEN</b> en el servidor.'; return; }
      $('#tgStatus').innerHTML = [
        `Bot: <b>@${h(s.bot || '?')}</b>`,
        s.admin ? '✅ Chat de administración registrado' : '⚠️ Aún no registraste tu chat (paso 1)',
        s.polling ? '🖥️ Modo local (polling) activo' : (s.webhook ? '✅ Conectado' : '⚠️ No conectado (paso 2)'),
        s.last_error ? `❗ Último error: ${h(s.last_error)}` : '',
      ].filter(Boolean).join('<br>');
    } catch (e) { $('#tgStatus').textContent = e.message; }
  }

  // ---------- Eventos ----------
  const formObj = f => Object.fromEntries([...f.elements].filter(e => e.name).map(e => [e.name, e.type === 'checkbox' ? e.checked : e.value]));
  const run = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('❌ ' + e.message); } };

  document.addEventListener('click', run(async e => {
    const t = e.target.closest('button,[data-tab]');
    if (!t) return;
    if (t.dataset.tab) {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
      document.querySelectorAll('[data-view]').forEach(v => v.classList.toggle('hidden', v.dataset.view !== t.dataset.tab));
      return;
    }
    if (t.dataset.f) {
      filter = t.dataset.f;
      document.querySelectorAll('#apptFilter .chip').forEach(x => x.classList.toggle('on', x === t));
      return renderAppts();
    }
    if (t.dataset.st) { await api(`/appointments/${t.dataset.id}`, 'PUT', { status: t.dataset.st }); toast(STATUS[t.dataset.st]); return load(); }
    if (t.dataset.delAppt) { if (!confirm('¿Eliminar esta cita del historial?')) return; await api(`/appointments/${t.dataset.delAppt}`, 'DELETE'); return load(); }
    if (t.dataset.unblock) { await api(`/blocked/${t.dataset.unblock}`, 'DELETE'); toast('Día desbloqueado'); return load(); }
    if (t.dataset.delSvc) { if (!confirm('¿Eliminar este servicio? (Puedes desmarcar "Visible" para solo ocultarlo)')) return; await api(`/services/${t.dataset.delSvc}`, 'DELETE'); toast('Servicio eliminado'); return load(); }
    if (t.dataset.delDesign) { if (!confirm('¿Eliminar este diseño?')) return; await api(`/designs/${t.dataset.delDesign}`, 'DELETE'); toast('Diseño eliminado'); return load(); }
    if (t.id === 'addService') { await api('/services', 'POST', { name: 'Nuevo servicio', price: 0, sort: D.services.length + 1 }); toast('Servicio agregado, edítalo abajo'); return load(); }
    if (t.id === 'tgSetup') { const r = await api('/telegram/setup', 'POST'); toast(r.ok ? '✅ Bot conectado' : '❌ ' + r.description); return loadTgStatus(); }
    if (t.id === 'tgTest') { const r = await api('/telegram/test', 'POST'); toast(r.ok ? '✅ Mensaje enviado, revisa Telegram' : '❌ ' + r.description); }
    if (t.id === 'logout') logout();
  }));

  document.addEventListener('submit', run(async e => {
    const f = e.target;
    if (f.id === 'loginForm' || f.id === 'designForm' || f.id === 'settingsForm' || f.id === 'blockForm') return;
    e.preventDefault();
    if (f.dataset.service) {
      const id = Number(f.dataset.service);
      const cur = D.services.find(s => s.id === id);
      await api(`/services/${id}`, 'PUT', { ...formObj(f), image_id: cur.image_id });
      toast('✅ Servicio guardado'); return load();
    }
    if (f.dataset.design) {
      const id = Number(f.dataset.design);
      const cur = D.designs.find(d => d.id === id);
      await api(`/designs/${id}`, 'PUT', { ...formObj(f), image_id: cur.image_id });
      toast('✅ Diseño guardado'); return load();
    }
  }));

  document.addEventListener('change', run(async e => {
    const t = e.target;
    if (t.matches('[data-svc-photo]') && t.files[0]) {
      const f = t.closest('form');
      const id = Number(f.dataset.service);
      toast('Subiendo foto…');
      const img = await resizeImage(t.files[0], 900);
      const imgId = await uploadImage(img);
      await api(`/services/${id}`, 'PUT', { ...formObj(f), image_id: imgId });
      toast('✅ Foto actualizada'); return load();
    }
    if (t.id === 'newPhoto' && t.files[0]) {
      newImage = await resizeImage(t.files[0]);
      const th = $('#newThumb');
      th.style.backgroundImage = `url(${newImage.preview})`;
      [...th.childNodes].forEach(n => { if (n !== t) n.remove(); });
    }
  }));

  $('#designForm').addEventListener('submit', run(async e => {
    e.preventDefault();
    if (!newImage) return toast('Elige una foto primero');
    $('#newSave').disabled = true;
    try {
      const imgId = await uploadImage(newImage);
      await api('/designs', 'POST', {
        title: $('#newTitle').value, category: $('#newCat').value, price: $('#newPrice').value,
        featured: $('#newFeatured').checked, image_id: imgId,
      });
      newImage = null;
      e.target.reset();
      $('#newThumb').style.backgroundImage = '';
      $('#newThumb').innerHTML = '📷<br>Elegir foto<input type="file" accept="image/*" id="newPhoto">';
      toast('✅ Diseño publicado');
      await load();
    } finally { $('#newSave').disabled = false; }
  }));

  $('#settingsForm').addEventListener('submit', run(async e => {
    e.preventDefault();
    const body = formObj(e.target);
    body.work_days = [...document.querySelectorAll('#weekdays input:checked')].map(i => i.value).join(',');
    if (!body.work_days) return toast('Marca al menos un día de trabajo');
    await api('/settings', 'PUT', body);
    toast('✅ Ajustes guardados'); await load();
  }));

  $('#blockForm').addEventListener('submit', run(async e => {
    e.preventDefault();
    await api('/blocked', 'POST', { date: $('#blockDate').value, reason: $('#blockReason').value });
    e.target.reset(); toast('🔒 Día bloqueado'); await load();
  }));

  // ---------- Login ----------
  function logout() { key = ''; ss.set(''); $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); }
  async function enter() {
    try {
      await load();
      ss.set(key);
      $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
    } catch (e) {
      $('#loginMsg').innerHTML = `<div class="msg err">${h(e.message)}</div>`;
    }
  }
  $('#loginForm').addEventListener('submit', e => { e.preventDefault(); key = $('#pass').value; enter(); });
  if (key) enter();

  // Refrescar citas cada minuto si el panel está abierto
  setInterval(() => { if (key && !document.hidden && !$('#appView').classList.contains('hidden') && !document.activeElement?.closest('form')) load().catch(() => {}); }, 60000);
})();
