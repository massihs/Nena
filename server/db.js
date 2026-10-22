import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  wallet INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by INTEGER REFERENCES users(id),
  referral_rewarded INTEGER NOT NULL DEFAULT 0,
  emergency_contact TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  status_reason TEXT,
  national_id TEXT,
  license_no TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'eco',
  vehicle_model TEXT,
  vehicle_color TEXT,
  vehicle_year INTEGER,
  plate TEXT,
  sheba TEXT,
  documents TEXT NOT NULL DEFAULT '{}',
  online INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  heading REAL,
  last_seen INTEGER,
  current_ride_id INTEGER,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  offers_received INTEGER NOT NULL DEFAULT 0,
  offers_accepted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drivers_online ON drivers(online, status);

CREATE TABLE IF NOT EXISTS ride_types (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL DEFAULT 'car',
  seats INTEGER NOT NULL DEFAULT 4,
  vehicle_types TEXT NOT NULL,
  base_fare INTEGER NOT NULL,
  per_km INTEGER NOT NULL,
  per_min INTEGER NOT NULL,
  min_fare INTEGER NOT NULL,
  wait_per_min INTEGER NOT NULL DEFAULT 2000,
  commission_pct REAL NOT NULL DEFAULT 15,
  is_delivery INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rider_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL REFERENCES ride_types(key),
  status TEXT NOT NULL,
  pickup_lat REAL NOT NULL, pickup_lng REAL NOT NULL, pickup_address TEXT,
  dropoff_lat REAL NOT NULL, dropoff_lng REAL NOT NULL, dropoff_address TEXT,
  stops TEXT NOT NULL DEFAULT '[]',
  distance_km REAL, duration_min REAL, route TEXT,
  surge REAL NOT NULL DEFAULT 1,
  fare_estimate INTEGER NOT NULL,
  wait_fee INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  fare_final INTEGER,
  commission INTEGER,
  tip INTEGER NOT NULL DEFAULT 0,
  promo_code TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  paid_wallet INTEGER NOT NULL DEFAULT 0,
  paid_cash INTEGER NOT NULL DEFAULT 0,
  pin TEXT,
  share_token TEXT UNIQUE,
  notes TEXT,
  recipient_name TEXT,
  recipient_phone TEXT,
  rating_by_rider INTEGER, comment_by_rider TEXT, tags_by_rider TEXT,
  rating_by_driver INTEGER, comment_by_driver TEXT,
  cancel_reason TEXT, cancelled_by TEXT, cancel_fee INTEGER NOT NULL DEFAULT 0,
  offered_driver_id INTEGER, offer_expires_at INTEGER,
  declined TEXT NOT NULL DEFAULT '[]',
  scheduled_at INTEGER,
  created_at INTEGER NOT NULL,
  search_started_at INTEGER,
  accepted_at INTEGER, arrived_at INTEGER, started_at INTEGER,
  completed_at INTEGER, cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS rides_rider ON rides(rider_id, created_at);
CREATE INDEX IF NOT EXISTS rides_driver ON rides(driver_id, created_at);
CREATE INDEX IF NOT EXISTS rides_status ON rides(status);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER NOT NULL REFERENCES rides(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL,
  ride_id INTEGER,
  description TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_user ON transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  authority TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  ref_id TEXT,
  return_app TEXT NOT NULL DEFAULT 'rider',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  sheba TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE TABLE IF NOT EXISTS saved_places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  title TEXT NOT NULL,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS promos (
  code TEXT PRIMARY KEY,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'percent',
  value INTEGER NOT NULL,
  max_discount INTEGER,
  min_fare INTEGER NOT NULL DEFAULT 0,
  usage_limit INTEGER,
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS promo_uses (
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  ride_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sos_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER REFERENCES rides(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  lat REAL, lng REAL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT 'other',
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  popularity INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS places_name_cat ON places(name, category);

CREATE TABLE IF NOT EXISTS surge_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_km REAL NOT NULL,
  multiplier REAL NOT NULL,
  ride_types TEXT NOT NULL DEFAULT '[]',
  days TEXT NOT NULL DEFAULT '[]',
  start_minute INTEGER,
  end_minute INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function closeDb() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } catch { /* already closed */ }
}

let txDepth = 0;
// Runs fn inside a transaction; nested calls join the outer transaction.
export function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

// --- seed data ------------------------------------------------------------

const RIDE_TYPES = [
  // key, name, description, icon, seats, vehicle_types, base, per_km, per_min, min, wait/min, commission, delivery, sort
  ['eco', 'نِنا اکو', 'سفر اقتصادی و به‌صرفه', 'car', 4, 'eco,black', 25000, 9000, 1500, 50000, 2000, 15, 0, 1],
  ['black', 'نِنا بلک', 'خودروی لوکس مشکی با راننده حرفه‌ای', 'car-black', 4, 'black', 70000, 20000, 3500, 140000, 5000, 20, 0, 2],
  // Services below are kept for later but launched disabled (see CATALOG_VERSION).
  ['plus', 'نِنا پلاس', 'خودروهای نو و راحت', 'car-plus', 4, 'plus', 40000, 13000, 2200, 80000, 3000, 15, 0, 3],
  ['van', 'نِنا ون', 'تا ۶ مسافر با بار بیشتر', 'van', 6, 'van', 55000, 16000, 2500, 110000, 3500, 15, 0, 3],
  ['bike', 'نِنا موتور', 'سریع‌ترین راه عبور از ترافیک', 'bike', 1, 'bike', 15000, 6000, 900, 35000, 1500, 12, 0, 4],
  ['box', 'نِنا باکس', 'ارسال مرسوله با پیک موتوری', 'box', 0, 'bike', 20000, 7000, 1000, 40000, 1500, 12, 1, 5],
];

export const DEFAULT_SETTINGS = {
  surge_enabled: true,
  surge_max: 2,
  // Dynamic surge: +sensitivity per extra open request per idle driver, measured within surge_radius_km.
  surge_sensitivity: 0.2,
  surge_radius_km: 3,
  // Hard ceiling for any multiplier, including manual zones.
  surge_zone_max: 3,
  cancel_fee: 20000,
  free_cancel_seconds: 120,
  free_wait_minutes: 3,
  no_show_wait_minutes: 5,
  offer_timeout_seconds: 15,
  search_radius_km: 6,
  max_search_seconds: 120,
  require_pin: false,
  referral_bonus: 50000,
  min_payout: 100000,
  support_phone: '021-00000000',
};

const insertType = db.prepare(`INSERT OR IGNORE INTO ride_types
  (key, name, description, icon, seats, vehicle_types, base_fare, per_km, per_min, min_fare, wait_per_min, commission_pct, is_delivery, sort)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const t of RIDE_TYPES) insertType.run(...t);

// Launch catalogue: only Eco and Black. Applied once, so admins can re-enable other services later.
const CATALOG_VERSION = 2;
const catalog = db.prepare("SELECT value FROM settings WHERE key = 'catalog_version'").get();
if (!catalog || Number(JSON.parse(catalog.value)) < CATALOG_VERSION) {
  db.prepare("UPDATE ride_types SET active = CASE WHEN key IN ('eco', 'black') THEN 1 ELSE 0 END").run();
  db.prepare("UPDATE ride_types SET vehicle_types = 'eco,black' WHERE key = 'eco'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('catalog_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(CATALOG_VERSION));
}

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, JSON.stringify(v));

db.prepare(`INSERT OR IGNORE INTO promos (code, description, kind, value, max_discount, min_fare, usage_limit, per_user_limit)
  VALUES ('NENA50', '۵۰٪ تخفیف سفر اول تا سقف ۴۰ هزار تومان', 'percent', 50, 40000, 0, NULL, 1)`).run();

let settingsCache = null;
export function getSettings() {
  if (!settingsCache) {
    settingsCache = { ...DEFAULT_SETTINGS };
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
      settingsCache[row.key] = JSON.parse(row.value);
    }
  }
  return settingsCache;
}

export function updateSettings(patch) {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const def = DEFAULT_SETTINGS[k];
    const value = typeof def === 'boolean' ? Boolean(v) : typeof def === 'number' ? Number(v) : String(v);
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    upsert.run(k, JSON.stringify(value));
  }
  settingsCache = null;
  return getSettings();
}
