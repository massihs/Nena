import { db, getSettings } from '../db.js';
import { HttpError, now, parseJson } from '../util.js';
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

const IRST_OFFSET = 3.5 * 3600 * 1000; // Iran Standard Time, no daylight saving since 2022

// Weekday (0 = Sunday) and minute of day in Tehran.
export function tehranClock(t = now()) {
  const d = new Date(t + IRST_OFFSET);
  return { day: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function zoneApplies(z, typeKey, clock) {
  const types = parseJson(z.ride_types, []);
  if (types.length && typeKey && !types.includes(typeKey)) return false;
  const days = parseJson(z.days, []);
  if (days.length && !days.includes(clock.day)) return false;
  if (z.start_minute == null || z.end_minute == null) return true;
  return z.start_minute <= z.end_minute
    ? clock.minute >= z.start_minute && clock.minute < z.end_minute
    : clock.minute >= z.start_minute || clock.minute < z.end_minute; // overnight window
}

// Live demand/supply ratio near a point.
function dynamicSurge(lat, lng, s) {
  const radius = s.surge_radius_km;
  const b = bbox(lat, lng, radius);
  const demand = db.prepare(`SELECT pickup_lat AS lat, pickup_lng AS lng FROM rides
      WHERE status IN ('searching', 'no_driver') AND created_at > ?
      AND pickup_lat BETWEEN ? AND ? AND pickup_lng BETWEEN ? AND ?`)
    .all(now() - 10 * 60 * 1000, b.minLat, b.maxLat, b.minLng, b.maxLng)
    .filter((p) => haversineKm(p, { lat, lng }) <= radius).length;
  const supply = countAvailableDrivers(lat, lng, radius);
  const multiplier = demand <= supply ? 1
    : Math.min(s.surge_max, Math.round((1 + (s.surge_sensitivity * (demand - supply)) / Math.max(1, supply)) * 10) / 10);
  return { demand, supply, multiplier };
}

// Full breakdown: the multiplier is the higher of dynamic pricing and any matching manual zone,
// capped by surge_zone_max. Scheduled rides pass { at, dynamic: false }: only zones apply.
export function surgeDetail(lat, lng, typeKey, { at = now(), dynamic = true } = {}) {
  const s = getSettings();
  if (!s.surge_enabled) return { multiplier: 1, dynamic: 1, zone: null, demand: 0, supply: 0, enabled: false };
  const dyn = dynamic ? dynamicSurge(lat, lng, s) : { demand: 0, supply: 0, multiplier: 1 };
  const clock = tehranClock(at);
  let zone = null;
  for (const z of db.prepare('SELECT * FROM surge_zones WHERE active = 1').all()) {
    if (haversineKm(z, { lat, lng }) > z.radius_km || !zoneApplies(z, typeKey, clock)) continue;
    if (!zone || z.multiplier > zone.multiplier) zone = z;
  }
  const multiplier = Math.min(s.surge_zone_max, Math.max(dyn.multiplier, zone?.multiplier || 1));
  return {
    multiplier: Math.round(multiplier * 10) / 10, dynamic: dyn.multiplier, demand: dyn.demand, supply: dyn.supply,
    zone: zone && { id: zone.id, name: zone.name, multiplier: zone.multiplier }, enabled: true,
  };
}

export const surgeAt = (lat, lng, typeKey, opts) => surgeDetail(lat, lng, typeKey, opts).multiplier;

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
