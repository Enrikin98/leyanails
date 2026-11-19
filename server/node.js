// Servidor para Node (tu PC o cualquier hosting con Node: Render, Koyeb, un VPS...).
// Usa un archivo SQLite local con la misma API que Cloudflare D1.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import api from '../src/app.js';
import { handleUpdate, tg } from '../src/telegram.js';

if (existsSync('.env')) process.loadEnvFile('.env');

// --- Adaptador mínimo compatible con D1 ---
class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map(v => (v === undefined ? null : v))); }
  async first(col) {
    const r = this.db.prepare(this.sql).get(...this.params);
    if (!r) return null;
    return col ? r[col] : { ...r };
  }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params).map(r => ({ ...r })) }; }
  async run() {
    const i = this.db.prepare(this.sql).run(...this.params);
    return { meta: { last_row_id: Number(i.lastInsertRowid), changes: Number(i.changes) } };
  }
}
class D1Shim {
  constructor(file) { this.db = new DatabaseSync(file); this.db.exec('PRAGMA journal_mode = WAL;'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async exec(sql) { this.db.exec(sql); }
}

const dataDir = process.env.DATA_DIR || './data';
mkdirSync(dataDir, { recursive: true });
const DB = new D1Shim(`${dataDir}/leya.db`);
await DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

const env = {
  DB,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  SITE_URL: process.env.SITE_URL,
  POLLING: process.env.POLLING === '1',
};

const app = new Hono();
app.get('/admin', c => c.redirect('/admin.html'));
app.route('/', api);
app.use('/*', serveStatic({ root: './public' }));

const port = Number(process.env.PORT) || 8787;
serve({ fetch: (req) => app.fetch(req, env), port }, () => {
  console.log(`\n💅 Leya Nails funcionando en http://localhost:${port}`);
  console.log(`⚙️  Panel: http://localhost:${port}/admin.html\n`);
  if (!env.ADMIN_PASSWORD) console.warn('⚠️  Falta ADMIN_PASSWORD en .env');
});

// --- Modo POLLING: el bot funciona sin dirección pública (ideal para probar en tu PC) ---
if (env.POLLING && env.TELEGRAM_TOKEN) {
  await tg(env, 'deleteWebhook', {});
  console.log('🤖 Bot de Telegram en modo POLLING');
  let offset = 0;
  (async function loop() {
    for (;;) {
      try {
        const r = await tg(env, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of r.result || []) { offset = u.update_id + 1; await handleUpdate(env, DB, u); }
        if (!r.ok) await new Promise(res => setTimeout(res, 5000));
      } catch (e) {
        console.error('Polling:', e.message);
        await new Promise(res => setTimeout(res, 5000));
      }
    }
  })();
}
