// Contraseña del panel, sesiones, bloqueo por intentos y recuperación por Telegram.
import { getSettings, setSetting, bytesToB64, b64ToBytes } from './lib.js';

const ITER = 10000;              // PBKDF2 (ligero para el plan gratis de Cloudflare)
const SESSION_DAYS = 7;
const MAX_FAILS = 5;             // intentos fallidos antes de bloquear
const LOCK_MIN = 15;             // minutos de bloqueo
const CODE_MIN = 10;             // minutos de validez del código de recuperación
const CODE_TRIES = 5;
export const MIN_PASSWORD = 8;

const enc = new TextEncoder();
const now = () => Date.now();

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Comparación en tiempo constante. */
function same(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return bytesToB64(new Uint8Array(bits));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${bytesToB64(salt)}$${await pbkdf2(password, salt, ITER)}`;
}

async function checkHash(password, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !hash) return false;
  return same(await pbkdf2(password, b64ToBytes(salt), Number(iter)), hash);
}

/**
 * ¿Es correcta la contraseña? Vale la guardada en el panel o la llave maestra (ADMIN_PASSWORD).
 */
export async function verifyPassword(env, db, password) {
  if (!password) return false;
  if (env.ADMIN_PASSWORD && same(password, env.ADMIN_PASSWORD)) return true;
  const s = await getSettings(db);
  return s.admin_pass_hash ? checkHash(password, s.admin_pass_hash) : false;
}

export async function setPassword(db, password) {
  await setSetting(db, 'admin_pass_hash', await hashPassword(password));
}

// ---------- Bloqueo por intentos ----------

export function clientId(c) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';
}

/** Minutos que faltan de bloqueo (0 si no está bloqueado). */
export async function lockedMinutes(db, who) {
  const r = await db.prepare('SELECT until FROM auth_fails WHERE who = ?').bind(who).first();
  return r && r.until > now() ? Math.ceil((r.until - now()) / 60000) : 0;
}

export async function registerFail(db, who) {
  const r = await db.prepare('SELECT fails, until FROM auth_fails WHERE who = ?').bind(who).first();
  const fails = (r && r.until && r.until <= now() ? 0 : r?.fails || 0) + 1;
  const until = fails >= MAX_FAILS ? now() + LOCK_MIN * 60000 : 0;
  await db.prepare('INSERT INTO auth_fails (who, fails, until) VALUES (?, ?, ?) ON CONFLICT(who) DO UPDATE SET fails = excluded.fails, until = excluded.until')
    .bind(who, until ? 0 : fails, until).run();
  return { left: Math.max(0, MAX_FAILS - fails), locked: !!until };
}

export async function clearFails(db, who) {
  await db.prepare('DELETE FROM auth_fails WHERE who = ?').bind(who).run();
}

// ---------- Sesiones ----------

export async function createSession(db) {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()).run();
  await db.prepare('INSERT INTO sessions (token_hash, expires) VALUES (?, ?)')
    .bind(await sha256hex(token), now() + SESSION_DAYS * 86400000).run();
  return token;
}

export async function validSession(db, token) {
  if (!token || token.length !== 64) return false;
  const r = await db.prepare('SELECT expires FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).first();
  return !!r && r.expires > now();
}

export async function endSession(db, token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run();
}

export async function endAllSessions(db, exceptToken = '') {
  const keep = exceptToken ? await sha256hex(exceptToken) : '';
  await db.prepare('DELETE FROM sessions WHERE token_hash != ?').bind(keep).run();
}

export const bearer = c => (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '').trim();

// ---------- Código de recuperación ----------

/** Crea un código de 6 cifras. Devuelve null si se pidió otro hace menos de 60 s. */
export async function newResetCode(db) {
  const s = await getSettings(db);
  if (Number(s.reset_sent || 0) > now() - 60000) return null;
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  const code = String(n).padStart(6, '0');
  await setSetting(db, 'reset_code', await sha256hex('reset:' + code));
  await setSetting(db, 'reset_expires', now() + CODE_MIN * 60000);
  await setSetting(db, 'reset_tries', 0);
  await setSetting(db, 'reset_sent', now());
  return code;
}

/** 'ok' | 'expired' | 'wrong' | 'too_many' */
export async function checkResetCode(db, code) {
  const s = await getSettings(db);
  if (!s.reset_code || Number(s.reset_expires || 0) < now()) return 'expired';
  const tries = Number(s.reset_tries || 0) + 1;
  if (tries > CODE_TRIES) { await setSetting(db, 'reset_code', ''); return 'too_many'; }
  await setSetting(db, 'reset_tries', tries);
  if (!same(await sha256hex('reset:' + String(code || '').trim()), s.reset_code)) return 'wrong';
  await setSetting(db, 'reset_code', '');
  return 'ok';
}

export const CODE_MINUTES = CODE_MIN;
