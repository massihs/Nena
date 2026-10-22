import { db, tx, getSettings } from '../db.js';
import { HttpError, now, parseJson } from '../util.js';
import { emitTo } from '../realtime.js';
import { findAvailableDrivers } from './drivers.js';
import { getRideType } from './pricing.js';
import { getRide, rideView, emitRideUpdate } from './rides.js';
import { haversineKm, etaMinutes } from './geo.js';

// Dispatch offers a searching ride to the nearest idle driver, one at a time, until one accepts
// or the search times out. Timers are in memory; resumeDispatch() rebuilds them after a restart.
const timers = new Map();
const RETRY_MS = 4000;

function clearTimer(rideId) {
  clearTimeout(timers.get(rideId));
  timers.delete(rideId);
}

export function startDispatch(rideId) {
  clearTimer(rideId);
  offerNext(rideId);
}

export function stopDispatch(rideId) {
  clearTimer(rideId);
}

function offerNext(rideId) {
  const ride = getRide(rideId);
  if (!ride || ride.status !== 'searching') return clearTimer(rideId);
  const s = getSettings();

  if (now() - ride.search_started_at > s.max_search_seconds * 1000) {
    clearTimer(rideId);
    db.prepare(`UPDATE rides SET status = 'no_driver', offered_driver_id = NULL, offer_expires_at = NULL
      WHERE id = ? AND status = 'searching'`).run(rideId);
    emitRideUpdate(getRide(rideId));
    return;
  }

  const type = getRideType(ride.type);
  const declined = parseJson(ride.declined, []);
  // Prefer the ride's own class: a Black car only takes an Eco ride when it is clearly the closer option.
  const primary = type.vehicle_types.split(',')[0];
  const [driver] = findAvailableDrivers(ride.pickup_lat, ride.pickup_lng, s.search_radius_km, type.vehicle_types.split(','), declined)
    .sort((a, b) => (a.distance_km + (a.vehicle_type === primary ? 0 : 1.5)) - (b.distance_km + (b.vehicle_type === primary ? 0 : 1.5)));
  if (!driver) {
    db.prepare('UPDATE rides SET offered_driver_id = NULL, offer_expires_at = NULL WHERE id = ?').run(rideId);
    timers.set(rideId, setTimeout(() => offerNext(rideId), RETRY_MS));
    return;
  }

  const expiresAt = now() + s.offer_timeout_seconds * 1000;
  const { changes } = db.prepare(`UPDATE rides SET offered_driver_id = ?, offer_expires_at = ?
    WHERE id = ? AND status = 'searching'`).run(driver.user_id, expiresAt, rideId);
  if (!changes) return;
  db.prepare('UPDATE drivers SET offers_received = offers_received + 1 WHERE user_id = ?').run(driver.user_id);

  emitTo(driver.user_id, 'ride:offer', offerPayload(getRide(rideId), driver));
  timers.set(rideId, setTimeout(() => declineOffer(rideId, driver.user_id), expiresAt - now() + 500));
}

export function offerPayload(ride, driver) {
  const pickupKm = haversineKm(driver, { lat: ride.pickup_lat, lng: ride.pickup_lng });
  return {
    ride: rideView(ride, 'driver'),
    expires_at: ride.offer_expires_at,
    timeout_seconds: getSettings().offer_timeout_seconds,
    pickup_distance_km: Math.round(pickupKm * 10) / 10,
    pickup_eta_min: etaMinutes(pickupKm),
  };
}

export function declineOffer(rideId, driverId) {
  const ride = getRide(rideId);
  if (!ride || ride.status !== 'searching' || ride.offered_driver_id !== driverId) return false;
  const declined = [...new Set([...parseJson(ride.declined, []), driverId])];
  db.prepare('UPDATE rides SET declined = ?, offered_driver_id = NULL, offer_expires_at = NULL WHERE id = ?')
    .run(JSON.stringify(declined), rideId);
  emitTo(driverId, 'ride:offer_cancel', { ride_id: rideId });
  clearTimer(rideId);
  offerNext(rideId);
  return true;
}

export function acceptOffer(rideId, driverId) {
  const ride = tx(() => {
    const t = now();
    const { changes } = db.prepare(`UPDATE rides SET status = 'accepted', driver_id = ?, accepted_at = ?,
        offered_driver_id = NULL, offer_expires_at = NULL
      WHERE id = ? AND status = 'searching' AND offered_driver_id = ? AND offer_expires_at >= ?`)
      .run(driverId, t, rideId, driverId, t - 1000);
    if (!changes) throw new HttpError(409, 'این درخواست دیگر در دسترس نیست');
    const busy = db.prepare('UPDATE drivers SET current_ride_id = ?, offers_accepted = offers_accepted + 1 WHERE user_id = ? AND current_ride_id IS NULL')
      .run(rideId, driverId);
    if (!busy.changes) throw new HttpError(409, 'شما در حال انجام سفر دیگری هستید');
    return getRide(rideId);
  });
  clearTimer(rideId);
  emitRideUpdate(ride);
  return ride;
}

// Withdraws any pending offer from a driver who goes offline.
export function withdrawOffersFor(driverId) {
  const rows = db.prepare("SELECT id FROM rides WHERE status = 'searching' AND offered_driver_id = ?").all(driverId);
  for (const { id } of rows) declineOffer(id, driverId);
}

let scheduler = null;

export function resumeDispatch() {
  db.prepare("UPDATE rides SET offered_driver_id = NULL, offer_expires_at = NULL WHERE status = 'searching'").run();
  for (const { id } of db.prepare("SELECT id FROM rides WHERE status = 'searching'").all()) {
    // Give searches interrupted by a restart a fresh window.
    db.prepare('UPDATE rides SET search_started_at = ? WHERE id = ?').run(now(), id);
    startDispatch(id);
  }
  scheduler = setInterval(releaseScheduledRides, 15000);
  scheduler.unref();
}

// Scheduled rides start searching 10 minutes before pickup.
export function releaseScheduledRides() {
  const due = db.prepare("SELECT id FROM rides WHERE status = 'scheduled' AND scheduled_at <= ?").all(now() + 10 * 60 * 1000);
  for (const { id } of due) {
    db.prepare("UPDATE rides SET status = 'searching', search_started_at = ? WHERE id = ? AND status = 'scheduled'").run(now(), id);
    emitRideUpdate(getRide(id));
    startDispatch(id);
  }
}

export function stopAllDispatch() {
  for (const id of timers.keys()) clearTimer(id);
  clearInterval(scheduler);
}
