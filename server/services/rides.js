import { randomBytes } from 'node:crypto';
import { db, tx, getSettings } from '../db.js';
import { HttpError, now, parseJson, parseLatLng, randomDigits, normalizePhone, toEnDigits } from '../util.js';
import { userRating } from '../auth.js';
import { emitTo, emitAdmins } from '../realtime.js';
import { getRoute } from './routing.js';
import { getRideType, fareFor, surgeAt, checkPromo, promoDiscount } from './pricing.js';
import { driverRating, getDriver } from './drivers.js';
import { addTx } from './wallet.js';
import { startDispatch, stopDispatch } from './matching.js';
import { haversineKm, etaMinutes } from './geo.js';
import { notify } from './push.js';
import { toman } from './text.js';

export const ACTIVE_STATUSES = ['searching', 'accepted', 'arrived', 'in_progress'];

export function getRide(id) {
  return db.prepare('SELECT * FROM rides WHERE id = ?').get(Number(id));
}

export function activeRideFor(userId, role) {
  const col = role === 'driver' ? 'driver_id' : 'rider_id';
  return db.prepare(`SELECT * FROM rides WHERE ${col} = ? AND status IN ('searching','accepted','arrived','in_progress')
    ORDER BY id DESC LIMIT 1`).get(userId);
}

export const driverEarning = (r) => (r.fare_final != null ? r.fare_final - (r.commission || 0) + (r.tip || 0) : null);

// Shapes a ride for one audience. Riders never see the driver's earnings; drivers never see the PIN.
export function rideView(ride, viewer) {
  if (!ride) return null;
  const type = getRideType(ride.type);
  const s = getSettings();
  const view = {
    id: ride.id,
    type: ride.type,
    type_name: type?.name,
    type_icon: type?.icon,
    is_delivery: !!type?.is_delivery,
    status: ride.status,
    pickup: { lat: ride.pickup_lat, lng: ride.pickup_lng, address: ride.pickup_address },
    dropoff: { lat: ride.dropoff_lat, lng: ride.dropoff_lng, address: ride.dropoff_address },
    stops: parseJson(ride.stops, []),
    distance_km: ride.distance_km,
    duration_min: ride.duration_min,
    route: parseJson(ride.route, []),
    surge: ride.surge,
    fare_estimate: ride.fare_estimate,
    wait_fee: ride.wait_fee,
    discount: ride.discount,
    fare_final: ride.fare_final,
    payable: ride.fare_final != null ? ride.fare_final - ride.discount : ride.fare_estimate - ride.discount,
    tip: ride.tip,
    payment_method: ride.payment_method,
    paid_wallet: ride.paid_wallet,
    paid_cash: ride.paid_cash,
    promo_code: ride.promo_code,
    notes: ride.notes,
    recipient_name: ride.recipient_name,
    recipient_phone: ride.recipient_phone,
    require_pin: !!s.require_pin,
    cancel_reason: ride.cancel_reason,
    cancelled_by: ride.cancelled_by,
    cancel_fee: ride.cancel_fee,
    rating_by_rider: ride.rating_by_rider,
    rating_by_driver: ride.rating_by_driver,
    scheduled_at: ride.scheduled_at,
    created_at: ride.created_at,
    accepted_at: ride.accepted_at,
    arrived_at: ride.arrived_at,
    started_at: ride.started_at,
    completed_at: ride.completed_at,
    cancelled_at: ride.cancelled_at,
    free_wait_minutes: s.free_wait_minutes,
  };

  if (ride.driver_id) {
    const u = db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(ride.driver_id);
    const d = getDriver(ride.driver_id);
    const trips = db.prepare("SELECT COUNT(*) AS n FROM rides WHERE driver_id = ? AND status = 'completed'").get(ride.driver_id).n;
    view.driver = {
      id: u.id, name: u.name, phone: u.phone, rating: driverRating(d), trips,
      vehicle_type: d.vehicle_type, vehicle_model: d.vehicle_model, vehicle_color: d.vehicle_color, plate: d.plate,
      lat: d.lat, lng: d.lng, heading: d.heading,
    };
    if (d.lat != null && ['accepted'].includes(ride.status)) {
      view.driver.eta_min = etaMinutes(haversineKm(d, { lat: ride.pickup_lat, lng: ride.pickup_lng }));
    }
  }

  if (ride.reserved_driver_id && ride.status === 'scheduled' && viewer !== 'public') {
    const u = db.prepare('SELECT id, name FROM users WHERE id = ?').get(ride.reserved_driver_id);
    const d = getDriver(ride.reserved_driver_id);
    view.reserved_driver = {
      id: u.id, name: u.name, rating: driverRating(d), vehicle_type: d.vehicle_type, vehicle_model: d.vehicle_model,
      vehicle_color: d.vehicle_color, plate: d.plate,
    };
  }
  view.free_cancel_until = ride.scheduled_at ? ride.scheduled_at - s.reserve_free_cancel_minutes * 60 * 1000 : null;

  if (viewer === 'rider') {
    view.pin = ride.pin;
    view.share_token = ride.share_token;
  }
  if (viewer === 'driver' || viewer === 'admin') {
    const r = db.prepare('SELECT id, name, phone, rating_sum, rating_count FROM users WHERE id = ?').get(ride.rider_id);
    view.rider = { id: r.id, name: r.name, phone: r.phone, rating: userRating(r) };
    view.commission = ride.commission;
    view.earning = driverEarning(ride);
    view.estimated_earning = ride.fare_estimate - Math.round((ride.fare_estimate * (type?.commission_pct || 0)) / 100);
  }
  if (viewer === 'admin') {
    view.pin = ride.pin;
    view.declined = parseJson(ride.declined, []);
    view.offered_driver_id = ride.offered_driver_id;
  }
  if (viewer === 'public') {
    const pub = {
      status: view.status, type_name: view.type_name, pickup: view.pickup, dropoff: view.dropoff, route: view.route,
      started_at: view.started_at, duration_min: view.duration_min,
    };
    if (view.driver) {
      const { name, rating, vehicle_model, vehicle_color, plate, lat, lng, heading } = view.driver;
      pub.driver = { name, rating, vehicle_model, vehicle_color, plate, lat, lng, heading };
    }
    return pub;
  }
  return view;
}

