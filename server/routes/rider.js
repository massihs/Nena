import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { HttpError, ah, int, parseLatLng } from '../util.js';
import { requireAuth } from '../auth.js';
import { getRideTypes, fareFor, checkPromo, promoDiscount, surgeAt } from '../services/pricing.js';
import { findAvailableDrivers, ALL_VEHICLES } from '../services/drivers.js';
import {
  quote, createRide, getRide, rideView, activeRideFor, cancelByRider, rateRide, tipRide, changeDestination, emitRideUpdate,
} from '../services/rides.js';
import { startDispatch } from '../services/matching.js';
import { listTx } from '../services/wallet.js';
import { createPayment } from '../services/payment.js';

const router = Router();
router.use(requireAuth);

const ownRide = (req) => {
  const ride = getRide(req.params.id);
  if (!ride || ride.rider_id !== req.user.id) throw new HttpError(404, 'سفر یافت نشد');
  return ride;
};

router.get('/ride-types', (_req, res) => res.json({ ride_types: getRideTypes() }));

// Anonymous car positions for the home map.
router.get('/nearby', (req, res) => {
  const { lat, lng } = parseLatLng(req.query, 'نقشه');
  const drivers = findAvailableDrivers(lat, lng, 4, ALL_VEHICLES, [])
    .slice(0, 25)
    .map((d) => ({ lat: d.lat, lng: d.lng, heading: d.heading, vehicle_type: d.vehicle_type }));
  res.json({ drivers });
});

router.post('/estimate', ah(async (req, res) => {
  const q = await quote(req.body || {});
  const radius = getSettings().search_radius_km;
  let promo = null, promoError = null;
  if (req.body.promo_code) {
    try { promo = checkPromo(req.body.promo_code, req.user.id, null); } catch (e) { promoError = e.message; }
  }
  const options = getRideTypes().map((t) => {
    const surge = surgeAt(q.pickup.lat, q.pickup.lng, t.key);
    const fare = fareFor(t, q.route.distance_km, q.route.duration_min, surge);
    const [nearest] = findAvailableDrivers(q.pickup.lat, q.pickup.lng, radius, t.vehicle_types.split(','), []);
    let discount = 0;
    if (promo && fare >= promo.min_fare) discount = promoDiscount(promo, fare);
    return {
      type: t.key, name: t.name, description: t.description, icon: t.icon, seats: t.seats, is_delivery: !!t.is_delivery,
      fare, discount, payable: fare - discount, eta_min: nearest?.eta_min ?? null, surge,
    };
  });
  res.json({
    distance_km: q.route.distance_km, duration_min: q.route.duration_min, route: q.route.geometry,
    surge: Math.max(1, ...options.map((o) => o.surge)), options, promo_error: promoError,
  });
}));

router.post('/rides', ah(async (req, res) => {
  const ride = await createRide(req.user, req.body || {});
  res.status(201).json({ ride: rideView(ride, 'rider') });
}));

router.get('/rides/active', (req, res) => {
  const ride = activeRideFor(req.user.id, 'rider')
    || db.prepare("SELECT * FROM rides WHERE rider_id = ? AND status = 'no_driver' AND created_at > ? ORDER BY id DESC LIMIT 1")
      .get(req.user.id, Date.now() - 10 * 60 * 1000);
  const unrated = db.prepare(`SELECT * FROM rides WHERE rider_id = ? AND status = 'completed' AND rating_by_rider IS NULL
    AND completed_at > ? ORDER BY id DESC LIMIT 1`).get(req.user.id, Date.now() - 60 * 60 * 1000);
  res.json({ ride: rideView(ride, 'rider'), pending_rating: rideView(unrated, 'rider') });
});

router.get('/rides/scheduled', (req, res) => {
  const rows = db.prepare("SELECT * FROM rides WHERE rider_id = ? AND status = 'scheduled' ORDER BY scheduled_at").all(req.user.id);
  res.json({ rides: rows.map((r) => rideView(r, 'rider')) });
});

router.get('/rides', (req, res) => {
  const page = Math.max(0, Number(req.query.page) || 0);
  const rows = db.prepare('SELECT * FROM rides WHERE rider_id = ? ORDER BY id DESC LIMIT 20 OFFSET ?').all(req.user.id, page * 20);
  res.json({ rides: rows.map((r) => rideView(r, 'rider')) });
});

