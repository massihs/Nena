import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, nationalId, TEHRAN } from './helpers.js';
import { tehranClock } from '../server/services/pricing.js';

let t, admin;
before(async () => { t = await boot(); admin = await t.login('09120000000'); });
after(async () => { await t.close(); });

async function driver(phone, seed, at, vehicle = 'eco') {
  const token = await t.login(phone);
  await t.api(token, 'POST', '/api/driver/register', {
    name: `راننده ${seed}`, national_id: nationalId(seed), license_no: '1234567890', vehicle_type: vehicle,
    vehicle_model: 'سمند', vehicle_color: 'مشکی', vehicle_year: 1401, plate: '12|ب|345|67',
  });
  const id = (await t.api(token, 'GET', '/api/me')).user.id;
  await t.api(admin, 'POST', `/api/admin/drivers/${id}/status`, { status: 'approved' });
  const sock = await t.socket(token);
  await t.api(token, 'POST', '/api/driver/online', { online: true, ...at });
  return { token, sock };
}

test('Tehran clock', () => {
  // 2026-10-22 20:30 UTC is Friday 00:00 in Tehran.
  assert.deepEqual(tehranClock(Date.UTC(2026, 9, 22, 20, 30)), { day: 5, minute: 0 });
});

test('surge zones: validation, service and time filters, pricing, kill switch', async () => {
  const rider = await t.login('09358880000');
  const quote = async () => (await t.api(rider, 'POST', '/api/rider/estimate', { pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab })).options;
  const base = await quote();
  assert.ok(base.every((o) => o.surge === 1));

  assert.equal((await t.api(admin, 'POST', '/api/admin/surge/zones', { name: 'x', lat: 35.7, lng: 51.33, radius_km: 2, multiplier: 9 })).status, 400);
  assert.equal((await t.api(rider, 'GET', '/api/admin/surge/zones')).status, 403);

  const { zone } = await t.api(admin, 'POST', '/api/admin/surge/zones', {
    name: 'آزادی — شلوغی', lat: 35.6997, lng: 51.338, radius_km: 2, multiplier: 1.5, ride_types: ['black'],
  });
  let opts = await quote();
  assert.equal(opts.find((o) => o.type === 'eco').surge, 1, 'zone limited to Black');
  const black = opts.find((o) => o.type === 'black');
  assert.equal(black.surge, 1.5);
  assert.equal(black.fare, Math.ceil(base.find((o) => o.type === 'black').fare * 1.5 / 1000) * 1000);

  // A time window that excludes "now" disables the zone.
  const { minute } = tehranClock();
  const start = (minute + 120) % 1440, end = (minute + 180) % 1440;
  await t.api(admin, 'PUT', `/api/admin/surge/zones/${zone.id}`, { ...zone, start_minute: start, end_minute: end });
  assert.equal((await quote()).find((o) => o.type === 'black').surge, 1);
  await t.api(admin, 'PUT', `/api/admin/surge/zones/${zone.id}`, { ...zone, ride_types: [], start_minute: (minute + 1380) % 1440, end_minute: (minute + 60) % 1440 });
  assert.ok((await quote()).every((o) => o.surge === 1.5), 'window around now (possibly overnight) applies to all services');

  const preview = await t.api(admin, 'GET', '/api/admin/surge/preview?lat=35.6997&lng=51.338');
  assert.equal(preview.services[0].zone.name, 'آزادی — شلوغی');

  await t.api(admin, 'PUT', '/api/admin/settings', { surge_zone_max: 1.3 });
  assert.ok((await quote()).every((o) => o.surge === 1.3), 'global ceiling');
  await t.api(admin, 'PUT', '/api/admin/settings', { surge_enabled: false });
  assert.ok((await quote()).every((o) => o.surge === 1), 'kill switch');
  await t.api(admin, 'PUT', '/api/admin/settings', { surge_enabled: true, surge_zone_max: 3 });
  await t.api(admin, 'DELETE', `/api/admin/surge/zones/${zone.id}`);
});

test('dynamic surge follows demand and the sensitivity setting', async () => {
  const d = await driver('09128880001', 88880001, { lat: 35.80, lng: 51.43 });
  const riders = await Promise.all(['09358880011', '09358880012', '09358880013'].map((p) => t.login(p)));
  // The one driver takes the first request; the other two stay open → demand 2 vs supply 0.
  const offer = t.waitFor(d.sock, 'ride:offer');
  await t.api(riders[0], 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.tajrish, dropoff: TEHRAN.enghelab });
  await t.api(d.token, 'POST', `/api/driver/offers/${(await offer).ride.id}/accept`);
  for (const r of riders.slice(1)) await t.api(r, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.tajrish, dropoff: TEHRAN.enghelab });
  await t.api(admin, 'PUT', '/api/admin/settings', { surge_sensitivity: 0.3, surge_max: 2 });
  const p = await t.api(admin, 'GET', `/api/admin/surge/preview?lat=${TEHRAN.tajrish.lat}&lng=${TEHRAN.tajrish.lng}`);
  const eco = p.services.find((s) => s.key === 'eco');
  assert.equal(eco.demand, 2);
  assert.equal(eco.supply, 0);
  assert.equal(eco.dynamic, 1.6);
  const map = await t.api(admin, 'GET', '/api/admin/surge/map');
  assert.ok(map.cells.some((c) => c.multiplier > 1));
});

test('economics: period totals, net revenue, service split, balances', async () => {
  const d = await driver('09128880002', 88880002, { lat: 35.70, lng: 51.34 }, 'black');
  const rider = await t.login('09358880020');
  const offer = t.waitFor(d.sock, 'ride:offer');
  const { ride } = await t.api(rider, 'POST', '/api/rider/rides', { type: 'black', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab, promo_code: 'NENA50' });
  await offer;
  for (const step of ['accept']) await t.api(d.token, 'POST', `/api/driver/offers/${ride.id}/${step}`);
  for (const step of ['arrived', 'start', 'complete']) await t.api(d.token, 'POST', `/api/driver/rides/${ride.id}/${step}`);
  const done = (await t.api(rider, 'GET', `/api/rider/rides/${ride.id}`)).ride;

  const e = await t.api(admin, 'GET', '/api/admin/economics?days=7');
  assert.equal(e.daily.length, 7);
  assert.equal(e.hourly.length, 24);
  const blackSvc = e.services.find((s) => s.key === 'black');
  assert.equal(blackSvc.trips, 1);
  assert.equal(blackSvc.gmv, done.fare_final);
  assert.equal(e.current.gmv, e.daily.reduce((a, x) => a + x.gmv, 0));
  assert.equal(e.current.net_revenue, e.current.commission - e.current.discounts);
  assert.ok(e.current.discounts >= done.discount);
  assert.equal(e.previous.trips, 0);
  assert.ok(e.balances.driver_debt > 0, 'cash ride leaves commission owed by the driver');
  assert.equal(e.top_drivers.find((x) => x.name === 'راننده 88880002').trips, 1);
  assert.equal((await t.api(rider, 'GET', '/api/admin/economics')).status, 403);
});
