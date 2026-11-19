// API principal. Funciona igual en Cloudflare Workers y en Node.
import { Hono } from 'hono';
import {
  getSettings, setSetting, PUBLIC_SETTINGS, shiftsForDay, monthAvailability, dayStatus, nowLocal,
  isDate, b64ToBytes, clean,
} from './lib.js';
import { handleUpdate, notifyNewAppointment, tg, webhookSecret } from './telegram.js';

const app = new Hono();
const db = c => c.env.DB;
const bad = (c, msg, code = 400) => c.json({ error: msg }, code);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Error interno del servidor' }, 500);
});

// ---------- Público ----------

app.get('/api/catalog', async c => {
  const s = await getSettings(db(c));
  const settings = Object.fromEntries(PUBLIC_SETTINGS.map(k => [k, s[k] ?? '']));
  const { results: services } = await db(c).prepare(
    'SELECT id, name, description, price, image_id FROM services WHERE active = 1 ORDER BY sort, id').all();
  const { results: designs } = await db(c).prepare(
    'SELECT id, title, category, price, image_id, featured FROM designs WHERE active = 1 ORDER BY featured DESC, id DESC').all();
  const { results: blocked } = await db(c).prepare('SELECT date FROM blocked WHERE date >= ?').bind(nowLocal().date).all();
  c.header('Cache-Control', 'no-store');
  return c.json({ settings, services, designs, blocked: blocked.map(b => b.date), today: nowLocal().date });
});

app.get('/api/month', async c => {
  const month = c.req.query('m') || nowLocal().date.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return bad(c, 'Mes inválido');
  const s = await getSettings(db(c));
  c.header('Cache-Control', 'no-store');
  return c.json({ month, today: nowLocal().date, days: await monthAvailability(db(c), s, month) });
});

app.get('/api/shifts', async c => {
  const date = c.req.query('date');
  const s = await getSettings(db(c));
  const reason = await dayStatus(db(c), s, date);
  c.header('Cache-Control', 'no-store');
  return c.json({ date, reason, shifts: reason ? [] : await shiftsForDay(db(c), s, date) });
});