router.get('/rides/:id', (req, res) => res.json({ ride: rideView(ownRide(req), 'rider') }));

router.post('/rides/:id/cancel', (req, res) => {
  res.json({ ride: rideView(cancelByRider(ownRide(req), req.body?.reason), 'rider') });
});

router.post('/rides/:id/retry', (req, res) => {
  const ride = ownRide(req);
  if (ride.status !== 'no_driver') throw new HttpError(400, 'این سفر قابل تلاش مجدد نیست');
  if (activeRideFor(req.user.id, 'rider')) throw new HttpError(409, 'شما یک سفر فعال دارید');
  db.prepare("UPDATE rides SET status = 'searching', search_started_at = ?, declined = '[]' WHERE id = ?").run(Date.now(), ride.id);
  const updated = getRide(ride.id);
  emitRideUpdate(updated);
  startDispatch(ride.id);
  res.json({ ride: rideView(updated, 'rider') });
});

router.post('/rides/:id/rate', (req, res) => {
  const { rating, comment, tags } = req.body || {};
  res.json({ ride: rideView(rateRide(ownRide(req), 'rider', rating, comment, tags), 'rider') });
});

router.post('/rides/:id/tip', (req, res) => {
  const amount = int(req.body?.amount, { min: 1000, max: 1000000, name: 'مبلغ انعام' });
  res.json({ ride: rideView(tipRide(ownRide(req), req.user.id, amount), 'rider') });
});

router.post('/rides/:id/destination', ah(async (req, res) => {
  res.json({ ride: rideView(await changeDestination(ownRide(req), req.body?.dropoff), 'rider') });
}));

router.post('/promo/check', (req, res) => {
  const fare = req.body?.fare != null ? Number(req.body.fare) : null;
  const promo = checkPromo(req.body?.code, req.user.id, fare);
  res.json({ code: promo.code, description: promo.description, discount: fare != null ? promoDiscount(promo, fare) : null });
});

router.get('/places', (req, res) => {
  res.json({ places: db.prepare('SELECT * FROM saved_places WHERE user_id = ? ORDER BY id').all(req.user.id) });
});

router.post('/places', (req, res) => {
  const { lat, lng, address } = parseLatLng(req.body, 'مکان');
  const label = ['home', 'work'].includes(req.body.label) ? req.body.label : 'other';
  const title = String(req.body.title || '').trim().slice(0, 40) || (label === 'home' ? 'خانه' : label === 'work' ? 'محل کار' : 'مکان من');
  if (label !== 'other') db.prepare('DELETE FROM saved_places WHERE user_id = ? AND label = ?').run(req.user.id, label);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM saved_places WHERE user_id = ?').get(req.user.id);
  if (n >= 20) throw new HttpError(400, 'حداکثر ۲۰ مکان قابل ذخیره است');
  const { lastInsertRowid } = db.prepare('INSERT INTO saved_places (user_id, label, title, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, label, title, address, lat, lng);
  res.status(201).json({ place: db.prepare('SELECT * FROM saved_places WHERE id = ?').get(lastInsertRowid) });
});

router.delete('/places/:id', (req, res) => {
  db.prepare('DELETE FROM saved_places WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

router.get('/recent-destinations', (req, res) => {
  const rows = db.prepare(`SELECT dropoff_address AS address, dropoff_lat AS lat, dropoff_lng AS lng, MAX(id) AS last
    FROM rides WHERE rider_id = ? AND dropoff_address IS NOT NULL AND dropoff_address != ''
    GROUP BY dropoff_address ORDER BY last DESC LIMIT 5`).all(req.user.id);
  res.json({ places: rows });
});

router.get('/wallet', (req, res) => {
  const { wallet } = db.prepare('SELECT wallet FROM users WHERE id = ?').get(req.user.id);
  res.json({ balance: wallet, transactions: listTx(req.user.id) });
});

router.post('/wallet/topup', ah(async (req, res) => {
  const amount = int(req.body?.amount, { min: 10000, max: 50000000, name: 'مبلغ' });
  res.json(await createPayment(req.user.id, amount, req.body?.app));
}));

export default router;
