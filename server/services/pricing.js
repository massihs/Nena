import { db, getSettings } from '../db.js';
import { HttpError, now } from '../util.js';
import { bbox, haversineKm } from './geo.js';
import { countAvailableDrivers } from './drivers.js';

export function getRideTypes({ includeInactive = false } = {}) {
  const sql = includeInactive
    ? 'SELECT * FROM ride_types ORDER BY sort'
    : 'SELECT * FROM ride_types WHERE active = 1 ORDER BY sort';
  return db.prepare(sql).all();
}

export function getRideType(key) {
  return db.prepare('SELECT * FROM ride_types WHERE key = ?').get(key);
}

// Fares are rounded up to the nearest 1,000 toman.
export const roundFare = (x) => Math.ceil(x / 1000) * 1000;

export function fareFor(type, distanceKm, durationMin, surge = 1) {
  const raw = type.base_fare + type.per_km * distanceKm + type.per_min * durationMin;
  return roundFare(Math.max(type.min_fare, raw) * surge);
}

const SURGE_RADIUS_KM = 3;

// Dynamic pricing: compare open requests with idle drivers near the point.
export function surgeAt(lat, lng) {
  const s = getSettings();
  if (!s.surge_enabled) return 1;
  const b = bbox(lat, lng, SURGE_RADIUS_KM);
  const demand = db.prepare(`SELECT pickup_lat AS lat, pickup_lng AS lng FROM rides
      WHERE status IN ('searching', 'no_driver') AND created_at > ?
      AND pickup_lat BETWEEN ? AND ? AND pickup_lng BETWEEN ? AND ?`)
    .all(now() - 10 * 60 * 1000, b.minLat, b.maxLat, b.minLng, b.maxLng)
    .filter((p) => haversineKm(p, { lat, lng }) <= SURGE_RADIUS_KM).length;
  const supply = countAvailableDrivers(lat, lng, SURGE_RADIUS_KM);
  if (demand <= supply) return 1;
  const surge = 1 + (0.2 * (demand - supply)) / Math.max(1, supply);
  return Math.min(s.surge_max, Math.round(surge * 10) / 10);
}

export function promoDiscount(promo, fare) {
  if (!promo) return 0;
  const raw = promo.kind === 'percent' ? Math.round((fare * promo.value) / 100) : promo.value;
  const capped = promo.max_discount ? Math.min(raw, promo.max_discount) : raw;
  return Math.min(fare, Math.floor(capped / 1000) * 1000);
}

// Throws a user-facing error if the code can't be used; otherwise returns the promo row.
export function checkPromo(code, userId, fare) {
  const promo = db.prepare('SELECT * FROM promos WHERE code = ? COLLATE NOCASE').get(String(code || '').trim());
  if (!promo || !promo.active) throw new HttpError(400, 'کد تخفیف معتبر نیست');
  if (promo.expires_at && promo.expires_at < now()) throw new HttpError(400, 'مهلت استفاده از این کد تمام شده است');
  if (promo.usage_limit != null && promo.used_count >= promo.usage_limit) throw new HttpError(400, 'ظرفیت این کد تخفیف تکمیل شده است');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM promo_uses WHERE code = ? AND user_id = ?').get(promo.code, userId);
  if (n >= promo.per_user_limit) throw new HttpError(400, 'شما قبلاً از این کد استفاده کرده‌اید');
  if (fare != null && fare < promo.min_fare) throw new HttpError(400, 'مبلغ سفر برای این کد کافی نیست');
  return promo;
}
