// Bot de Telegram: avisos de citas y administración desde el chat.
import {
  getSettings, setSetting, nowLocal, addDays, isDate, prettyDate, prettyTime,
  formatPrice, bytesToB64, shiftLabel,
} from './lib.js';

export async function tg(env, method, payload) {
  if (!env.TELEGRAM_TOKEN) return { ok: false, description: 'Falta TELEGRAM_TOKEN' };
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return res.json().catch(() => ({ ok: false }));
}

export async function webhookSecret(env) {
  if (env.WEBHOOK_SECRET) return env.WEBHOOK_SECRET;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('leya:' + (env.TELEGRAM_TOKEN || '')));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Teléfono cubano a formato internacional para WhatsApp. */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '53' + d;
  return d;
}
const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

const STATUS = {
  pending: '⏳ Pendiente', confirmed: '✅ Confirmada', rejected: '❌ Rechazada',
  cancelled: '🚫 Cancelada', done: '💅 Realizada',
};

function apptText(a, s) {
  return [
    `💅 <b>Cita #${a.id}</b> — ${STATUS[a.status] || a.status}`,
    `👤 ${esc(a.client_name)}`,
    `📞 ${esc(a.phone)}`,
    `💼 ${esc(a.service_name)}${a.design_title ? ` · diseño: ${esc(a.design_title)}` : ''}`,
    `📅 ${prettyDate(a.date)}`,
    `🕘 ${shiftLabel(s, a.time)}`,
    a.notes ? `📝 ${esc(a.notes)}` : '',
  ].filter(Boolean).join('\n');
}

function apptKeyboard(a, s) {
  const name = s.business_name || 'Leya Nails';
  const when = `${prettyDate(a.date)}, ${shiftLabel(s, a.time).toLowerCase()}`;
  const rows = [];
  if (a.status === 'pending') {
    rows.push([{ text: '✅ Confirmar', callback_data: `ok:${a.id}` }, { text: '❌ Rechazar', callback_data: `no:${a.id}` }]);
    rows.push([{ text: '💬 Escribirle por WhatsApp', url: waLink(a.phone, `Hola ${a.client_name}, te escribo de ${name} por tu cita del ${when}.`) }]);
  } else if (a.status === 'confirmed') {
    rows.push([{ text: '💬 Enviar confirmación por WhatsApp', url: waLink(a.phone, `Hola ${a.client_name} 💅 Tu cita en ${name} para ${a.service_name} el ${when} está confirmada. ¡Te espero!`) }]);
    rows.push([{ text: '💅 Marcar realizada', callback_data: `done:${a.id}` }, { text: '🚫 Cancelar', callback_data: `cancel:${a.id}` }]);
  } else if (a.status === 'rejected') {
    rows.push([{ text: '💬 Avisarle por WhatsApp', url: waLink(a.phone, `Hola ${a.client_name}, lo siento, no tengo disponible el ${when}. ¿Te viene bien otro horario?`) }]);
  }
  return { inline_keyboard: rows };
}

export async function notifyNewAppointment(env, db, a) {
  const s = await getSettings(db);
  if (!s.admin_chat_id) return;
  await tg(env, 'sendMessage', {
    chat_id: s.admin_chat_id, parse_mode: 'HTML',
    text: '🔔 <b>Nueva solicitud de cita</b>\n\n' + apptText(a, s),
    reply_markup: apptKeyboard(a, s),
  });
}

function parseDateArg(arg) {
  const today = nowLocal().date;
  const a = String(arg || '').trim().toLowerCase();
  if (!a || a === 'hoy') return today;
  if (a === 'mañana' || a === 'manana') return addDays(today, 1);
  if (isDate(a)) return a;
  const m = a.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!m[3] && d < today) return `${y + 1}${d.slice(4)}`;
    return isDate(d) ? d : null;
  }
  return null;
}

const HELP = `💅 <b>Comandos de administración</b>

<b>Citas</b>
/hoy — citas de hoy
/manana — citas de mañana
/semana — próximos 7 días
/pendientes — solicitudes sin responder

<b>Precios</b>
/tasa 400 — cambia la tasa (CUP por 1 USD)
/precios — lista de servicios con su número
/precio 3 25 — pone el servicio #3 a 25

<b>Días libres</b>
/bloquear 24/12 Navidad — cierra ese día
/desbloquear 24/12

<b>Diseños</b>
📷 Envía una <b>foto</b> con un texto como:
<code>Francesa rosa - 15 #francesas</code>
(título - precio #categoría; precio y categoría son opcionales)
/disenos — últimos diseños
/borrar 12 — quita el diseño #12

/web — enlace de la página`;

async function listAppointments(db, s, from, to, onlyPending = false) {
  const { results } = await db.prepare(
    `SELECT * FROM appointments WHERE date >= ? AND date <= ? AND status ${onlyPending ? "= 'pending'" : "IN ('pending','confirmed')"} ORDER BY date, time`
  ).bind(from, to).all();
  return results;
}

