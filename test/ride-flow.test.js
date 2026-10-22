import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, nationalId, TEHRAN } from './helpers.js';

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

async function makeDriver(phone, seed, at, vehicle = 'eco') {
  const token = await t.login(phone);
  const reg = await t.api(token, 'POST', '/api/driver/register', {
    name: `راننده ${seed}`, national_id: nationalId(seed), license_no: '1234567890', vehicle_type: vehicle,
    vehicle_model: vehicle === 'black' ? 'تویوتا کمری' : 'پژو ۲۰۶', vehicle_color: vehicle === 'black' ? 'مشکی' : 'سفید', vehicle_year: 1400, plate: '12|ب|345|67',
  });
  assert.equal(reg.status, 200, JSON.stringify(reg));
  assert.equal(reg.driver.status, 'pending');
  const blocked = await t.api(token, 'POST', '/api/driver/online', { online: true, ...at });
  assert.equal(blocked.status, 403);

  const admin = await t.login('09120000000');
  const { drivers } = await t.api(admin, 'GET', '/api/admin/drivers?status=pending');
  const me = drivers.find((d) => d.phone === phone);
  assert.ok(me);
  assert.equal((await t.api(admin, 'POST', `/api/admin/drivers/${me.user_id}/status`, { status: 'approved' })).status, 200);

  const sock = await t.socket(token);
  const on = await t.api(token, 'POST', '/api/driver/online', { online: true, ...at });
  assert.equal(on.driver.online, true);
  return { token, sock, id: me.user_id };
}

test('validation errors are reported in Persian', async () => {
  const r = await t.api(null, 'POST', '/api/auth/otp', { phone: '123' });
  assert.equal(r.status, 400);
  assert.match(r.error, /شماره موبایل/);
  const token = await t.login('09350000001');
  const bad = await t.api(token, 'POST', '/api/driver/register', { name: 'علی رضایی', national_id: '1111111111' });
  assert.match(bad.error, /کد ملی/);
});