export function emitRideUpdate(ride) {
  if (!ride) return;
  emitTo(ride.rider_id, 'ride:update', rideView(ride, 'rider'));
  if (ride.driver_id) emitTo(ride.driver_id, 'ride:update', rideView(ride, 'driver'));
  emitAdmins('ride:update', { id: ride.id, status: ride.status });
}

function parseStops(stops) {
  if (!Array.isArray(stops)) return [];
  if (stops.length > 2) throw new HttpError(400, 'حداکثر دو مقصد میانی مجاز است');
  return stops.map((s, i) => parseLatLng(s, `مقصد ${i + 1}`));
}

// Shared by fare estimates and ride creation.
export async function quote({ pickup, dropoff, stops = [] }) {
  const p = parseLatLng(pickup, 'مبدأ');
  const d = parseLatLng(dropoff, 'مقصد');
  const st = parseStops(stops);
  if (haversineKm(p, d) < 0.1 && !st.length) throw new HttpError(400, 'مبدأ و مقصد خیلی به هم نزدیک هستند');
  if (haversineKm(p, d) > 150) throw new HttpError(400, 'سفرهای بیش از ۱۵۰ کیلومتر پشتیبانی نمی‌شوند');
  const route = await getRoute([p, ...st, d]);
  return { pickup: p, dropoff: d, stops: st, route };
}