async function sendAppointmentList(env, chatId, s, list, title) {
  if (!list.length) return tg(env, 'sendMessage', { chat_id: chatId, text: `${title}: no hay citas.` });
  await tg(env, 'sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `<b>${title}</b> (${list.length})` });
  for (const a of list.slice(0, 20)) {
    await tg(env, 'sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: apptText(a, s), reply_markup: apptKeyboard(a, s) });
  }
}

async function handleCallback(env, db, q) {
  const s = await getSettings(db);
  const chatId = String(q.message?.chat?.id || '');
  if (!s.admin_chat_id || chatId !== String(s.admin_chat_id)) {
    return tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'No autorizado' });
  }
  const [action, idStr] = String(q.data || '').split(':');
  const map = { ok: 'confirmed', no: 'rejected', done: 'done', cancel: 'cancelled' };
  const status = map[action];
  const id = Number(idStr);
  if (!status || !id) return tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
  await db.prepare('UPDATE appointments SET status = ? WHERE id = ?').bind(status, id).run();
  const a = await db.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first();
  if (!a) return tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'La cita ya no existe' });
  await tg(env, 'editMessageText', {
    chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML',
    text: apptText(a, s), reply_markup: apptKeyboard(a, s),
  });
  return tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: STATUS[status] });
}