test('full ride: request → offer → accept → arrive → start → complete → rate', async () => {
  const driver = await makeDriver('09121111111', 11111111, { lat: 35.701, lng: 51.34 });
  const rider = await t.login('09351111111');
  await t.api(rider, 'PATCH', '/api/me', { name: 'سارا محمدی' });
  const riderSock = await t.socket(rider);

  const est = await t.api(rider, 'POST', '/api/rider/estimate', { pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab });
  assert.equal(est.status, 200);
  const eco = est.options.find((o) => o.type === 'eco');
  assert.ok(eco.fare >= 50000 && eco.fare % 1000 === 0, `fare ${eco.fare}`);
  assert.ok(eco.eta_min >= 1);
  assert.deepEqual(est.options.map((o) => o.type), ['eco', 'black'], 'launch catalogue is Eco + Black');
  assert.equal(est.options.find((o) => o.type === 'black').eta_min, null, 'an Eco car never shows as a Black ETA');
  assert.ok(est.options[1].fare > est.options[0].fare);

  const offerP = t.waitFor(driver.sock, 'ride:offer');
  const created = await t.api(rider, 'POST', '/api/rider/rides', {
    type: 'eco', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab, payment_method: 'cash', promo_code: 'NENA50',
  });
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(created.ride.status, 'searching');
  assert.match(created.ride.pin, /^\d{4}$/);
  assert.ok(created.ride.discount > 0 && created.ride.discount <= 40000);

  const dup = await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab });
  assert.equal(dup.status, 409);

  const offer = await offerP;
  assert.equal(offer.ride.id, created.ride.id);
  assert.equal(offer.ride.pin, undefined, 'drivers must not see the PIN');
  assert.equal(offer.ride.rider.name, 'سارا محمدی');

  const acceptedP = t.waitFor(riderSock, 'ride:update', (r) => r.status === 'accepted');
  const acc = await t.api(driver.token, 'POST', `/api/driver/offers/${offer.ride.id}/accept`);
  assert.equal(acc.ride.status, 'accepted');
  const accepted = await acceptedP;
  assert.equal(accepted.driver.name, 'راننده 11111111');
  assert.equal(accepted.driver.plate, '12|ب|345|67');

  const locP = t.waitFor(riderSock, 'driver:location');
  driver.sock.emit('driver:location', { lat: 35.7, lng: 51.339, heading: 90 });
  const loc = await locP;
  assert.equal(loc.lat, 35.7);

  const msgP = t.waitFor(driver.sock, 'chat:message');
  await t.api(rider, 'POST', `/api/rides/${offer.ride.id}/messages`, { text: 'جلوی در اصلی هستم' });
  assert.equal((await msgP).text, 'جلوی در اصلی هستم');

  const id = offer.ride.id;
  assert.equal((await t.api(driver.token, 'POST', `/api/driver/rides/${id}/start`)).status, 400, 'cannot start before arriving');
  assert.equal((await t.api(driver.token, 'POST', `/api/driver/rides/${id}/arrived`)).ride.status, 'arrived');
  assert.equal((await t.api(driver.token, 'POST', `/api/driver/rides/${id}/start`)).ride.status, 'in_progress');
  const off = await t.api(driver.token, 'POST', '/api/driver/online', { online: false });
  assert.equal(off.status, 400, 'cannot go offline mid-trip');

  const done = await t.api(driver.token, 'POST', `/api/driver/rides/${id}/complete`);
  assert.equal(done.ride.status, 'completed');
  const r = done.ride;
  assert.equal(r.fare_final, eco.fare);
  assert.equal(r.paid_cash, r.fare_final - r.discount);
  assert.equal(r.commission, Math.round(r.fare_final * 0.15));

  // Driver collected (fare − discount) in cash and owes commission, but is reimbursed the promo.
  const dw = await t.api(driver.token, 'GET', '/api/driver/wallet');
  assert.equal(dw.balance, r.discount - r.commission);

  const rated = await t.api(rider, 'POST', `/api/rider/rides/${id}/rate`, { rating: 5, tags: ['رانندگی ایمن'] });
  assert.equal(rated.ride.rating_by_rider, 5);
  assert.equal((await t.api(rider, 'POST', `/api/rider/rides/${id}/rate`, { rating: 4 })).status, 400);
  await t.api(driver.token, 'POST', `/api/driver/rides/${id}/rate`, { rating: 4 });
  const me = await t.api(rider, 'GET', '/api/me');
  assert.equal(me.user.rating, 4);

  // Promo is single-use per rider.
  const again = await t.api(rider, 'POST', '/api/rider/promo/check', { code: 'nena50' });
  assert.equal(again.status, 400);

  const earnings = await t.api(driver.token, 'GET', '/api/driver/earnings?range=week');
  assert.equal(earnings.trips, 1);
  assert.equal(earnings.total, r.fare_final - r.commission);
  assert.equal(earnings.by_day.length, 7);

  const pub = await t.api(null, 'GET', `/api/track/${created.ride.share_token}`);
  assert.equal(pub.ride.status, 'completed');
  assert.equal(pub.ride.driver.phone, undefined);

  await t.api(driver.token, 'POST', '/api/driver/online', { online: false });
});

test('declined offer moves to next driver; wallet payment and tip', async () => {
  const d1 = await makeDriver('09122222221', 22222221, { lat: 35.8040, lng: 51.4335 });
  const d2 = await makeDriver('09122222222', 22222222, { lat: 35.8100, lng: 51.4400 });
  const rider = await t.login('09352222222');

  const topup = await t.api(rider, 'POST', '/api/rider/wallet/topup', { amount: 500000 });
  const page = await fetch(t.base + topup.url);
  assert.equal(page.status, 200);
  const authority = topup.url.split('/').pop();
  const cb = await fetch(`${t.base}/api/pay/callback?Authority=${authority}&Status=OK`, { redirect: 'manual' });
  assert.equal(cb.headers.get('location'), '/rider/?topup=ok');
  await fetch(`${t.base}/api/pay/callback?Authority=${authority}&Status=OK`, { redirect: 'manual' }); // replay is a no-op
  assert.equal((await t.api(rider, 'GET', '/api/rider/wallet')).balance, 500000);

  const offer1P = t.waitFor(d1.sock, 'ride:offer');
  const offer2P = t.waitFor(d2.sock, 'ride:offer');
  const { ride } = await t.api(rider, 'POST', '/api/rider/rides', {
    type: 'eco', pickup: TEHRAN.tajrish, dropoff: TEHRAN.enghelab, payment_method: 'wallet',
  });
  const o1 = await offer1P; // nearest first
  assert.equal(o1.ride.id, ride.id);
  await t.api(d1.token, 'POST', `/api/driver/offers/${ride.id}/decline`);
  const o2 = await offer2P;
  assert.equal(o2.ride.id, ride.id);
  assert.equal((await t.api(d1.token, 'POST', `/api/driver/offers/${ride.id}/accept`)).status, 409);
  await t.api(d2.token, 'POST', `/api/driver/offers/${ride.id}/accept`);
  await t.api(d2.token, 'POST', `/api/driver/rides/${ride.id}/arrived`);
  await t.api(d2.token, 'POST', `/api/driver/rides/${ride.id}/start`);
  const done = (await t.api(d2.token, 'POST', `/api/driver/rides/${ride.id}/complete`)).ride;
  assert.equal(done.paid_wallet, done.fare_final);
  assert.equal(done.paid_cash, 0);

  const tip = await t.api(rider, 'POST', `/api/rider/rides/${ride.id}/tip`, { amount: 20000 });
  assert.equal(tip.ride.tip, 20000);
  const rw = await t.api(rider, 'GET', '/api/rider/wallet');
  assert.equal(rw.balance, 500000 - done.fare_final - 20000);
  const dw = await t.api(d2.token, 'GET', '/api/driver/wallet');
  assert.equal(dw.balance, done.fare_final - done.commission + 20000);

  for (const d of [d1, d2]) await t.api(d.token, 'POST', '/api/driver/online', { online: false });
});

