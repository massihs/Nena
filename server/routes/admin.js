import { Router } from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { config } from '../config.js';
import { db, getSettings, updateSettings } from '../db.js';
import { HttpError, int, now, parseJson } from '../util.js';
import { requireAdmin, userView } from '../auth.js';
import { emitTo } from '../realtime.js';
import { driverView } from '../services/drivers.js';
import { getRideTypes } from '../services/pricing.js';
import { getRide, rideView, cancelByRider, emitRideUpdate } from '../services/rides.js';
import { withdrawOffersFor } from '../services/matching.js';
import { addTx } from '../services/wallet.js';
import { listPlaces, savePlace, deletePlace } from '../services/placeStore.js';
import { economics } from '../services/economics.js';
import { surgeDetail } from '../services/pricing.js';

const router = Router();
router.use(requireAdmin);

const DAY = 24 * 3600 * 1000;

router.get('/stats', (_req, res) => {
  const since = now() - DAY;
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const today = one(`SELECT COUNT(*) AS trips, COALESCE(SUM(fare_final), 0) AS gmv, COALESCE(SUM(commission), 0) AS commission,
    COALESCE(SUM(discount), 0) AS discounts FROM rides WHERE status = 'completed' AND completed_at > ?`, since);
  const daily = db.prepare(`SELECT (completed_at / ${DAY}) AS day, COUNT(*) AS trips, SUM(fare_final) AS gmv FROM rides
    WHERE status = 'completed' AND completed_at > ? GROUP BY day ORDER BY day`).all(now() - 14 * DAY)
    .map((r) => ({ date: r.day * DAY, trips: r.trips, gmv: r.gmv }));
  res.json({
    today,
    daily,
    active_rides: one("SELECT COUNT(*) AS n FROM rides WHERE status IN ('searching','accepted','arrived','in_progress')").n,
    cancelled_today: one("SELECT COUNT(*) AS n FROM rides WHERE status = 'cancelled' AND cancelled_at > ?", since).n,
    no_driver_today: one("SELECT COUNT(*) AS n FROM rides WHERE status = 'no_driver' AND created_at > ?", since).n,
    online_drivers: one("SELECT COUNT(*) AS n FROM drivers WHERE online = 1 AND status = 'approved' AND last_seen > ?", now() - 90000).n,
    pending_drivers: one("SELECT COUNT(*) AS n FROM drivers WHERE status = 'pending'").n,
    total_users: one('SELECT COUNT(*) AS n FROM users').n,
    total_drivers: one("SELECT COUNT(*) AS n FROM drivers WHERE status = 'approved'").n,
    open_sos: one('SELECT COUNT(*) AS n FROM sos_alerts WHERE resolved = 0').n,
    pending_payouts: one("SELECT COUNT(*) AS n FROM payouts WHERE status = 'pending'").n,
  });
});

router.get('/live', (_req, res) => {
  const drivers = db.prepare(`SELECT d.user_id, d.lat, d.lng, d.heading, d.vehicle_type, d.current_ride_id, u.name
    FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.online = 1 AND d.last_seen > ?`).all(now() - 90000);
  const rides = db.prepare("SELECT * FROM rides WHERE status IN ('searching','accepted','arrived','in_progress') ORDER BY id DESC")
    .all().map((r) => rideView(r, 'admin'));
  res.json({ drivers, rides });
});

router.get('/drivers', (req, res) => {
  const status = String(req.query.status || '');
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare(`SELECT d.*, u.name, u.phone, u.wallet, u.blocked,
      (SELECT COUNT(*) FROM rides r WHERE r.driver_id = d.user_id AND r.status = 'completed') AS trips
    FROM drivers d JOIN users u ON u.id = d.user_id
    WHERE (? = '' OR d.status = ?) AND (u.name LIKE ? OR u.phone LIKE ? OR d.plate LIKE ?)
    ORDER BY d.created_at DESC LIMIT 200`).all(status, status, q, q, q);
  res.json({
    drivers: rows.map((d) => ({
      ...driverView(d), user_id: d.user_id, name: d.name, phone: d.phone, wallet: d.wallet, blocked: !!d.blocked,
      trips: d.trips, created_at: d.created_at, document_files: parseJson(d.documents, {}),
    })),
  });
});

