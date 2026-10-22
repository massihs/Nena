import { Router } from 'express';
import { config } from '../config.js';
import { db, getSettings } from '../db.js';
import { HttpError, ah, now, parseLatLng } from '../util.js';
import { requireAuth } from '../auth.js';
import { emitTo, emitAdmins } from '../realtime.js';
import { getRide, rideView, participantRole } from '../services/rides.js';
import { verifyPayment } from '../services/payment.js';
import { searchLocal, expandQuery, normalizeFa, nearestPlace } from '../services/places.js';
import { recordSelection } from '../services/placeStore.js';
import { haversineKm } from '../services/geo.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true }));

router.get('/config', (_req, res) => {
  const s = getSettings();
  res.json({
    map: config.map,
    geocoder: config.geocoder,
    support_phone: s.support_phone,
    cancel_fee: s.cancel_fee,
    free_cancel_seconds: s.free_cancel_seconds,
    require_pin: s.require_pin,
    payment_provider: config.payment.provider,
    expose_otp: config.exposeOtp,
  });
});

// --- geocoding proxy (keeps API keys server-side, caches results) ---------

const geoCache = new Map();
async function cached(key, fn) {
  const hit = geoCache.get(key);
  if (hit && hit.at > now() - 3600 * 1000) return hit.value;
  const value = await fn();
  if (geoCache.size > 5000) geoCache.clear();
  geoCache.set(key, { at: now(), value });
  return value;
}

const nominatimHeaders = { 'User-Agent': 'NenaRideApp/1.0', 'Accept-Language': 'fa' };

// Nominatim allows about one request per second; queue calls and skip them when the queue is long.
let nominatimNext = 0;
async function nominatimFetch(url) {
  const wait = Math.max(0, nominatimNext - now());
  if (wait > 2500) throw new Error('nominatim busy');
  nominatimNext = Math.max(now(), nominatimNext) + 1000;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return (await fetch(url, { headers: nominatimHeaders, signal: AbortSignal.timeout(5000) })).json();
}

function osmAddress(a = {}, fallback = '') {
  const parts = [a.road, a.neighbourhood || a.suburb || a.quarter, a.city_district, a.city || a.town || a.village];
  return [...new Set(parts.filter(Boolean))].join('، ') || fallback;
}

async function externalSearch(q, lat, lng) {
  if (config.geocoder === 'neshan' && config.neshanKey) {
    const url = `https://api.neshan.org/v1/search?term=${encodeURIComponent(q)}&lat=${lat}&lng=${lng}`;
    const data = await (await fetch(url, { headers: { 'Api-Key': config.neshanKey }, signal: AbortSignal.timeout(5000) })).json();
    return (data.items || []).slice(0, 10).map((i) => ({
      title: i.title, address: i.address || i.region || '', lat: i.location.y, lng: i.location.x, category: i.category || 'other', source: 'neshan',
    }));
  }
  if (config.geocoder !== 'nominatim') return [];
  const search = async (bounded, text = expandQuery(q)) => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      q: text, format: 'jsonv2', limit: '8', countrycodes: 'ir', 'accept-language': 'fa', addressdetails: '1',
      // Prefer the user's city (~40 km box); widen to all of Iran only if nothing is found nearby.
      viewbox: `${lng - 0.4},${lat + 0.35},${lng + 0.4},${lat - 0.35}`, bounded: bounded ? '1' : '0',
    });
    return nominatimFetch(url);
  };
  let data = await search(true);
  // OSM often stores streets without the prefix: "خیابان ملاصدرا" is just "ملاصدرا".
  const bare = expandQuery(q).replace(/^(خیابان|بلوار|بزرگراه|کوچه|میدان) /, '');
  if (data.length < 3 && bare !== expandQuery(q)) data = [...data, ...(await search(true, bare))];
  if (!data.length) data = await search(false);
  return data.map((i) => ({
    title: i.name || i.display_name.split(/[،,]/)[0], address: osmAddress(i.address, i.display_name), lat: Number(i.lat), lng: Number(i.lon),
    category: 'other', source: 'osm',
  }));
}

router.get('/geo/search', ah(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (normalizeFa(q).length < 2) return res.json({ results: [] });
  const lat = Number(req.query.lat) || config.map.center[0];
  const lng = Number(req.query.lng) || config.map.center[1];
  const local = searchLocal(q, { lat, lng, limit: 10 });
  const strong = local.filter((r) => !r.weak);
  const weak = local.filter((r) => r.weak);

  // Enough name matches answer instantly; otherwise also ask the online geocoder.
  let external = [];
  if (strong.length < 4 && config.geocoder !== 'none') {
    external = await cached(`s:${normalizeFa(q)}:${lat.toFixed(2)}:${lng.toFixed(2)}`, () => externalSearch(q, lat, lng)).catch(() => []);
  }
  // Drop online results that duplicate a curated place; show the nearest first.
  const fresh = external
    .filter((e) => !local.some((l) => haversineKm(l, e) < 0.25))
    .map((e) => ({ ...e, distance_km: Math.round(haversineKm({ lat, lng }, e) * 10) / 10 }))
    .sort((a, b) => a.distance_km - b.distance_km)
    // A street comes back as many segments; keep the nearest one per street and neighbourhood.
    .filter((e, i, all) => all.findIndex((x) => x.title === e.title && x.address === e.address) === i);
  const results = [...strong, ...fresh, ...weak].slice(0, 10).map(({ weak: _w, ...r }) => r);
  res.json({ results });
}));