test('late rider cancellation charges a fee that is collected on the next ride', async () => {
  const d = await makeDriver('09123333333', 33333333, { lat: 35.7000, lng: 51.3385 });
  const rider = await t.login('09353333333');
  const admin = await t.login('09120000000');
  await t.api(admin, 'PUT', '/api/admin/settings', { free_cancel_seconds: 0 });

  const offerP = t.waitFor(d.sock, 'ride:offer');
  const { ride } = await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.azadi, dropoff: TEHRAN.tajrish });
  await offerP;
  await t.api(d.token, 'POST', `/api/driver/offers/${ride.id}/accept`);
  await new Promise((r) => setTimeout(r, 20));
  const c = await t.api(rider, 'POST', `/api/rider/rides/${ride.id}/cancel`, { reason: 'تغییر برنامه' });
  assert.equal(c.ride.status, 'cancelled');
  assert.equal(c.ride.cancel_fee, 20000);
  assert.equal((await t.api(rider, 'GET', '/api/rider/wallet')).balance, -20000);
  assert.equal((await t.api(d.token, 'GET', '/api/driver/wallet')).balance, 20000);
  await t.api(admin, 'PUT', '/api/admin/settings', { free_cancel_seconds: 120 });

  // Next ride collects the debt in cash.
  const offer2P = t.waitFor(d.sock, 'ride:offer');
  const second = (await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab })).ride;
  await offer2P;
  await t.api(d.token, 'POST', `/api/driver/offers/${second.id}/accept`);
  await t.api(d.token, 'POST', `/api/driver/rides/${second.id}/arrived`);
  await t.api(d.token, 'POST', `/api/driver/rides/${second.id}/start`);
  const done = (await t.api(d.token, 'POST', `/api/driver/rides/${second.id}/complete`)).ride;
  assert.equal(done.paid_cash, done.fare_final + 20000);
  assert.equal((await t.api(rider, 'GET', '/api/rider/wallet')).balance, 0);
  await t.api(d.token, 'POST', '/api/driver/online', { online: false });
});

test('driver cancellation re-dispatches; admin can see live data', async () => {
  const d1 = await makeDriver('09124444441', 44444441, { lat: 35.75, lng: 51.40 });
  const d2 = await makeDriver('09124444442', 44444442, { lat: 35.752, lng: 51.402 });
  const rider = await t.login('09354444444');
  const pickup = { lat: 35.7505, lng: 51.4005, address: 'ونک' };

  const o1P = t.waitFor(d1.sock, 'ride:offer');
  const { ride } = await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup, dropoff: TEHRAN.tajrish });
  await o1P;
  await t.api(d1.token, 'POST', `/api/driver/offers/${ride.id}/accept`);
  const o2P = t.waitFor(d2.sock, 'ride:offer');
  await t.api(d1.token, 'POST', `/api/driver/rides/${ride.id}/cancel`, { reason: 'خرابی خودرو' });
  const o2 = await o2P;
  assert.equal(o2.ride.id, ride.id);

  const admin = await t.login('09120000000');
  const live = await t.api(admin, 'GET', '/api/admin/live');
  assert.ok(live.rides.some((r) => r.id === ride.id && r.status === 'searching'));
  const stats = await t.api(admin, 'GET', '/api/admin/stats');
  assert.ok(stats.today.trips >= 3);
  assert.equal((await t.api(rider, 'GET', '/api/admin/stats')).status, 403);

  const cancel = await t.api(admin, 'POST', `/api/admin/rides/${ride.id}/cancel`);
  assert.equal(cancel.ride.status, 'cancelled');
  assert.equal(cancel.ride.cancel_fee, 0);
});

