import { db } from '../db.js';
import { now, parseJson } from '../util.js';
import { bbox, haversineKm, etaMinutes } from './geo.js';
import { emitTo } from '../realtime.js';

const STALE_MS = 90 * 1000;

export function getDriver(userId) {
  return db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(userId);
}

export const driverRating = (d) => (d.rating_count ? Math.round((d.rating_sum / d.rating_count) * 100) / 100 : 5);

export function driverView(d) {
  if (!d) return null;
  const docs = parseJson(d.documents, {});
  return {
    status: d.status,
    status_reason: d.status_reason,
    national_id: d.national_id,
    license_no: d.license_no,
    vehicle_type: d.vehicle_type,
    vehicle_model: d.vehicle_model,
    vehicle_color: d.vehicle_color,
    vehicle_year: d.vehicle_year,
    plate: d.plate,
    sheba: d.sheba,
    documents: Object.fromEntries(Object.keys(docs).map((k) => [k, true])),
    online: !!d.online,
    lat: d.lat,
    lng: d.lng,
    current_ride_id: d.current_ride_id,
    rating: driverRating(d),
    rating_count: d.rating_count,
    acceptance_rate: d.offers_received ? Math.round((d.offers_accepted / d.offers_received) * 100) : 100,
  };
}

function nearbyRows(lat, lng, radiusKm, vehicleTypes, excludeIds = []) {
  const b = bbox(lat, lng, radiusKm);
  const types = vehicleTypes.length ? vehicleTypes : ['eco'];
  return db.prepare(`SELECT d.*, u.name FROM drivers d JOIN users u ON u.id = d.user_id
      WHERE d.online = 1 AND d.status = 'approved' AND u.blocked = 0 AND d.current_ride_id IS NULL
      AND d.last_seen > ? AND d.lat BETWEEN ? AND ? AND d.lng BETWEEN ? AND ?
      AND d.vehicle_type IN (${types.map(() => '?').join(',')})
      AND d.user_id NOT IN (SELECT offered_driver_id FROM rides WHERE status = 'searching' AND offered_driver_id IS NOT NULL)`)
    .all(now() - STALE_MS, b.minLat, b.maxLat, b.minLng, b.maxLng, ...types)
    .filter((d) => !excludeIds.includes(d.user_id))
    .map((d) => ({ ...d, distance_km: haversineKm({ lat, lng }, d) }))
    .filter((d) => d.distance_km <= radiusKm)
    .sort((a, b2) => a.distance_km - b2.distance_km);
}

export function findAvailableDrivers(lat, lng, radiusKm, vehicleTypes, excludeIds) {
  return nearbyRows(lat, lng, radiusKm, vehicleTypes, excludeIds).map((d) => ({ ...d, eta_min: etaMinutes(d.distance_km) }));
}

export function countAvailableDrivers(lat, lng, radiusKm) {
  return nearbyRows(lat, lng, radiusKm, ['eco', 'plus', 'van', 'bike']).length;
}

export function updateDriverLocation(userId, { lat, lng, heading }) {
  lat = Number(lat); lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const h = Number.isFinite(Number(heading)) ? Number(heading) : null;
  db.prepare('UPDATE drivers SET lat = ?, lng = ?, heading = COALESCE(?, heading), last_seen = ? WHERE user_id = ?')
    .run(lat, lng, h, now(), userId);
  const d = getDriver(userId);
  if (d?.current_ride_id) {
    const ride = db.prepare('SELECT id, rider_id FROM rides WHERE id = ?').get(d.current_ride_id);
    if (ride) emitTo(ride.rider_id, 'driver:location', { ride_id: ride.id, lat, lng, heading: d.heading });
  }
}
