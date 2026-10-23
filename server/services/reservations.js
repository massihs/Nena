import { db, tx, getSettings } from '../db.js';
import { HttpError, now, parseJson } from '../util.js';
import { config } from '../config.js';
import { getRide, rideView, emitRideUpdate } from './rides.js';
import { getRideType } from './pricing.js';
import { haversineKm } from './geo.js';
import { startDispatch } from './matching.js';
import { notify } from './push.js';
import * as fa from './text.js';

const MIN = 60 * 1000;
// A driver cannot hold two reservations whose pickups are closer than this.
const MIN_GAP = 90 * MIN;
const RADIUS_KM = 40;

const vehicleOk = (ride, driver) => getRideType(ride.type)?.vehicle_types.split(',').includes(driver.vehicle_type);

// Upcoming reservations a driver could take: right vehicle class, not yet claimed, near them.
export function openReservations(driver) {
  const s = getSettings();
  const here = driver.lat != null ? driver : { lat: config.map.center[0], lng: config.map.center[1] };
  return db.prepare(`SELECT * FROM rides WHERE status = 'scheduled' AND reserved_driver_id IS NULL AND scheduled_at > ?
      ORDER BY scheduled_at LIMIT 200`).all(now() + s.reserve_activate_minutes * MIN)
    .filter((r) => vehicleOk(r, driver))
    .map((r) => ({ ...rideView(r, 'driver'), pickup_distance_km: Math.round(haversineKm(here, { lat: r.pickup_lat, lng: r.pickup_lng }) * 10) / 10 }))
    .filter((r) => r.pickup_distance_km <= RADIUS_KM);
}

export function myReservations(driverId) {
  return db.prepare("SELECT * FROM rides WHERE status = 'scheduled' AND reserved_driver_id = ? ORDER BY scheduled_at")
    .all(driverId).map((r) => rideView(r, 'driver'));
}

export function claimReservation(rideId, driver) {
  const ride = getRide(rideId);
  if (!ride || ride.status !== 'scheduled') throw new HttpError(404, 'این رزرو دیگر در دسترس نیست');
  if (!vehicleOk(ride, driver)) throw new HttpError(403, 'این رزرو برای نوع خودروی شما نیست');
  const clash = db.prepare(`SELECT 1 FROM rides WHERE status = 'scheduled' AND reserved_driver_id = ? AND ABS(scheduled_at - ?) < ?`)
    .get(driver.user_id, ride.scheduled_at, MIN_GAP);
  if (clash) throw new HttpError(409, 'در این بازه زمانی رزرو دیگری دارید');
  const { changes } = db.prepare("UPDATE rides SET reserved_driver_id = ? WHERE id = ? AND status = 'scheduled' AND reserved_driver_id IS NULL")
    .run(driver.user_id, rideId);
  if (!changes) throw new HttpError(409, 'راننده دیگری این رزرو را پذیرفت');
  const updated = getRide(rideId);
  emitRideUpdate(updated);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(driver.user_id);
  notify(updated.rider_id, 'rider', {
    title: 'راننده سفر رزروی شما مشخص شد',
    body: `${u.name} • ${driver.vehicle_model} ${driver.vehicle_color} — ${fa.dateTime(updated.scheduled_at)}`,
    tag: `reserve-${rideId}`,
  });
  return updated;
}

export function releaseReservation(rideId, driverId, { reason = 'driver' } = {}) {
  const ride = getRide(rideId);
  if (!ride || ride.status !== 'scheduled' || ride.reserved_driver_id !== driverId) throw new HttpError(404, 'رزرو یافت نشد');
  db.prepare('UPDATE rides SET reserved_driver_id = NULL WHERE id = ?').run(rideId);
  const updated = getRide(rideId);
  emitRideUpdate(updated);
  notify(updated.rider_id, 'rider', {
    title: 'تغییر راننده سفر رزروی',
    body: reason === 'unavailable'
      ? 'راننده رزرو در دسترس نیست؛ نزدیک‌ترین راننده برای شما فرستاده می‌شود'
      : `راننده رزرو ${fa.dateTime(updated.scheduled_at)} را لغو کرد؛ راننده دیگری پیدا می‌کنیم`,
    tag: `reserve-${rideId}`,
  });
  return updated;
}

function remind(ride, key, fn) {
  const sent = parseJson(ride.reminders, []);
  if (sent.includes(key)) return;
  db.prepare('UPDATE rides SET reminders = ? WHERE id = ?').run(JSON.stringify([...sent, key]), ride.id);
  fn();
}

// Called every few seconds by the scheduler.
export function processReservations() {
  const s = getSettings();
  const t = now();
  const rows = db.prepare("SELECT * FROM rides WHERE status = 'scheduled' AND scheduled_at <= ?").all(t + 65 * MIN);

  for (const ride of rows) {
    const left = ride.scheduled_at - t;
    if (left <= 60 * MIN) {
      remind(ride, '60', () => {
        notify(ride.rider_id, 'rider', { title: 'یادآوری سفر رزروی', body: `سفر شما ساعت ${fa.time(ride.scheduled_at)} از ${ride.pickup_address || 'مبدأ'}`, tag: `reserve-${ride.id}` });
        if (ride.reserved_driver_id) {
          notify(ride.reserved_driver_id, 'driver', { title: 'یادآوری رزرو', body: `سفر ساعت ${fa.time(ride.scheduled_at)} — ${ride.pickup_address || 'مبدأ'}. آنلاین باشید.`, tag: `reserve-${ride.id}` });
        }
      });
    }

    // Claimed reservations become a normal accepted ride a little before pickup time.
    if (ride.reserved_driver_id && left <= s.reserve_activate_minutes * MIN) {
      const d = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(ride.reserved_driver_id);
      const ready = d && d.status === 'approved' && d.online && !d.current_ride_id && d.last_seen > t - 90 * 1000;
      if (ready) {
        const activated = tx(() => {
          const { changes } = db.prepare(`UPDATE rides SET status = 'accepted', driver_id = ?, accepted_at = ?, search_started_at = ?
            WHERE id = ? AND status = 'scheduled'`).run(d.user_id, t, t, ride.id);
          if (!changes) return null;
          db.prepare('UPDATE drivers SET current_ride_id = ? WHERE user_id = ?').run(ride.id, d.user_id);
          return getRide(ride.id);
        });
        if (activated) {
          emitRideUpdate(activated);
          notify(activated.rider_id, 'rider', { title: 'راننده رزرو در راه است', body: `برای سفر ساعت ${fa.time(activated.scheduled_at)}`, tag: `ride-${ride.id}` });
          notify(d.user_id, 'driver', { title: 'زمان سفر رزروی', body: `به سمت ${activated.pickup_address || 'مبدأ'} حرکت کنید`, tag: `ride-${ride.id}`, urgent: true });
        }
        continue;
      }
      notify(ride.reserved_driver_id, 'driver', { title: 'رزرو از شما گرفته شد', body: 'در زمان شروع آنلاین یا آزاد نبودید', tag: `reserve-${ride.id}` });
      releaseReservation(ride.id, ride.reserved_driver_id, { reason: 'unavailable' });
      ride.reserved_driver_id = null;
    }

    // Unclaimed (or released) reservations go out to nearby drivers like a normal request.
    if (!ride.reserved_driver_id && left <= s.reserve_dispatch_minutes * MIN) {
      const { changes } = db.prepare("UPDATE rides SET status = 'searching', search_started_at = ? WHERE id = ? AND status = 'scheduled'").run(t, ride.id);
      if (changes) {
        emitRideUpdate(getRide(ride.id));
        startDispatch(ride.id);
      }
    }
  }
}