test('disabled services are refused until an admin enables them; scheduled rides wait', async () => {
  const rider = await t.login('09355555555');
  const admin = await t.login('09120000000');
  const off = await t.api(rider, 'POST', '/api/rider/rides', { type: 'box', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab });
  assert.equal(off.status, 400);
  await t.api(admin, 'PUT', '/api/admin/ride-types/box', { active: true });
  const box = await t.api(rider, 'POST', '/api/rider/rides', { type: 'box', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab });
  assert.match(box.error, /گیرنده/, 'delivery requires a recipient');
  await t.api(admin, 'PUT', '/api/admin/ride-types/box', { active: false });

  const at = Date.now() + 60 * 60 * 1000;
  const s = await t.api(rider, 'POST', '/api/rider/rides', { type: 'black', pickup: TEHRAN.azadi, dropoff: TEHRAN.enghelab, scheduled_at: at });
  assert.equal(s.ride.status, 'scheduled');
  const list = await t.api(rider, 'GET', '/api/rider/rides/scheduled');
  assert.equal(list.rides.length, 1);
  assert.equal((await t.api(rider, 'POST', `/api/rider/rides/${s.ride.id}/cancel`)).ride.cancel_fee, 0);
});

test('Black: vehicle requirements, Black-only dispatch, Eco prefers Eco cars', async () => {
  const token = await t.login('09126666660');
  const base = { name: 'کامران رادمنش', national_id: nationalId(66666660), license_no: '1234567890', vehicle_type: 'black', vehicle_model: 'تویوتا کمری', plate: '44|س|444|44' };
  assert.match((await t.api(token, 'POST', '/api/driver/register', { ...base, vehicle_color: 'سفید', vehicle_year: 1400 })).error, /مشکی/);
  assert.match((await t.api(token, 'POST', '/api/driver/register', { ...base, vehicle_color: 'مشکی', vehicle_year: 1392 })).error, /۱۳۹۸/);
  assert.equal((await t.api(token, 'POST', '/api/driver/register', { ...base, vehicle_type: 'van', vehicle_color: 'مشکی', vehicle_year: 1400 })).status, 400);

  const at = { lat: 35.7300, lng: 51.3500 };
  const black = await makeDriver('09126666661', 66666661, at, 'black');
  const eco = await makeDriver('09126666662', 66666662, { lat: 35.7320, lng: 51.3520 }, 'eco');
  const rider = await t.login('09356666666');
  const pickup = { lat: 35.7301, lng: 51.3501, address: 'مبدأ' };

  // A Black request only ever goes to Black cars.
  const blackOffer = t.waitFor(black.sock, 'ride:offer');
  const r1 = (await t.api(rider, 'POST', '/api/rider/rides', { type: 'black', pickup, dropoff: TEHRAN.tajrish })).ride;
  assert.equal((await blackOffer).ride.type, 'black');
  await t.api(black.token, 'POST', `/api/driver/offers/${r1.id}/decline`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await t.api(eco.token, 'GET', '/api/driver/offer')).offer, null, 'Eco car never gets a Black request');
  await t.api(rider, 'POST', `/api/rider/rides/${r1.id}/cancel`);

  // An Eco request prefers the Eco car even though the Black car is a little closer.
  const ecoOffer = t.waitFor(eco.sock, 'ride:offer');
  const r2 = (await t.api(rider, 'POST', '/api/rider/rides', { type: 'eco', pickup, dropoff: TEHRAN.tajrish })).ride;
  assert.equal((await ecoOffer).ride.id, r2.id);
  await t.api(rider, 'POST', `/api/rider/rides/${r2.id}/cancel`);
  for (const d of [black, eco]) await t.api(d.token, 'POST', '/api/driver/online', { online: false });
});