router.post('/drivers/:id/status', (req, res) => {
  const status = String(req.body?.status);
  if (!['approved', 'rejected', 'suspended', 'pending'].includes(status)) throw new HttpError(400, 'وضعیت نامعتبر است');
  const id = Number(req.params.id);
  const d = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(id);
  if (!d) throw new HttpError(404, 'راننده یافت نشد');
  if (status !== 'approved' && d.current_ride_id) throw new HttpError(400, 'راننده در حال انجام سفر است');
  db.prepare('UPDATE drivers SET status = ?, status_reason = ?, online = CASE WHEN ? = \'approved\' THEN online ELSE 0 END WHERE user_id = ?')
    .run(status, String(req.body?.reason || '') || null, status, id);
  if (status !== 'approved') withdrawOffersFor(id);
  const text = { approved: 'حساب رانندگی شما تأیید شد؛ می‌توانید آنلاین شوید 🎉', rejected: 'درخواست رانندگی شما رد شد', suspended: 'حساب رانندگی شما موقتاً تعلیق شد' }[status];
  if (text) emitTo(id, 'notice', { text, refresh: true });
  res.json({ ok: true });
});

router.get('/documents/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.resolve(config.uploadDir, file);
  if (!fs.existsSync(full)) throw new HttpError(404, 'فایل یافت نشد');
  res.sendFile(full);
});

