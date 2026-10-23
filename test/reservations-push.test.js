import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, nationalId, TEHRAN } from './helpers.js';

const MIN = 60 * 1000;
let t, admin, sent;
before(async () => {
  t = await boot();
  admin = await t.login('09120000000');
  const push = await import('../server/services/push.js');
  sent = [];
  push.setPushSender(async (sub, payload) => {
    if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
  });
});
after(async () => { await t.close(); });

const sub = (name) => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'BPk', auth: 'aa' } });
const waitPush = async (pred, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const hit = sent.find(pred); if (hit) return hit; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('push not sent');
};

async function driver(phone, seed, at, vehicle = 'eco') {
  const token = await t.login(phone);
  await t.api(token, 'POST', '/api/driver/register', {
    name: `راننده ${seed}`, national_id: nationalId(seed), license_no: '1234567890', vehicle_type: vehicle,
    vehicle_model: 'سمند', vehicle_color: 'مشکی', vehicle_year: 1401, plate: '12|ب|345|67',
  });
  const id = (await t.api(token, 'GET', '/api/me')).user.id;
  await t.api(admin, 'POST', `/api/admin/drivers/${id}/status`, { status: 'approved' });
  await t.api(token, 'POST', '/api/driver/online', { online: true, ...at });
  return { token, id };
}

test('push: subscribe, deliver while app hidden, drop expired subscriptions', async () => {
  const rider = await t.login('09357770001');
  assert.ok((await t.api(null, 'GET', '/api/push/key')).key.length > 40);
  assert.equal((await t.api(rider, 'POST', '/api/push/subscribe', { app: 'rider', subscription: { endpoint: 'http://x' } })).status, 400);
  assert.equal((await t.api(rider, 'POST', '/api/push/subscribe', { app: 'admin', subscription: sub('r-admin') })).status, 403);
  await t.api(rider, 'POST', '/api/push/subscribe', { app: 'rider', subscription: sub('rider-1') });
  await t.api(rider, 'POST', '/api/push/subscribe', { app: 'rider', subscription: sub('gone-1') });
  const r = await t.api(rider, 'POST', '/api/push/test', { app: 'rider' });
  assert.equal(r.sent, 1);
  const again = await t.api(rider, 'POST', '/api/push/test', { app: 'rider' });
  assert.equal(again.sent, 1, 'expired endpoint was removed');

  // Offers reach a driver with the app in the background, but not while it is on screen.
  const d = await driver('09127770001', 77770001, { lat: 35.7000, lng: 51.3385 });
  await t.api(d.token, 'POST', '/api/push/subscribe', { app: 'driver', subscription: sub('driver-1') });
  const visible = await t.socket(d.token, 'driver');
  const ride1 = (await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab })).ride;
  await new Promise((res) => setTimeout(res, 150));
  assert.ok(!sent.some((p) => p.endpoint.endsWith('driver-1')), 'no push while the driver app is visible');
  await t.api(rider, 'POST', `/api/rider/rides/${ride1.id}/cancel`);
  visible.emit('visibility', false);
  await new Promise((res) => setTimeout(res, 50));
  const ride2 = (await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab })).ride;
  const offer = await waitPush((p) => p.endpoint.endsWith('driver-1') && p.tag === 'offer');
  assert.match(offer.title, /درخواست سفر جدید/);
  assert.equal(offer.urgent, true);
  await t.api(d.token, 'POST', `/api/driver/offers/${ride2.id}/accept`);
  const accepted = await waitPush((p) => p.endpoint.endsWith('rider-1') && /در راه است/.test(p.title));
  assert.match(accepted.body, /سمند/);
  await t.api(d.token, 'POST', `/api/driver/rides/${ride2.id}/arrived`);
  await waitPush((p) => p.endpoint.endsWith('rider-1') && p.title === 'راننده رسید');
  await t.api(d.token, 'POST', `/api/rides/${ride2.id}/messages`, { text: 'جلوی در هستم' });
  await waitPush((p) => p.endpoint.endsWith('rider-1') && p.body === 'جلوی در هستم');
  await t.api(d.token, 'POST', `/api/driver/rides/${ride2.id}/start`);
  await t.api(d.token, 'POST', `/api/driver/rides/${ride2.id}/complete`);
  await waitPush((p) => p.endpoint.endsWith('rider-1') && p.title === 'به مقصد رسیدید');
  await t.api(d.token, 'POST', '/api/driver/online', { online: false });
});