export async function createRide(rider, body) {
  if (activeRideFor(rider.id, 'rider')) throw new HttpError(409, 'شما یک سفر فعال دارید');
  const type = getRideType(body.type);
  if (!type || !type.active) throw new HttpError(400, 'نوع سرویس نامعتبر است');

  let recipientName = null, recipientPhone = null;
  if (type.is_delivery) {
    recipientName = String(body.recipient_name || '').trim().slice(0, 80);
    recipientPhone = normalizePhone(body.recipient_phone);
    if (!recipientName || !recipientPhone) throw new HttpError(400, 'نام و شماره موبایل گیرنده مرسوله را وارد کنید');
  }

  const paymentMethod = body.payment_method === 'wallet' ? 'wallet' : 'cash';
  let scheduledAt = null;
  if (body.scheduled_at) {
    scheduledAt = Number(body.scheduled_at);
    const s = getSettings();
    if (!Number.isFinite(scheduledAt) || scheduledAt < now() + (s.reserve_min_minutes - 1) * 60 * 1000 || scheduledAt > now() + s.reserve_max_days * 24 * 3600 * 1000) {
      throw new HttpError(400, `زمان رزرو باید بین ${s.reserve_min_minutes.toLocaleString('fa-IR')} دقیقه تا ${s.reserve_max_days.toLocaleString('fa-IR')} روز آینده باشد`);
    }
  }

  const q = await quote(body);
  // Scheduled rides only get manual zone pricing for their pickup time: live demand is unknown.
  const surge = surgeAt(q.pickup.lat, q.pickup.lng, type.key, scheduledAt ? { at: scheduledAt, dynamic: false } : undefined);
  const fare = fareFor(type, q.route.distance_km, q.route.duration_min, surge);
  let promoCode = null, discount = 0;
  if (body.promo_code) {
    const promo = checkPromo(body.promo_code, rider.id, fare);
    promoCode = promo.code;
    discount = promoDiscount(promo, fare);
  }

  const t = now();
  const { lastInsertRowid: id } = db.prepare(`INSERT INTO rides
    (rider_id, type, status, pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address, stops,
     distance_km, duration_min, route, surge, fare_estimate, discount, promo_code, payment_method, pin, share_token,
     notes, recipient_name, recipient_phone, scheduled_at, created_at, search_started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    rider.id, type.key, scheduledAt ? 'scheduled' : 'searching',
    q.pickup.lat, q.pickup.lng, q.pickup.address, q.dropoff.lat, q.dropoff.lng, q.dropoff.address, JSON.stringify(q.stops),
    q.route.distance_km, q.route.duration_min, JSON.stringify(q.route.geometry), surge, fare, discount, promoCode,
    paymentMethod, randomDigits(4), randomBytes(12).toString('base64url'),
    String(body.notes || '').slice(0, 300) || null, recipientName, recipientPhone, scheduledAt, t, scheduledAt ? null : t,
  );

  const ride = getRide(id);
  emitAdmins('ride:update', { id, status: ride.status });
  if (ride.status === 'searching') startDispatch(id);
  return ride;
}

function freeDriver(driverId) {
  if (driverId) db.prepare('UPDATE drivers SET current_ride_id = NULL WHERE user_id = ?').run(driverId);
}

function chargeCancelFee(ride, reasonText) {
  const fee = getSettings().cancel_fee;
  const driverId = ride.driver_id || ride.reserved_driver_id;
  if (!fee || !driverId) return 0;
  addTx(ride.rider_id, -fee, 'cancel_fee', { rideId: ride.id, description: reasonText });
  addTx(driverId, fee, 'cancel_compensation', { rideId: ride.id, description: 'جبران لغو سفر توسط مسافر' });
  return fee;
}

export function cancelByRider(ride, reason, { by = 'rider', waiveFee = false } = {}) {
  if (!['scheduled', 'searching', 'no_driver', 'accepted', 'arrived'].includes(ride.status)) {
    throw new HttpError(400, 'این سفر قابل لغو نیست');
  }
  const s = getSettings();
  // A claimed reservation is free to cancel until reserve_free_cancel_minutes before pickup.
  const lateReservation = ride.status === 'scheduled' && ride.reserved_driver_id
    && ride.scheduled_at - now() < s.reserve_free_cancel_minutes * 60 * 1000;
  const late = !waiveFee && ((ride.status === 'accepted' && now() - ride.accepted_at > s.free_cancel_seconds * 1000)
    || ride.status === 'arrived' || lateReservation);
  const offered = ride.offered_driver_id;

  const updated = tx(() => {
    const fee = late ? chargeCancelFee(ride, 'هزینه لغو سفر') : 0;
    db.prepare(`UPDATE rides SET status = 'cancelled', cancelled_by = ?, cancel_reason = ?, cancel_fee = ?,
      cancelled_at = ?, offered_driver_id = NULL WHERE id = ?`).run(by, String(reason || '').slice(0, 200) || null, fee, now(), ride.id);
    freeDriver(ride.driver_id);
    return getRide(ride.id);
  });
  stopDispatch(ride.id);
  if (offered) emitTo(offered, 'ride:offer_cancel', { ride_id: ride.id });
  emitRideUpdate(updated);
  const driverToTell = ride.driver_id || ride.reserved_driver_id;
  if (driverToTell) {
    if (!ride.driver_id) emitTo(driverToTell, 'reservation:update', { id: ride.id });
    notify(driverToTell, 'driver', {
      title: by === 'admin' ? 'سفر توسط پشتیبانی لغو شد' : ride.status === 'scheduled' ? 'مسافر رزرو را لغو کرد' : 'مسافر سفر را لغو کرد',
      body: updated.cancel_fee ? `${toman(updated.cancel_fee)} جبران به کیف پول شما اضافه شد` : (ride.pickup_address || ''),
      tag: `ride-${ride.id}`,
    });
  }
  return updated;
}

export function cancelByDriver(ride, driverId, reason) {
  if (ride.driver_id !== driverId || !['accepted', 'arrived'].includes(ride.status)) {
    throw new HttpError(400, 'این سفر قابل لغو نیست');
  }
  const s = getSettings();
  if (reason === 'no_show') {
    if (ride.status !== 'arrived' || now() - ride.arrived_at < s.no_show_wait_minutes * 60 * 1000) {
      throw new HttpError(400, `پس از ${s.no_show_wait_minutes} دقیقه انتظار در مبدأ می‌توانید سفر را لغو کنید`);
    }
    const updated = tx(() => {
      const fee = chargeCancelFee(ride, 'هزینه عدم حضور مسافر');
      db.prepare(`UPDATE rides SET status = 'cancelled', cancelled_by = 'driver', cancel_reason = 'no_show', cancel_fee = ?,
        cancelled_at = ? WHERE id = ?`).run(fee, now(), ride.id);
      freeDriver(driverId);
      return getRide(ride.id);
    });
    emitRideUpdate(updated);
    notify(ride.rider_id, 'rider', { title: 'سفر لغو شد', body: `راننده به دلیل عدم حضور شما سفر را لغو کرد${fee ? ` — هزینه لغو ${toman(fee)}` : ''}`, tag: `ride-${ride.id}` });
    return updated;
  }

  // Any other driver cancellation sends the request back out to other drivers.
  const declined = [...parseJson(ride.declined, []), driverId];
  const updated = tx(() => {
    db.prepare(`UPDATE rides SET status = 'searching', driver_id = NULL, accepted_at = NULL, arrived_at = NULL,
      declined = ?, search_started_at = ? WHERE id = ?`).run(JSON.stringify(declined), now(), ride.id);
    freeDriver(driverId);
    return getRide(ride.id);
  });
  emitTo(driverId, 'ride:update', { ...rideView(ride, 'driver'), status: 'cancelled', cancelled_by: 'driver' });
  emitRideUpdate(updated);
  emitTo(ride.rider_id, 'notice', { text: 'راننده سفر را لغو کرد؛ در حال یافتن راننده جدید هستیم' });
  notify(ride.rider_id, 'rider', { title: 'تغییر راننده', body: 'راننده سفر را لغو کرد؛ در حال یافتن راننده جدید هستیم', tag: `ride-${ride.id}` });
  startDispatch(ride.id);
  return updated;
}

function assertDriverRide(ride, driverId, status) {
  if (!ride || ride.driver_id !== driverId) throw new HttpError(404, 'سفر یافت نشد');
  if (ride.status !== status) throw new HttpError(400, 'وضعیت سفر برای این کار مناسب نیست');
}

export function markArrived(ride, driverId) {
  assertDriverRide(ride, driverId, 'accepted');
  db.prepare("UPDATE rides SET status = 'arrived', arrived_at = ? WHERE id = ?").run(now(), ride.id);
  const updated = getRide(ride.id);
  emitRideUpdate(updated);
  notify(ride.rider_id, 'rider', { title: 'راننده رسید', body: 'راننده در مبدأ منتظر شماست', tag: `ride-${ride.id}`, urgent: true });
  return updated;
}

export function startRide(ride, driverId, pin) {
  assertDriverRide(ride, driverId, 'arrived');
  const s = getSettings();
  if (s.require_pin && toEnDigits(pin) !== ride.pin) throw new HttpError(400, 'کد سفر صحیح نیست');
  const type = getRideType(ride.type);
  const waitedMin = (now() - ride.arrived_at) / 60000 - s.free_wait_minutes;
  const waitFee = waitedMin > 0 ? Math.ceil(waitedMin) * type.wait_per_min : 0;
  db.prepare("UPDATE rides SET status = 'in_progress', started_at = ?, wait_fee = ? WHERE id = ?").run(now(), waitFee, ride.id);
  const updated = getRide(ride.id);
  emitRideUpdate(updated);
  return updated;
}

// Settles the fare. The driver's wallet tracks what the platform owes them (positive) or what
// they owe the platform (negative): it moves by (fare − commission − cash collected).
export function completeRide(ride, driverId) {
  assertDriverRide(ride, driverId, 'in_progress');
  const type = getRideType(ride.type);
  const updated = tx(() => {
    const fare = ride.fare_estimate + ride.wait_fee;
    let discount = 0;
    if (ride.promo_code) {
      try {
        const promo = checkPromo(ride.promo_code, ride.rider_id, fare);
        discount = promoDiscount(promo, fare);
        db.prepare('INSERT INTO promo_uses (code, user_id, ride_id, created_at) VALUES (?, ?, ?, ?)').run(promo.code, ride.rider_id, ride.id, now());
        db.prepare('UPDATE promos SET used_count = used_count + 1 WHERE code = ?').run(promo.code);
      } catch {
        discount = 0; // code expired or was used up mid-ride
      }
    }
    const payable = fare - discount;
    const commission = Math.round((fare * type.commission_pct) / 100);
    const rider = db.prepare('SELECT wallet FROM users WHERE id = ?').get(ride.rider_id);

    let fromWallet = 0, debt = 0;
    if (rider.wallet < 0) debt = -rider.wallet; // e.g. an unpaid cancellation fee, collected in cash now
    else if (ride.payment_method === 'wallet') fromWallet = Math.min(payable, rider.wallet);
    const cash = payable - fromWallet + debt;

    if (fromWallet) addTx(ride.rider_id, -fromWallet, 'ride_payment', { rideId: ride.id, description: `پرداخت سفر #${ride.id}` });
    if (debt) addTx(ride.rider_id, debt, 'debt_settled', { rideId: ride.id, description: 'تسویه بدهی قبلی به‌صورت نقدی' });
    addTx(driverId, fare - commission - cash, 'ride_earning', {
      rideId: ride.id,
      description: `سفر #${ride.id}: کرایه ${fare} − کمیسیون ${commission} − نقد دریافتی ${cash}`,
    });

    db.prepare(`UPDATE rides SET status = 'completed', completed_at = ?, fare_final = ?, discount = ?, commission = ?,
      paid_wallet = ?, paid_cash = ? WHERE id = ?`).run(now(), fare, discount, commission, fromWallet, cash, ride.id);
    freeDriver(driverId);
    rewardReferral(ride.rider_id);
    return getRide(ride.id);
  });
  emitRideUpdate(updated);
  notify(ride.rider_id, 'rider', {
    title: 'به مقصد رسیدید', body: `مبلغ سفر: ${toman(updated.fare_final - updated.discount)}${updated.paid_cash ? ` (نقدی ${toman(updated.paid_cash)})` : ''} — به راننده امتیاز دهید`,
    tag: `ride-${ride.id}`,
  });
  return updated;
}