router.get('/users', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM rides r WHERE r.rider_id = u.id AND r.status = 'completed') AS trips
    FROM users u WHERE u.name LIKE ? OR u.phone LIKE ? ORDER BY u.id DESC LIMIT 200`).all(q, q);
  res.json({ users: rows.map((u) => ({ ...userView(u), blocked: !!u.blocked, trips: u.trips })) });
});

router.post('/users/:id/block', (req, res) => {
  const id = Number(req.params.id);
  const blocked = req.body?.blocked ? 1 : 0;
  db.prepare('UPDATE users SET blocked = ? WHERE id = ? AND is_admin = 0').run(blocked, id);
  if (blocked) {
    db.prepare('UPDATE drivers SET online = 0 WHERE user_id = ?').run(id);
    withdrawOffersFor(id);
  }
  res.json({ ok: true });
});

router.post('/users/:id/wallet', (req, res) => {
  const amount = int(req.body?.amount, { min: -100000000, max: 100000000, name: 'مبلغ' });
  const description = String(req.body?.description || 'اصلاح موجودی توسط پشتیبانی').slice(0, 200);
  res.json({ balance: addTx(Number(req.params.id), amount, 'adjustment', { description }) });
});

router.get('/rides', (req, res) => {
  const status = String(req.query.status || '');
  const rows = db.prepare('SELECT * FROM rides WHERE (? = \'\' OR status = ?) ORDER BY id DESC LIMIT 200').all(status, status);
  res.json({ rides: rows.map((r) => rideView(r, 'admin')) });
});

router.get('/rides/:id', (req, res) => {
  const ride = getRide(req.params.id);
  if (!ride) throw new HttpError(404, 'سفر یافت نشد');
  const messages = db.prepare('SELECT * FROM messages WHERE ride_id = ? ORDER BY id').all(ride.id);
  res.json({ ride: rideView(ride, 'admin'), messages });
});

router.post('/rides/:id/cancel', (req, res) => {
  const ride = getRide(req.params.id);
  if (!ride) throw new HttpError(404, 'سفر یافت نشد');
  if (ride.status === 'in_progress') {
    db.prepare("UPDATE rides SET status = 'cancelled', cancelled_by = 'admin', cancel_reason = ?, cancelled_at = ? WHERE id = ?")
      .run('لغو توسط پشتیبانی', now(), ride.id);
    db.prepare('UPDATE drivers SET current_ride_id = NULL WHERE user_id = ?').run(ride.driver_id);
    emitRideUpdate(getRide(ride.id));
    return res.json({ ride: rideView(getRide(ride.id), 'admin') });
  }
  // Support cancellations never charge the rider.
  cancelByRider(ride, 'لغو توسط پشتیبانی', { by: 'admin', waiveFee: true });
  res.json({ ride: rideView(getRide(ride.id), 'admin') });
});

router.get('/ride-types', (_req, res) => res.json({ ride_types: getRideTypes({ includeInactive: true }) }));

router.put('/ride-types/:key', (req, res) => {
  const b = req.body || {};
  const t = db.prepare('SELECT * FROM ride_types WHERE key = ?').get(req.params.key);
  if (!t) throw new HttpError(404, 'سرویس یافت نشد');
  const num = (k, opts) => (b[k] === undefined ? t[k] : int(b[k], { min: 0, name: k, ...opts }));
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 40) || t.name : t.name;
  const description = b.description !== undefined ? String(b.description).slice(0, 120) : t.description;
  const commission = b.commission_pct === undefined ? t.commission_pct : Number(b.commission_pct);
  if (!Number.isFinite(commission) || commission < 0 || commission > 50) throw new HttpError(400, 'کمیسیون باید بین ۰ تا ۵۰ درصد باشد');
  db.prepare(`UPDATE ride_types SET name = ?, description = ?, base_fare = ?, per_km = ?, per_min = ?, min_fare = ?, wait_per_min = ?,
    commission_pct = ?, active = ? WHERE key = ?`).run(
    name, description, num('base_fare'), num('per_km'), num('per_min'), num('min_fare'), num('wait_per_min'),
    commission, b.active === undefined ? t.active : (b.active ? 1 : 0), t.key,
  );
  res.json({ ride_type: db.prepare('SELECT * FROM ride_types WHERE key = ?').get(t.key) });
});

router.get('/economics', (req, res) => {
  const days = [1, 7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.json(economics(days));
});

// --- surge pricing -----------------------------------------------------------

const zoneView = (z) => ({ ...z, ride_types: parseJson(z.ride_types, []), days: parseJson(z.days, []), active: !!z.active });

function zoneInput(b) {
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'نام محدوده را وارد کنید');
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'مرکز محدوده را روی نقشه مشخص کنید');
  const radius = Number(b.radius_km);
  if (!(radius >= 0.3 && radius <= 30)) throw new HttpError(400, 'شعاع باید بین ۰٫۳ تا ۳۰ کیلومتر باشد');
  const multiplier = Math.round(Number(b.multiplier) * 10) / 10;
  if (!(multiplier >= 1.1 && multiplier <= 5)) throw new HttpError(400, 'ضریب باید بین ۱٫۱ تا ۵ باشد');
  const types = (Array.isArray(b.ride_types) ? b.ride_types : []).filter((k) => db.prepare('SELECT 1 FROM ride_types WHERE key = ?').get(k));
  const days = (Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const minute = (v) => (v === '' || v == null ? null : Number(v));
  const start = minute(b.start_minute), end = minute(b.end_minute);
  for (const m of [start, end]) if (m != null && !(Number.isInteger(m) && m >= 0 && m < 1440)) throw new HttpError(400, 'بازه زمانی نامعتبر است');
  if ((start == null) !== (end == null) || (start != null && start === end)) throw new HttpError(400, 'ساعت شروع و پایان را کامل وارد کنید');
  return [name, lat, lng, radius, multiplier, JSON.stringify(types), JSON.stringify([...new Set(days)]), start, end, b.active === false ? 0 : 1];
}

router.get('/surge/zones', (_req, res) => {
  res.json({ zones: db.prepare('SELECT * FROM surge_zones ORDER BY active DESC, id DESC').all().map(zoneView) });
});
router.post('/surge/zones', (req, res) => {
  const { lastInsertRowid } = db.prepare(`INSERT INTO surge_zones (name, lat, lng, radius_km, multiplier, ride_types, days, start_minute, end_minute, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...zoneInput(req.body || {}), now());
  res.status(201).json({ zone: zoneView(db.prepare('SELECT * FROM surge_zones WHERE id = ?').get(lastInsertRowid)) });
});
router.put('/surge/zones/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM surge_zones WHERE id = ?').get(id)) throw new HttpError(404, 'محدوده یافت نشد');
  db.prepare(`UPDATE surge_zones SET name = ?, lat = ?, lng = ?, radius_km = ?, multiplier = ?, ride_types = ?, days = ?,
    start_minute = ?, end_minute = ?, active = ? WHERE id = ?`).run(...zoneInput(req.body || {}), id);
  res.json({ zone: zoneView(db.prepare('SELECT * FROM surge_zones WHERE id = ?').get(id)) });
});
router.delete('/surge/zones/:id', (req, res) => {
  db.prepare('DELETE FROM surge_zones WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Current multiplier at one point, per active service, with its breakdown.
router.get('/surge/preview', (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'موقعیت نامعتبر است');
  const services = getRideTypes().map((t) => ({ key: t.key, name: t.name, ...surgeDetail(lat, lng, t.key) }));
  res.json({ services });
});

// Live surge over a grid covering the area with drivers or requests (default: the configured city).
router.get('/surge/map', (req, res) => {
  const type = String(req.query.type || 'eco');
  const pts = db.prepare(`SELECT lat, lng FROM drivers WHERE online = 1 AND lat IS NOT NULL
    UNION ALL SELECT pickup_lat, pickup_lng FROM rides WHERE created_at > ?`).all(now() - 3600 * 1000);
  const [cLat, cLng] = config.map.center;
  const lats = pts.map((p) => p.lat).concat(cLat - 0.12, cLat + 0.12);
  const lngs = pts.map((p) => p.lng).concat(cLng - 0.16, cLng + 0.16);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const N = 14;
  const dLat = (maxLat - minLat) / N, dLng = (maxLng - minLng) / N;
  const cells = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const lat = minLat + (i + 0.5) * dLat, lng = minLng + (j + 0.5) * dLng;
      const d = surgeDetail(lat, lng, type);
      if (d.multiplier > 1 || d.demand || d.supply) {
        cells.push({ south: lat - dLat / 2, west: lng - dLng / 2, north: lat + dLat / 2, east: lng + dLng / 2, multiplier: d.multiplier, dynamic: d.dynamic, demand: d.demand, supply: d.supply, zone: d.zone?.name || null });
      }
    }
  }
  const s = getSettings();
  res.json({ cells, max: s.surge_zone_max, enabled: s.surge_enabled });
});