router.post('/geo/select', requireAuth, (req, res) => {
  recordSelection(req.body || {});
  res.json({ ok: true });
});

router.get('/geo/reverse', ah(async (req, res) => {
  const { lat, lng } = parseLatLng(req.query);
  if (config.geocoder === 'none') return res.json({ address: '' });
  const address = await cached(`r:${lat.toFixed(4)}:${lng.toFixed(4)}`, async () => {
    if (config.geocoder === 'neshan' && config.neshanKey) {
      const data = await (await fetch(`https://api.neshan.org/v5/reverse?lat=${lat}&lng=${lng}`, {
        headers: { 'Api-Key': config.neshanKey }, signal: AbortSignal.timeout(5000),
      })).json();
      return data.formatted_address || '';
    }
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=fa&lat=${lat}&lon=${lng}`;
    const data = await nominatimFetch(url);
    const a = data.address || {};
    const parts = [a.neighbourhood || a.suburb, a.road, a.house_number && `پلاک ${a.house_number}`].filter(Boolean);
    return parts.join('، ') || (data.display_name || '').split('،').slice(0, 2).join('،');
  }).catch(() => '');
  if (!address) {
    const near = nearestPlace(lat, lng);
    if (near) return res.json({ address: `نزدیک ${near.name}` });
  }
  res.json({ address });
}));

// --- ride chat & safety (shared by rider and driver) ----------------------

function participantRide(req) {
  const ride = getRide(req.params.id);
  const role = ride && participantRole(ride, req.user.id);
  if (!role) throw new HttpError(404, 'سفر یافت نشد');
  return { ride, role };
}

router.get('/rides/:id/messages', requireAuth, (req, res) => {
  const { ride } = participantRide(req);
  res.json({ messages: db.prepare('SELECT * FROM messages WHERE ride_id = ? ORDER BY id').all(ride.id) });
});

router.post('/rides/:id/messages', requireAuth, (req, res) => {
  const { ride, role } = participantRide(req);
  if (!['accepted', 'arrived', 'in_progress'].includes(ride.status)) throw new HttpError(400, 'گفتگو فقط در حین سفر فعال است');
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) throw new HttpError(400, 'پیام خالی است');
  const { lastInsertRowid } = db.prepare('INSERT INTO messages (ride_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)')
    .run(ride.id, req.user.id, text, now());
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(lastInsertRowid);
  const other = role === 'rider' ? ride.driver_id : ride.rider_id;
  emitTo(other, 'chat:message', message);
  emitTo(req.user.id, 'chat:message', message);
  res.status(201).json({ message });
});

router.post('/rides/:id/sos', requireAuth, (req, res) => {
  const { ride } = participantRide(req);
  const lat = Number(req.body?.lat) || null;
  const lng = Number(req.body?.lng) || null;
  const { lastInsertRowid } = db.prepare('INSERT INTO sos_alerts (ride_id, user_id, lat, lng, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ride.id, req.user.id, lat, lng, now());
  emitAdmins('sos', { id: lastInsertRowid, ride_id: ride.id, user_id: req.user.id, name: req.user.name, phone: req.user.phone, lat, lng });
  res.status(201).json({ ok: true, police: '110', ambulance: '115' });
});

// Public live-trip page shared by the rider with family.
router.get('/track/:token', (req, res) => {
  const ride = db.prepare('SELECT * FROM rides WHERE share_token = ?').get(String(req.params.token));
  if (!ride) throw new HttpError(404, 'سفر یافت نشد');
  const ended = ['completed', 'cancelled'].includes(ride.status) && now() - (ride.completed_at || ride.cancelled_at) > 3600 * 1000;
  if (ended) throw new HttpError(410, 'این لینک منقضی شده است');
  res.json({ ride: rideView(ride, 'public') });
});

// --- payment gateway callbacks --------------------------------------------

router.get('/pay/mock/:authority', (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE authority = ?').get(req.params.authority);
  if (!p) throw new HttpError(404, 'تراکنش یافت نشد');
  const back = (status) => `/api/pay/callback?Authority=${encodeURIComponent(p.authority)}&Status=${status}`;
  res.type('html').send(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>درگاه پرداخت آزمایشی</title>
<link rel="stylesheet" href="/shared/style.css"></head>
<body class="center-page"><div class="card pay-card">
<h2>درگاه پرداخت آزمایشی</h2><p class="muted">این صفحه جایگزین درگاه بانکی (زرین‌پال) در محیط توسعه است.</p>
<div class="pay-amount">${p.amount.toLocaleString('fa-IR')} <small>تومان</small></div>
<a class="btn btn-primary btn-block" href="${back('OK')}">پرداخت موفق</a>
<a class="btn btn-ghost btn-block" href="${back('NOK')}">انصراف</a></div></body></html>`);
});

router.get('/pay/callback', ah(async (req, res) => {
  const payment = await verifyPayment(req.query.Authority, req.query.Status);
  const app = payment.return_app === 'driver' ? 'driver' : 'rider';
  res.redirect(`/${app}/?topup=${payment.status === 'paid' ? 'ok' : 'failed'}`);
}));

export default router;
