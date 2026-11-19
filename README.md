# 💅 Leya Nails — Catálogo y citas

Página con catálogo de servicios y diseños, reservas en línea, panel de administración y bot de Telegram.

- **Página pública:** `/`
- **Panel de administración:** `/admin.html`
- **Bot de Telegram:** avisa de cada cita nueva (con botones Confirmar / Rechazar / WhatsApp) y permite administrar desde el chat.

El mismo código funciona en **Cloudflare (gratis)** o en **cualquier hosting con Node**.

---

## 1. Probar en tu PC

Requisitos: Node 22.13 o más nuevo.

```bash
npm install
npm run dev
```

Abre http://localhost:8787 y el panel en http://localhost:8787/admin.html.
La contraseña está en el archivo `.env` (`ADMIN_PASSWORD`).

### Bot de Telegram en tu PC
1. En Telegram habla con **@BotFather** → `/newbot` → elige nombre y usuario (ej. `LeyaNailsBot`). Te da un **token**.
2. Pega el token en `.env` → `TELEGRAM_TOKEN=...` (deja `POLLING=1`).
3. Reinicia `npm run dev`.
4. Desde el Telegram de tu esposa, abre el bot y envía: `/admin LA_CONTRASEÑA`.
5. Haz una reserva de prueba en la página → le llega el aviso.

> Con `POLLING=1` el bot solo funciona mientras tu PC tenga el servidor encendido. En la publicación real se usa webhook.

---

## 2. Publicar en Cloudflare (gratis)

Necesitas VPN para crear la cuenta y publicar. Las clientas **no** necesitan VPN para ver la página.

```bash
npx wrangler login                    # abre el navegador para entrar a tu cuenta
npm run cf:db:create                  # crea la base de datos; copia el "database_id"
```
Pega ese `database_id` en `wrangler.toml` y sigue:

```bash
npm run cf:db:init                    # crea las tablas y los servicios iniciales
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TELEGRAM_TOKEN
npm run cf:deploy                     # publica. Te da una dirección tipo https://leya-nails.TU-USUARIO.workers.dev
```

Después:
1. Abre `https://…workers.dev/admin.html` → **Ajustes** → **Conectar bot**.
2. En Telegram envía `/admin LA_CONTRASEÑA` al bot (si no lo hiciste ya).
3. Pulsa **Enviar mensaje de prueba**.
4. **Prueba sin VPN** desde un móvil en Cuba (datos y WiFi).

Para publicar cambios del código más adelante: `npm run cf:deploy` (los precios, diseños y citas **no** se pierden; viven en la base de datos).

---

## 3. Plan B: otro hosting con Node

Si Cloudflare no funciona, el mismo proyecto corre con `npm start` en cualquier servidor con Node (Render, Koyeb, Fly.io, un VPS o un PC siempre encendido).

Variables de entorno: `ADMIN_PASSWORD`, `TELEGRAM_TOKEN`, `POLLING=0`, `PORT` (lo pone el hosting), `DATA_DIR` (carpeta donde guardar la base de datos).

⚠️ Los datos se guardan en `DATA_DIR/leya.db`. En hostings gratuitos con disco temporal (ej. Render gratis) ese archivo **se borra** al reiniciar; ahí hay que usar un disco persistente.

Tras publicar, en el panel → **Ajustes** → **Conectar bot**.

---

## Cómo funcionan las reservas

- La clienta elige **servicio → día en el almanaque → turno (mañana o tarde) → sus datos**.
- Días de trabajo: lunes a viernes (se cambia en Panel → Ajustes).
- 2 turnos por día; las horas de cada turno y cuántas clientas caben en cada uno se cambian en Ajustes.
- En el almanaque: verde = hay turno libre, rojo = lleno, apagado = no se trabaja / bloqueado.
- Enlace directo para compartir: `https://tu-pagina/#agendar` abre la reserva; `#agendar-3` la abre con el servicio 3 ya elegido.

## Comandos del bot (solo la administradora)

| Comando | Qué hace |
|---|---|
| `/hoy`, `/manana`, `/semana` | Citas del día / mañana / próximos 7 días |
| `/pendientes` | Solicitudes sin responder |
| `/tasa 400` | Cambia la tasa CUP/USD (todos los precios se recalculan) |
| `/precios` | Lista de servicios con su número |
| `/precio 3 25` | Cambia el precio del servicio #3 |
| `/bloquear 24/12 Navidad` | Cierra un día · `/desbloquear 24/12` lo abre |
| 📷 foto con texto `Francesa rosa - 15 #francesas` | Publica un diseño nuevo |
| `/disenos`, `/borrar 12` | Lista o elimina diseños |
| `/web` | Enlaces de la página y del panel |

Las clientas que escriban al bot reciben un botón para abrir la página y reservar.

## Estructura

```
public/        página, panel y estilos (HTML/CSS/JS sin dependencias externas)
src/app.js     API (catálogo, horas libres, reservas, administración)
src/telegram.js bot
src/lib.js     horarios, disponibilidad, precios
src/worker.js  entrada para Cloudflare
server/node.js entrada para Node (SQLite local)
schema.sql     tablas y datos iniciales
```