router.get('/places', (req, res) => {
  res.json({ places: listPlaces({ q: req.query.q, category: String(req.query.category || '') }) });
});
router.post('/places', (req, res) => res.status(201).json({ place: savePlace(req.body || {}) }));
router.put('/places/:id', (req, res) => res.json({ place: savePlace(req.body || {}, Number(req.params.id)) }));
router.delete('/places/:id', (req, res) => { deletePlace(req.params.id); res.json({ ok: true }); });

router.get('/settings', (_req, res) => res.json({ settings: getSettings(), storage: storageInfo() }));

function storageInfo() {
  let size = 0;
  try { if (config.dbPath !== ':memory:') size = fs.statSync(config.dbPath).size; } catch { /* not created yet */ }
  return { persistent: config.persistentStorage, path: config.dbPath, size_bytes: size };
}

// Consistent snapshot of the whole database (safe while the app is running).
router.get('/backup', (_req, res) => {
  const file = path.join(os.tmpdir(), `nena-backup-${Date.now()}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  const stamp = new Date(Date.now() + 3.5 * 3600 * 1000).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.download(file, `nena-backup-${stamp}.db`, () => fs.rm(file, { force: true }, () => {}));
});
router.put('/settings', (req, res) => res.json({ settings: updateSettings(req.body || {}) }));

router.get('/promos', (_req, res) => res.json({ promos: db.prepare('SELECT * FROM promos ORDER BY rowid DESC').all() }));

router.post('/promos', (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new HttpError(400, 'کد باید ۳ تا ۲۰ حرف لاتین یا عدد باشد');
  const kind = b.kind === 'fixed' ? 'fixed' : 'percent';
  const value = int(b.value, { min: 1, max: kind === 'percent' ? 100 : 10000000, name: 'مقدار تخفیف' });
  const opt = (k) => (b[k] === '' || b[k] == null ? null : int(b[k], { min: 0, name: k }));
  db.prepare(`INSERT INTO promos (code, description, kind, value, max_discount, min_fare, usage_limit, per_user_limit, expires_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(code) DO UPDATE SET description = excluded.description, kind = excluded.kind, value = excluded.value,
      max_discount = excluded.max_discount, min_fare = excluded.min_fare, usage_limit = excluded.usage_limit,
      per_user_limit = excluded.per_user_limit, expires_at = excluded.expires_at`)
    .run(code, String(b.description || '').slice(0, 200), kind, value, opt('max_discount'), opt('min_fare') || 0,
      opt('usage_limit'), opt('per_user_limit') || 1, opt('expires_at'));
  res.status(201).json({ promo: db.prepare('SELECT * FROM promos WHERE code = ?').get(code) });
});

router.post('/promos/:code/active', (req, res) => {
  db.prepare('UPDATE promos SET active = ? WHERE code = ?').run(req.body?.active ? 1 : 0, req.params.code);
  res.json({ ok: true });
});

router.get('/sos', (_req, res) => {
  const rows = db.prepare(`SELECT s.*, u.name, u.phone FROM sos_alerts s JOIN users u ON u.id = s.user_id
    ORDER BY s.resolved, s.id DESC LIMIT 100`).all();
  res.json({ alerts: rows });
});

router.post('/sos/:id/resolve', (req, res) => {
  db.prepare('UPDATE sos_alerts SET resolved = 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/payouts', (_req, res) => {
  const rows = db.prepare(`SELECT p.*, u.name, u.phone FROM payouts p JOIN users u ON u.id = p.driver_id
    ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.id DESC LIMIT 200`).all();
  res.json({ payouts: rows });
});

router.post('/payouts/:id', (req, res) => {
  const status = req.body?.status === 'paid' ? 'paid' : req.body?.status === 'rejected' ? 'rejected' : null;
  if (!status) throw new HttpError(400, 'وضعیت نامعتبر است');
  const p = db.prepare("SELECT * FROM payouts WHERE id = ? AND status = 'pending'").get(Number(req.params.id));
  if (!p) throw new HttpError(404, 'درخواست یافت نشد');
  db.prepare('UPDATE payouts SET status = ?, processed_at = ? WHERE id = ?').run(status, now(), p.id);
  if (status === 'rejected') addTx(p.driver_id, p.amount, 'payout_refund', { description: 'برگشت درخواست تسویه' });
  emitTo(p.driver_id, 'notice', { text: status === 'paid' ? 'تسویه حساب شما واریز شد' : 'درخواست تسویه شما رد شد و مبلغ به کیف پول برگشت' });
  res.json({ ok: true });
});

export default router;
