-- Esquema de la base de datos (SQLite / Cloudflare D1)

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS images (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  mime TEXT NOT NULL,
  data TEXT NOT NULL -- base64
);

CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  price       REAL DEFAULT 0,
  duration    INTEGER DEFAULT 60,
  image_id    INTEGER,
  active      INTEGER DEFAULT 1,
  sort        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS designs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  category   TEXT DEFAULT '',
  price      REAL,
  image_id   INTEGER,
  featured   INTEGER DEFAULT 0,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id   INTEGER,
  service_name TEXT,
  design_id    INTEGER,
  design_title TEXT,
  client_name  TEXT NOT NULL,
  phone        TEXT NOT NULL,
  date         TEXT NOT NULL, -- YYYY-MM-DD
  time         TEXT NOT NULL, -- HH:MM
  duration     INTEGER NOT NULL,
  notes        TEXT DEFAULT '',
  status       TEXT DEFAULT 'pending', -- pending | confirmed | rejected | cancelled | done
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);

CREATE TABLE IF NOT EXISTS blocked (
  date   TEXT PRIMARY KEY,
  reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_fails (
  who   TEXT PRIMARY KEY,
  fails INTEGER DEFAULT 0,
  until INTEGER DEFAULT 0
);

-- Ajustes por defecto (no sobreescribe los existentes)
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('business_name', 'Leya Nails'),
  ('tagline', 'Con los mayores deseos de hacerte ver aún más bonita.'),
  ('phone', '55178989'),
  ('whatsapp', '5355178989'),
  ('address', ''),
  ('base_currency', 'USD'),
  ('rate', '0'),
  ('work_days', '1,2,3,4,5'),
  ('morning_time', '09:00'),
  ('afternoon_time', '13:00'),
  ('shift_capacity', '1'),
  ('min_notice_hours', '2'),
  ('max_days_ahead', '30'),
  ('admin_chat_id', ''),
  ('site_url', '');

-- Servicios iniciales (solo si la tabla está vacía). Precios de ejemplo: cámbialos en el panel.
INSERT INTO services (name, description, price, duration, sort)
SELECT column1, column2, column3, column4, column5 FROM (VALUES
  ('Poligel', 'Extensión o refuerzo con poligel, resistente y ligero.', 0, 120, 1),
  ('Base Rubber', 'Nivelación y refuerzo de la uña natural.', 0, 90, 2),
  ('Dipping', 'Sistema de polvo por inmersión, color duradero.', 0, 90, 3),
  ('Acrílico', 'Uñas acrílicas a tu medida.', 0, 150, 4),
  ('Esmaltado de Gel', 'Esmaltado semipermanente con brillo duradero.', 0, 60, 5),
  ('Manicura de Manos y Pies', 'Manicura y pedicura completa.', 0, 120, 6)
) WHERE NOT EXISTS (SELECT 1 FROM services);