function rewardReferral(riderId) {
  const u = db.prepare('SELECT referred_by, referral_rewarded FROM users WHERE id = ?').get(riderId);
  if (!u.referred_by || u.referral_rewarded) return;
  const bonus = getSettings().referral_bonus;
  db.prepare('UPDATE users SET referral_rewarded = 1 WHERE id = ?').run(riderId);
  if (!bonus) return;
  addTx(riderId, bonus, 'referral', { description: 'هدیه دعوت از دوستان' });
  addTx(u.referred_by, bonus, 'referral', { description: 'هدیه اولین سفر دوست دعوت‌شده' });
}

export function rateRide(ride, by, rating, comment, tags) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw new HttpError(400, 'امتیاز باید بین ۱ تا ۵ باشد');
  if (ride.status !== 'completed') throw new HttpError(400, 'فقط سفرهای تمام‌شده قابل امتیازدهی هستند');
  const text = String(comment || '').slice(0, 500) || null;
  tx(() => {
    if (by === 'rider') {
      if (ride.rating_by_rider) throw new HttpError(400, 'قبلاً امتیاز داده‌اید');
      const tagList = Array.isArray(tags) ? tags.map(String).slice(0, 10) : [];
      db.prepare('UPDATE rides SET rating_by_rider = ?, comment_by_rider = ?, tags_by_rider = ? WHERE id = ?').run(r, text, JSON.stringify(tagList), ride.id);
      db.prepare('UPDATE drivers SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE user_id = ?').run(r, ride.driver_id);
    } else {
      if (ride.rating_by_driver) throw new HttpError(400, 'قبلاً امتیاز داده‌اید');
      db.prepare('UPDATE rides SET rating_by_driver = ?, comment_by_driver = ? WHERE id = ?').run(r, text, ride.id);
      db.prepare('UPDATE users SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?').run(r, ride.rider_id);
    }
  });
  return getRide(ride.id);
}

