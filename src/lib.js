// Utilidades compartidas: ajustes, horarios, disponibilidad, formato.

export const TZ = 'America/Havana';

export const PUBLIC_SETTINGS = [
  'business_name', 'tagline', 'phone', 'whatsapp', 'address',
  'base_currency', 'rate', 'work_days', 'morning_time', 'afternoon_time',
  'shift_capacity', 'min_notice_hours', 'max_days_ahead',
];

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of results) s[r.key] = r.value ?? '';
  return s;
}

export async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value ?? '')).run();
}

/** Fecha y minutos actuales en La Habana. */
export function nowLocal() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (+parts.hour) * 60 + (+parts.minute) };
}

export const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
export const toHHMM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d + 'T12:00:00Z'));
export const dayOfWeek = d => new Date(d + 'T12:00:00Z').getUTCDay(); // 0 = domingo

export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function prettyDate(date) {
  const d = new Date(date + 'T12:00:00Z');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}
export function prettyTime(t) {
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

export function formatPrice(price, s) {
  const p = Number(price) || 0;
  if (!p) return 'Consultar';
  const rate = Number(s.rate) || 0;
  const fmt = n => Math.round(n).toLocaleString('es-ES', { useGrouping: 'always' });
  if (s.base_currency === 'CUP') {
    return rate ? `${fmt(p)} CUP (≈ ${(p / rate).toFixed(1)} USD)` : `${fmt(p)} CUP`;
  }
  return rate ? `${fmt(p * rate)} CUP (${p} USD)` : `${p} USD`;
}

/** ¿Está el día abierto para reservas? Devuelve motivo si no. */
export async function dayStatus(db, s, date) {
  if (!isDate(date)) return 'Fecha inválida';
  const now = nowLocal();
  if (date < now.date) return 'Fecha pasada';
  if (date > addDays(now.date, Number(s.max_days_ahead) || 30)) return 'Fecha demasiado lejana';
  const days = String(s.work_days || '').split(',').map(Number);
  if (!days.includes(dayOfWeek(date))) return 'No se trabaja ese día';
  const b = await db.prepare('SELECT date FROM blocked WHERE date = ?').bind(date).first();
  if (b) return 'Día no disponible';
  return null;
}

/** Los dos turnos del día, con su hora de inicio. */
export function shiftsOf(s) {
  return [
    { id: 'am', label: 'Mañana', time: s.morning_time || '09:00' },
    { id: 'pm', label: 'Tarde', time: s.afternoon_time || '13:00' },
  ];
}
export function shiftLabel(s, time) {
  const sh = shiftsOf(s).find(x => x.time === time);
  return sh ? `Turno de la ${sh.label.toLowerCase()} (${prettyTime(time)})` : prettyTime(time);
}

/** Turnos de `date` con cupos libres. `appts` opcional (para no repetir consultas). */
export async function shiftsForDay(db, s, date, appts = null) {
  if (await dayStatus(db, s, date)) return [];
  if (!appts) {
    ({ results: appts } = await db.prepare(
      "SELECT time FROM appointments WHERE date = ? AND status IN ('pending','confirmed')").bind(date).all());
  }
  const cap = Math.max(1, Number(s.shift_capacity) || 1);
  const now = nowLocal();
  const minStart = date === now.date ? now.minutes + (Number(s.min_notice_hours) || 0) * 60 : -1;
  return shiftsOf(s).map(sh => {
    const taken = appts.filter(a => a.time === sh.time).length;
    const free = toMin(sh.time) >= minStart && taken < cap;
    return { ...sh, free, left: Math.max(0, cap - taken) };
  });
}

/** Disponibilidad de cada día de un mes (YYYY-MM): 'open' | 'full' | 'closed'. */
export async function monthAvailability(db, s, month) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const { results: appts } = await db.prepare(
    "SELECT date, time FROM appointments WHERE date >= ? AND date <= ? AND status IN ('pending','confirmed')").bind(first, last).all();
  const { results: blocked } = await db.prepare('SELECT date FROM blocked WHERE date >= ? AND date <= ?').bind(first, last).all();
  const blockedSet = new Set(blocked.map(b => b.date));
  const now = nowLocal();
  const maxDate = addDays(now.date, Number(s.max_days_ahead) || 30);
  const work = String(s.work_days || '').split(',').map(Number);
  const cap = Math.max(1, Number(s.shift_capacity) || 1);
  const minStart = now.minutes + (Number(s.min_notice_hours) || 0) * 60;
  const days = {};
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (d < now.date || d > maxDate || !work.includes(dayOfWeek(d)) || blockedSet.has(d)) { days[d] = 'closed'; continue; }
    const dayAppts = appts.filter(a => a.date === d);
    const upcoming = shiftsOf(s).filter(sh => d !== now.date || toMin(sh.time) >= minStart);
    if (!upcoming.length) { days[d] = 'closed'; continue; }
    days[d] = upcoming.some(sh => dayAppts.filter(a => a.time === sh.time).length < cap) ? 'open' : 'full';
  }
  return days;
}

// Base64 que funciona igual en Workers y en Node
export function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