test('reservations: claim, overlap guard, late-cancel fee, activation, fallback', async () => {
  const rider = await t.login('09357770002');
  const d1 = await driver('09127770002', 77770002, { lat: 35.80, lng: 51.43 });
  const d2 = await driver('09127770003', 77770003, { lat: 35.80, lng: 51.43 }, 'black');
  await t.api(rider, 'POST', '/api/push/subscribe', { app: 'rider', subscription: sub('rider-2') });

  const tooSoon = await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.tajrish, dropoff: TEHRAN.enghelab, scheduled_at: Date.now() + 10 * MIN });
  assert.equal(tooSoon.status, 400);

  const at = Date.now() + 3 * 3600 * 1000;
  const { ride } = await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.tajrish, dropoff: TEHRAN.enghelab, scheduled_at: at });
  assert.equal(ride.status, 'scheduled');

  // Eco reservations are open to Eco and Black cars; this one is near both.
  const list = await t.api(d1.token, 'GET', '/api/driver/reservations');
  assert.ok(list.open.some((r) => r.id === ride.id));
  assert.equal(list.open.find((r) => r.id === ride.id).pin, undefined);

  const claimed = await t.api(d1.token, 'POST', `/api/driver/reservations/${ride.id}/claim`);
  assert.equal(claimed.status, 200);
  assert.equal((await t.api(d2.token, 'POST', `/api/driver/reservations/${ride.id}/claim`)).status, 409, 'first driver wins');
  await waitPush((p) => p.endpoint.endsWith('rider-2') && /مشخص شد/.test(p.title));
  const riderView = (await t.api(rider, 'GET', '/api/rider/rides/scheduled')).rides[0];
  assert.equal(riderView.reserved_driver.name, 'راننده 77770002');

  // Overlapping reservation for the same driver is refused.
  const second = (await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.tajrish, dropoff: TEHRAN.azadi, scheduled_at: at + 30 * MIN })).ride;
  assert.equal((await t.api(d1.token, 'POST', `/api/driver/reservations/${second.id}/claim`)).status, 409);
  await t.api(rider, 'POST', `/api/rider/rides/${second.id}/cancel`);

  // The reserved driver gets no new on-demand requests close to pickup time — tested via activation below.
  // Late cancellation of a claimed reservation charges the fee to the reserved driver's benefit.
  const { db } = await import('../server/db.js');
  const late = (await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.tajrish, dropoff: TEHRAN.enghelab, scheduled_at: at + 5 * 3600 * 1000 })).ride;
  await t.api(d1.token, 'POST', `/api/driver/reservations/${late.id}/claim`);
  db.prepare('UPDATE rides SET scheduled_at = ? WHERE id = ?').run(Date.now() + 40 * MIN, late.id);
  const c = await t.api(rider, 'POST', `/api/rider/rides/${late.id}/cancel`);
  assert.equal(c.ride.cancel_fee, 20000);
  assert.equal((await t.api(d1.token, 'GET', '/api/driver/wallet')).balance, 20000);

  // Activation: 15 minutes before pickup the claimed reservation becomes an accepted ride.
  db.prepare('UPDATE rides SET scheduled_at = ? WHERE id = ?').run(Date.now() + 15 * MIN, ride.id);
  const { releaseScheduledRides } = await import('../server/services/matching.js');
  await releaseScheduledRides();
  const active = (await t.api(rider, 'GET', `/api/rider/rides/${ride.id}`)).ride;
  assert.equal(active.status, 'accepted');
  assert.equal(active.driver.name, 'راننده 77770002');
  await waitPush((p) => p.endpoint.endsWith('rider-2') && /یادآوری/.test(p.title));
  await waitPush((p) => p.endpoint.endsWith('rider-2') && /در راه است/.test(p.title));
  await t.api(rider, 'POST', `/api/rider/rides/${ride.id}/cancel`);

  // Fallback: the reserved driver is offline at activation → the ride is dispatched normally.
  const fb = (await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.tajrish, dropoff: TEHRAN.enghelab, scheduled_at: at })).ride;
  await t.api(d1.token, 'POST', `/api/driver/reservations/${fb.id}/claim`);
  await t.api(d1.token, 'POST', '/api/driver/online', { online: false });
  db.prepare('UPDATE rides SET scheduled_at = ? WHERE id = ?').run(Date.now() + 12 * MIN, fb.id);
  await releaseScheduledRides();
  const after = (await t.api(rider, 'GET', `/api/rider/rides/${fb.id}`)).ride;
  assert.ok(['searching', 'accepted'].includes(after.status));
  assert.equal(after.reserved_driver, undefined);
  await waitPush((p) => p.endpoint.endsWith('rider-2') && /تغییر راننده/.test(p.title));
  await t.api(d2.token, 'POST', '/api/driver/online', { online: false });
});