export function tipRide(ride, riderId, amount) {
  if (ride.status !== 'completed' || ride.rider_id !== riderId) throw new HttpError(400, 'امکان پرداخت انعام نیست');
  if (ride.tip) throw new HttpError(400, 'برای این سفر انعام پرداخت شده است');
  if (!Number.isInteger(amount) || amount < 1000 || amount > 1000000) throw new HttpError(400, 'مبلغ انعام نامعتبر است');
  const updated = tx(() => {
    const { wallet } = db.prepare('SELECT wallet FROM users WHERE id = ?').get(riderId);
    if (wallet < amount) throw new HttpError(400, 'موجودی کیف پول کافی نیست');
    addTx(riderId, -amount, 'tip', { rideId: ride.id, description: `انعام سفر #${ride.id}` });
    addTx(ride.driver_id, amount, 'tip', { rideId: ride.id, description: `انعام مسافر — سفر #${ride.id}` });
    db.prepare('UPDATE rides SET tip = ? WHERE id = ?').run(amount, ride.id);
    return getRide(ride.id);
  });
  emitTo(ride.driver_id, 'notice', { text: `مسافر ${amount.toLocaleString('fa-IR')} تومان انعام داد 🎉` });
  notify(ride.driver_id, 'driver', { title: 'انعام دریافت کردید 🎉', body: `${toman(amount)} برای سفر #${ride.id.toLocaleString('fa-IR')}`, tag: `tip-${ride.id}` });
  return updated;
}

