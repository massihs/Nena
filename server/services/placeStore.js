import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { HttpError, now, parseJson } from '../util.js';
import { buildIndex, loadSeed, normalizeFa } from './places.js';
import { haversineKm } from './geo.js';

const SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/places.json');
export const CATEGORIES = ['square', 'metro', 'neighbourhood', 'mall', 'hospital', 'university', 'transport', 'landmark', 'street', 'other'];

const rowView = (r) => ({ ...r, aliases: parseJson(r.aliases, []), active: !!r.active });

export function refreshIndex() {
  buildIndex(db.prepare('SELECT * FROM places WHERE active = 1').all().map(rowView));
}

// Seed rows follow places.json; places added by admins or learned from users are never overwritten.
function seed() {
  const upsert = db.prepare(`INSERT INTO places (name, aliases, category, address, lat, lng, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'seed', ?)
    ON CONFLICT(name, category) DO UPDATE SET aliases = excluded.aliases, address = excluded.address,
      lat = excluded.lat, lng = excluded.lng WHERE places.source = 'seed'`);
  for (const p of loadSeed(SEED_FILE)) {
    upsert.run(p.name, JSON.stringify(p.aliases || []), p.category, p.address || '', p.lat, p.lng, now());
  }
}

seed();
refreshIndex();

const inIran = (lat, lng) => lat > 24 && lat < 40.5 && lng > 43.5 && lng < 64;

// A user picked a search result: popular places rank higher next time. Results that came from
// OpenStreetMap are remembered so later searches find them instantly (public places only;
// pins dropped on the map are never stored).
export function recordSelection({ id, title, address, lat, lng }) {
  if (id) {
    db.prepare('UPDATE places SET popularity = popularity + 1 WHERE id = ?').run(Number(id));
    return;
  }
  lat = Number(lat); lng = Number(lng);
  const name = String(title || '').trim().slice(0, 80);
  if (!name || !inIran(lat, lng)) return;
  const same = db.prepare('SELECT * FROM places WHERE name = ?').all(name).find((p) => haversineKm(p, { lat, lng }) < 0.3);
  if (same) {
    db.prepare('UPDATE places SET popularity = popularity + 1 WHERE id = ?').run(same.id);
    return;
  }
  // Name+category is unique, so several same-named places from OSM are told apart by address.
  const category = 'other';
  const area = String(address || '').split('،').map((x) => x.trim()).find((x) => x && x !== name);
  const label = db.prepare('SELECT 1 FROM places WHERE name = ? AND category = ?').get(name, category)
    ? `${name} (${area || lat.toFixed(3)})` : name;
  db.prepare(`INSERT OR IGNORE INTO places (name, category, address, lat, lng, popularity, source, created_at)
    VALUES (?, ?, ?, ?, ?, 1, 'osm', ?)`).run(label, category, String(address || '').slice(0, 200), lat, lng, now());
  refreshIndex();
}

export function listPlaces({ q = '', category = '', limit = 200 } = {}) {
  const rows = db.prepare(`SELECT * FROM places WHERE (? = '' OR category = ?) ORDER BY popularity DESC, id DESC`).all(category, category);
  const nq = normalizeFa(q);
  return rows.map(rowView)
    .filter((p) => !nq || normalizeFa(`${p.name} ${p.aliases.join(' ')} ${p.address}`).includes(nq))
    .slice(0, limit);
}

export function savePlace(body, id = null) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (name.length < 2) throw new HttpError(400, 'نام مکان را وارد کنید');
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!inIran(lat, lng)) throw new HttpError(400, 'موقعیت مکان را روی نقشه مشخص کنید');
  const category = CATEGORIES.includes(body.category) ? body.category : 'other';
  const aliases = String(body.aliases ?? '').split(/[،,]/).map((a) => a.trim()).filter(Boolean).slice(0, 10);
  const address = String(body.address || '').trim().slice(0, 200);
  try {
    if (id) {
      db.prepare(`UPDATE places SET name = ?, aliases = ?, category = ?, address = ?, lat = ?, lng = ?,
        active = ?, source = CASE source WHEN 'seed' THEN 'admin' ELSE source END WHERE id = ?`)
        .run(name, JSON.stringify(aliases), category, address, lat, lng, body.active === false ? 0 : 1, id);
    } else {
      id = db.prepare(`INSERT INTO places (name, aliases, category, address, lat, lng, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'admin', ?)`).run(name, JSON.stringify(aliases), category, address, lat, lng, now()).lastInsertRowid;
    }
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new HttpError(400, 'مکانی با همین نام و دسته وجود دارد');
    throw err;
  }
  refreshIndex();
  return rowView(db.prepare('SELECT * FROM places WHERE id = ?').get(id));
}

export function deletePlace(id) {
  db.prepare('DELETE FROM places WHERE id = ?').run(Number(id));
  refreshIndex();
}