app.post('/api/appointments', async c => {
  const b = await c.req.json().catch(() => ({}));
  if (b.website) return c.json({ ok: true }); // trampa anti-bots
  const name = clean(b.name, 60);
  const phone = clean(b.phone, 30);
  const notes = clean(b.notes, 300);
  const { date, time } = b;
  if (name.length < 2) return bad(c, 'Escribe tu nombre');
  if (!/^\d{8}$/.test(phone)) return bad(c, 'El teléfono debe tener exactamente 8 números');
  if (!isDate(date) || !/^\d{2}:\d{2}$/.test(time || '')) return bad(c, 'Elige el día y el turno');

  const service = await db(c).prepare('SELECT * FROM services WHERE id = ? AND active = 1').bind(Number(b.service_id)).first();
  if (!service) return bad(c, 'Elige un servicio');
  let design = null;
  if (b.design_id) design = await db(c).prepare('SELECT id, title FROM designs WHERE id = ? AND active = 1').bind(Number(b.design_id)).first();

  const s = await getSettings(db(c));
  const shifts = await shiftsForDay(db(c), s, date);
  if (!shifts.some(sh => sh.time === time && sh.free)) return bad(c, 'Ese turno ya no está disponible, elige otro', 409);

  const digits = phone;
  const { results: pend } = await db(c).prepare(
    "SELECT phone FROM appointments WHERE status = 'pending' AND date >= ?").bind(nowLocal().date).all();
  if (pend.filter(p => p.phone.replace(/\D/g, '').slice(-8) === digits).length >= 3) {
    return bad(c, 'Ya tienes solicitudes pendientes. Te contactaremos pronto.', 429);
  }

  const r = await db(c).prepare(
    `INSERT INTO appointments (service_id, service_name, design_id, design_title, client_name, phone, date, time, duration, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(service.id, service.name, design?.id ?? null, design?.title ?? null, name, `+53 ${phone}`, date, time, 0, notes).run();
  const appt = await db(c).prepare('SELECT * FROM appointments WHERE id = ?').bind(r.meta.last_row_id).first();
  try { await notifyNewAppointment(c.env, db(c), appt); } catch (e) { console.error('Aviso Telegram falló', e); }
  return c.json({ ok: true, id: appt.id });
});

app.get('/img/:id{[0-9]+}', async c => {
  const img = await db(c).prepare('SELECT mime, data FROM images WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!img) return c.notFound();
  return new Response(b64ToBytes(img.data), {
    headers: { 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
});

// ---------- Telegram (webhook) ----------

app.post('/api/telegram', async c => {
  if (c.req.header('x-telegram-bot-api-secret-token') !== await webhookSecret(c.env)) return c.text('forbidden', 403);
  const update = await c.req.json().catch(() => null);
  if (update) await handleUpdate(c.env, db(c), update);
  return c.text('ok');
});

// ---------- Administración ----------

app.use('/api/admin/*', async (c, next) => {
  const pass = c.env.ADMIN_PASSWORD;
  if (!pass) return bad(c, 'Falta configurar ADMIN_PASSWORD en el servidor', 500);
  if (c.req.header('x-admin-key') !== pass) return bad(c, 'Contraseña incorrecta', 401);
  await next();
});

app.get('/api/admin/data', async c => {
  const D = db(c);
  const settings = await getSettings(D);
  const { results: services } = await D.prepare('SELECT * FROM services ORDER BY sort, id').all();
  const { results: designs } = await D.prepare('SELECT * FROM designs ORDER BY featured DESC, id DESC').all();
  const { results: appointments } = await D.prepare(
    'SELECT * FROM appointments WHERE date >= ? ORDER BY date, time LIMIT 300').bind(addDaysBack(nowLocal().date, 14)).all();
  const { results: blocked } = await D.prepare('SELECT * FROM blocked WHERE date >= ? ORDER BY date').bind(nowLocal().date).all();
  return c.json({ settings, services, designs, appointments, blocked, today: nowLocal().date, telegram: !!c.env.TELEGRAM_TOKEN });
});

function addDaysBack(date, n) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
}

const EDITABLE_SETTINGS = [...PUBLIC_SETTINGS, 'site_url'];
app.put('/api/admin/settings', async c => {
  const b = await c.req.json();
  for (const k of EDITABLE_SETTINGS) if (k in b) await setSetting(db(c), k, clean(b[k], 500));
  return c.json({ ok: true });
});

app.post('/api/admin/images', async c => {
  const { mime, data } = await c.req.json();
  if (!/^image\/(jpeg|png|webp)$/.test(mime || '')) return bad(c, 'Formato de imagen no válido');
  if (!data || data.length > 1_500_000) return bad(c, 'Imagen demasiado grande');
  const r = await db(c).prepare('INSERT INTO images (mime, data) VALUES (?, ?)').bind(mime, data).run();
  return c.json({ id: r.meta.last_row_id });
});

async function swapImage(D, table, id, newImageId) {
  if (newImageId === undefined) return;
  const old = await D.prepare(`SELECT image_id FROM ${table} WHERE id = ?`).bind(id).first();
  if (old?.image_id && old.image_id !== newImageId) await D.prepare('DELETE FROM images WHERE id = ?').bind(old.image_id).run();
}
const num = (v, d = 0) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? d : Number(v));

// Servicios
app.post('/api/admin/services', async c => {
  const b = await c.req.json();
  if (!clean(b.name)) return bad(c, 'Falta el nombre');
  const r = await db(c).prepare('INSERT INTO services (name, description, price, image_id, active, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(clean(b.name, 80), clean(b.description, 400), num(b.price), b.image_id ?? null, b.active === false ? 0 : 1, num(b.sort)).run();
  return c.json({ id: r.meta.last_row_id });
});
app.put('/api/admin/services/:id', async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  await swapImage(db(c), 'services', id, b.image_id);
  await db(c).prepare('UPDATE services SET name = ?, description = ?, price = ?, image_id = ?, active = ?, sort = ? WHERE id = ?')
    .bind(clean(b.name, 80), clean(b.description, 400), num(b.price), b.image_id ?? null, b.active ? 1 : 0, num(b.sort), id).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/services/:id', async c => {
  const id = Number(c.req.param('id'));
  await swapImage(db(c), 'services', id, null);
  await db(c).prepare('DELETE FROM services WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Diseños
app.post('/api/admin/designs', async c => {
  const b = await c.req.json();
  const r = await db(c).prepare('INSERT INTO designs (title, category, price, image_id, featured, active) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(clean(b.title, 80) || 'Diseño', clean(b.category, 40), b.price === '' || b.price == null ? null : num(b.price), b.image_id ?? null, b.featured ? 1 : 0, b.active === false ? 0 : 1).run();
  return c.json({ id: r.meta.last_row_id });
});
app.put('/api/admin/designs/:id', async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  await swapImage(db(c), 'designs', id, b.image_id);
  await db(c).prepare('UPDATE designs SET title = ?, category = ?, price = ?, image_id = ?, featured = ?, active = ? WHERE id = ?')
    .bind(clean(b.title, 80) || 'Diseño', clean(b.category, 40), b.price === '' || b.price == null ? null : num(b.price), b.image_id ?? null, b.featured ? 1 : 0, b.active ? 1 : 0, id).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/designs/:id', async c => {
  const id = Number(c.req.param('id'));
  await swapImage(db(c), 'designs', id, null);
  await db(c).prepare('DELETE FROM designs WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Citas
app.put('/api/admin/appointments/:id', async c => {
  const { status } = await c.req.json();
  if (!['pending', 'confirmed', 'rejected', 'cancelled', 'done'].includes(status)) return bad(c, 'Estado no válido');
  await db(c).prepare('UPDATE appointments SET status = ? WHERE id = ?').bind(status, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/appointments/:id', async c => {
  await db(c).prepare('DELETE FROM appointments WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// Días bloqueados
app.post('/api/admin/blocked', async c => {
  const { date, reason } = await c.req.json();
  if (!isDate(date)) return bad(c, 'Fecha inválida');
  await db(c).prepare('INSERT OR REPLACE INTO blocked (date, reason) VALUES (?, ?)').bind(date, clean(reason, 100)).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/blocked/:date', async c => {
  await db(c).prepare('DELETE FROM blocked WHERE date = ?').bind(c.req.param('date')).run();
  return c.json({ ok: true });
});

// Telegram: conectar webhook y probar
function publicOrigin(c) {
  const u = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') || u.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') || u.host;
  return `${proto}://${host}`;
}
app.get('/api/admin/telegram/status', async c => {
  if (!c.env.TELEGRAM_TOKEN) return c.json({ configured: false });
  const me = await tg(c.env, 'getMe');
  const hook = await tg(c.env, 'getWebhookInfo');
  const s = await getSettings(db(c));
  return c.json({
    configured: true, polling: !!c.env.POLLING, bot: me.result?.username, admin: !!s.admin_chat_id,
    webhook: hook.result?.url || '', last_error: hook.result?.last_error_message || '',
  });
});
app.post('/api/admin/telegram/setup', async c => {
  const origin = publicOrigin(c);
  if (!origin.startsWith('https://')) return bad(c, 'El webhook necesita una dirección https (la página publicada). En local se usa el modo POLLING.');
  const r = await tg(c.env, 'setWebhook', {
    url: `${origin}/api/telegram`, secret_token: await webhookSecret(c.env),
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
  });
  await setSetting(db(c), 'site_url', origin);
  return c.json({ ok: r.ok, description: r.description });
});
app.post('/api/admin/telegram/test', async c => {
  const s = await getSettings(db(c));
  if (!s.admin_chat_id) return bad(c, 'Primero envía al bot: /admin TU_CONTRASEÑA');
  const r = await tg(c.env, 'sendMessage', { chat_id: s.admin_chat_id, text: '💅 Prueba desde el panel: ¡el bot funciona!' });
  return c.json({ ok: r.ok, description: r.description });
});

export default app;