async function addDesignFromPhoto(env, db, msg) {
  const photos = msg.photo || [];
  const pick = [...photos].reverse().find(p => p.width <= 1280) || photos[photos.length - 1];
  const f = await tg(env, 'getFile', { file_id: pick.file_id });
  if (!f.ok) throw new Error('No pude descargar la foto');
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${f.result.file_path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 1_500_000) throw new Error('La foto es muy grande');
  const img = await db.prepare('INSERT INTO images (mime, data) VALUES (?, ?)').bind('image/jpeg', bytesToB64(bytes)).run();

  let caption = String(msg.caption || '').trim();
  let category = '';
  caption = caption.replace(/#([\p{L}\p{N}_-]+)/gu, (_, c) => { category = c.replace(/_/g, ' '); return ''; }).trim();
  let price = null;
  const pm = caption.match(/[-–—:]\s*\$?\s*(\d+(?:[.,]\d+)?)\s*(usd|cup)?\s*$/i);
  if (pm) { price = Number(pm[1].replace(',', '.')); caption = caption.slice(0, pm.index).trim(); }
  const title = caption || 'Diseño';
  const d = await db.prepare('INSERT INTO designs (title, category, price, image_id) VALUES (?, ?, ?, ?)')
    .bind(title, category, price, img.meta.last_row_id).run();
  return { id: d.meta.last_row_id, title, category, price };
}

async function handleMessage(env, db, msg) {
  const chatId = String(msg.chat.id);
  const s = await getSettings(db);
  const isAdmin = s.admin_chat_id && chatId === String(s.admin_chat_id);
  const text = String(msg.text || '').trim();
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, '');
  const arg = rest.join(' ');
  const say = (t, extra = {}) => tg(env, 'sendMessage', { chat_id: chatId, text: t, parse_mode: 'HTML', ...extra });
  const site = s.site_url || env.SITE_URL || '';

  // Registrar a la administradora: /admin <contraseña>
  if (cmd === '/admin') {
    if (env.ADMIN_PASSWORD && arg === env.ADMIN_PASSWORD) {
      await setSetting(db, 'admin_chat_id', chatId);
      return say('✅ Listo. Este chat recibirá las citas y puede administrar el catálogo.\n\n' + HELP);
    }
    return say('Contraseña incorrecta.');
  }

  if (!isAdmin) {
    const name = s.business_name || 'Leya Nails';
    return say(
      `¡Hola! 💅 Bienvenida a <b>${esc(name)}</b>.\n\n` +
      (site ? 'Mira nuestro catálogo y agenda tu cita aquí:' : `Para agendar escríbenos al ${esc(s.phone)}.`),
      site ? { reply_markup: { inline_keyboard: [[{ text: '📅 Agendar mi cita', url: site.replace(/\/$/, '') + '/#agendar' }], [{ text: '💅 Ver catálogo', url: site }]] } } : {}
    );
  }

  // ---- Administradora ----
  if (msg.photo) {
    try {
      const d = await addDesignFromPhoto(env, db, msg);
      return say(`✅ Diseño #${d.id} publicado: <b>${esc(d.title)}</b>` +
        (d.price ? `\n💲 ${formatPrice(d.price, s)}` : '') + (d.category ? `\n🏷️ ${esc(d.category)}` : '') +
        `\n\nPara quitarlo: /borrar ${d.id}`);
    } catch (e) {
      return say('❌ ' + esc(e.message));
    }
  }

  const today = nowLocal().date;
  switch (cmd) {
    case '/start': case '/ayuda': case '/help':
      return say(HELP);
    case '/hoy':
      return sendAppointmentList(env, chatId, s, await listAppointments(db, s, today, today), 'Citas de hoy');
    case '/manana': case '/mañana': {
      const d = addDays(today, 1);
      return sendAppointmentList(env, chatId, s, await listAppointments(db, s, d, d), 'Citas de mañana');
    }
    case '/semana':
      return sendAppointmentList(env, chatId, s, await listAppointments(db, s, today, addDays(today, 7)), 'Próximos 7 días');
    case '/pendientes':
      return sendAppointmentList(env, chatId, s, await listAppointments(db, s, today, addDays(today, 365), true), 'Pendientes');
    case '/tasa': {
      const n = Number(arg.replace(',', '.'));
      if (!n || n <= 0) return say(`Tasa actual: <b>${s.rate || 'sin definir'}</b> CUP por 1 USD.\nPara cambiarla: /tasa 400`);
      await setSetting(db, 'rate', n);
      return say(`✅ Tasa actualizada: <b>${n}</b> CUP por 1 USD. Los precios de la página ya se recalcularon.`);
    }
    case '/precios': {
      const { results } = await db.prepare('SELECT * FROM services ORDER BY sort, id').all();
      return say('<b>Servicios</b> (precio en ' + (s.base_currency || 'USD') + ')\n\n' +
        results.map(r => `#${r.id} · ${esc(r.name)} — <b>${r.price || 0}</b> → ${formatPrice(r.price, s)}${r.active ? '' : ' (oculto)'}`).join('\n') +
        '\n\nPara cambiar: /precio 3 25');
    }
    case '/precio': {
      const [id, val] = rest;
      const n = Number(String(val || '').replace(',', '.'));
      if (!Number(id) || isNaN(n)) return say('Uso: /precio <número del servicio> <precio>\nEj: /precio 3 25');
      const r = await db.prepare('UPDATE services SET price = ? WHERE id = ?').bind(n, Number(id)).run();
      return say(r.meta.changes ? `✅ Servicio #${id} ahora cuesta ${formatPrice(n, s)}` : 'No encontré ese servicio. Mira /precios');
    }
    case '/bloquear': {
      const [d, ...why] = rest;
      const date = parseDateArg(d);
      if (!date) return say('Uso: /bloquear 24/12 motivo');
      await db.prepare('INSERT OR REPLACE INTO blocked (date, reason) VALUES (?, ?)').bind(date, why.join(' ')).run();
      const existing = await listAppointments(db, s, date, date);
      return say(`🔒 ${prettyDate(date)} bloqueado.` + (existing.length ? `\n⚠️ Ojo: ya hay ${existing.length} cita(s) ese día. Mira /semana` : ''));
    }
    case '/desbloquear': {
      const date = parseDateArg(rest[0]);
      if (!date) return say('Uso: /desbloquear 24/12');
      await db.prepare('DELETE FROM blocked WHERE date = ?').bind(date).run();
      return say(`🔓 ${prettyDate(date)} disponible otra vez.`);
    }
    case '/disenos': case '/diseños': {
      const { results } = await db.prepare('SELECT id, title, category, price FROM designs WHERE active = 1 ORDER BY id DESC LIMIT 30').all();
      if (!results.length) return say('Aún no hay diseños. Envíame una foto con su título 📷');
      return say('<b>Diseños</b>\n\n' + results.map(r => `#${r.id} · ${esc(r.title)}${r.category ? ` (${esc(r.category)})` : ''}${r.price ? ` — ${formatPrice(r.price, s)}` : ''}`).join('\n') + '\n\nPara quitar uno: /borrar 12');
    }
    case '/borrar': {
      const id = Number(rest[0]);
      if (!id) return say('Uso: /borrar <número del diseño>');
      const d = await db.prepare('SELECT image_id FROM designs WHERE id = ?').bind(id).first();
      if (!d) return say('No encontré ese diseño.');
      await db.prepare('DELETE FROM designs WHERE id = ?').bind(id).run();
      if (d.image_id) await db.prepare('DELETE FROM images WHERE id = ?').bind(d.image_id).run();
      return say(`🗑️ Diseño #${id} eliminado.`);
    }
    case '/web':
      return say(site ? `🌐 ${site}\n⚙️ Panel: ${site.replace(/\/$/, '')}/admin.html` : 'Aún no hay enlace configurado (Ajustes → Enlace de la página).');
    default:
      return say('No entendí 🤔\n\n' + HELP);
  }
}

export async function handleUpdate(env, db, update) {
  try {
    if (update.callback_query) return await handleCallback(env, db, update.callback_query);
    if (update.message) return await handleMessage(env, db, update.message);
  } catch (e) {
    console.error('Error en el bot:', e);
  }
}