export async function changeDestination(ride, dropoff) {
  if (!['accepted', 'arrived', 'in_progress'].includes(ride.status)) throw new HttpError(400, 'تغییر مقصد ممکن نیست');
  const type = getRideType(ride.type);
  const stops = parseJson(ride.stops, []);
  const d = parseLatLng(dropoff, 'مقصد');
  const route = await getRoute([{ lat: ride.pickup_lat, lng: ride.pickup_lng }, ...stops, d]);
  const fare = fareFor(type, route.distance_km, route.duration_min, ride.surge);
  db.prepare(`UPDATE rides SET dropoff_lat = ?, dropoff_lng = ?, dropoff_address = ?, distance_km = ?, duration_min = ?,
    route = ?, fare_estimate = ? WHERE id = ?`)
    .run(d.lat, d.lng, d.address, route.distance_km, route.duration_min, JSON.stringify(route.geometry), fare, ride.id);
  const updated = getRide(ride.id);
  emitRideUpdate(updated);
  if (ride.driver_id) emitTo(ride.driver_id, 'notice', { text: 'مسافر مقصد را تغییر داد' });
  return updated;
}

export function participantRole(ride, userId) {
  if (ride.rider_id === userId) return 'rider';
  if (ride.driver_id === userId) return 'driver';
  return null;
}
