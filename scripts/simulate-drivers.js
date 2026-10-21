// Spawns bot drivers around Tehran that go online, accept offers and drive the trip.
// Usage: npm run simulate   (env: BASE_URL, DRIVERS, ADMIN_PHONE, SIM_SPEED; server must expose dev OTP codes)
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const COUNT = Number(process.env.DRIVERS) || 8;
const ADMIN_PHONE = process.env.ADMIN_PHONE || '09120000000';
const CENTER = { lat: 35.7219, lng: 51.3890 };
const SPEED_KMH = 35;
// Time acceleration so demo trips don't take real minutes.
const SIM_SPEED = Number(process.env.SIM_SPEED) || 6;

const NAMES = ['علی رضایی', 'محمد حسینی', 'حسن کریمی', 'رضا احمدی', 'مهدی موسوی', 'امیر نوری', 'سعید جعفری', 'مریم صالحی', 'زهرا قاسمی', 'حمید باقری', 'نیما رحیمی', 'سارا کاظمی'];
const CARS = [['eco', 'پژو ۲۰۶', 'سفید'], ['eco', 'سمند', 'نقره‌ای'], ['eco', 'پراید ۱۳۱', 'سفید'], ['plus', 'تویوتا کمری', 'مشکی'], ['eco', 'ساینا', 'سفید'], ['van', 'هیوندای H1', 'سفید'], ['bike', 'هوندا ۱۲۵', 'قرمز'], ['plus', 'هیوندای سوناتا', 'سفید']];
const LETTERS = ['ب', 'ج', 'د', 'س', 'ص', 'ط', 'ق', 'ل', 'م', 'ن', 'و', 'ه', 'ی'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error || res.status}`);
  return data;
}

async function login(phone) {
  const otp = await api(null, 'POST', '/auth/otp', { phone }).catch(async (e) => {
    if (!/ثانیه/.test(e.message)) throw e;
    await sleep(61000);
    return api(null, 'POST', '/auth/otp', { phone });
  });
  if (!otp.dev_code) throw new Error('Server does not expose OTP codes (set NODE_ENV != production)');
  return (await api(null, 'POST', '/auth/verify', { phone, code: otp.dev_code })).token;
}

function nationalId(seed) {
  const d = String(seed).padStart(9, '0').slice(-9).split('').map(Number);
  const r = d.reduce((a, n, i) => a + n * (10 - i), 0) % 11;
  return d.join('') + (r < 2 ? r : 11 - r);
}

const bearing = (a, b) => {
  const k = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * k) * Math.cos(b.lat * k);
  const x = Math.cos(a.lat * k) * Math.sin(b.lat * k) - Math.sin(a.lat * k) * Math.cos(b.lat * k) * Math.cos((b.lng - a.lng) * k);
  return (Math.atan2(y, x) / k + 360) % 360;
};
const distKm = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180));

class Bot {
  constructor(i, token) {
    this.i = i;
    this.token = token;
    this.pos = { lat: CENTER.lat + rand(-0.05, 0.05), lng: CENTER.lng + rand(-0.06, 0.06) };
    this.busy = false;
    this.socket = io(BASE, { auth: { token }, transports: ['websocket'] });
    this.socket.on('ride:offer', (o) => this.onOffer(o));
    this.socket.on('ride:update', (r) => { if (r.status === 'cancelled' && this.ride?.id === r.id) this.cancelled = true; });
  }

  log(...a) { console.log(`[راننده ${this.i}]`, ...a); }

  emit(heading) {
    this.socket.emit('driver:location', { ...this.pos, heading });
  }

  // Walk along a path of [lat, lng] points at city speed, streaming GPS every second.
  async drive(path) {
    for (const [lat, lng] of path) {
      const target = { lat, lng };
      while (distKm(this.pos, target) > 0.02) {
        if (this.cancelled) return;
        const step = (SPEED_KMH / 3600) * SIM_SPEED;
        const d = distKm(this.pos, target);
        const k = Math.min(1, step / d);
        const h = bearing(this.pos, target);
        this.pos = { lat: this.pos.lat + (target.lat - this.pos.lat) * k, lng: this.pos.lng + (target.lng - this.pos.lng) * k };
        this.emit(h);
        await sleep(1000);
      }
    }
  }

  async wander() {
    while (true) {
      if (!this.busy) {
        const t = { lat: this.pos.lat + rand(-0.003, 0.003), lng: this.pos.lng + rand(-0.003, 0.003) };
        this.emit(bearing(this.pos, t));
        this.pos = t;
      }
      await sleep(5000);
    }
  }

  async onOffer({ ride }) {
    if (this.busy) return;
    if (Math.random() < 0.15) {
      this.log('رد درخواست', ride.id);
      return api(this.token, 'POST', `/driver/offers/${ride.id}/decline`).catch(() => {});
    }
    this.busy = true;
    this.cancelled = false;
    try {
      await sleep(rand(1500, 4000));
      const { ride: r } = await api(this.token, 'POST', `/driver/offers/${ride.id}/accept`);
      this.ride = r;
      this.log('پذیرش سفر', r.id, '←', r.pickup.address);
      await this.drive([[r.pickup.lat, r.pickup.lng]]);
      if (this.cancelled) throw new Error('لغو شد');
      await api(this.token, 'POST', `/driver/rides/${r.id}/arrived`);
      await sleep(6000);
      if (this.cancelled) throw new Error('لغو شد');
      await api(this.token, 'POST', `/driver/rides/${r.id}/start`, { pin: '' }).catch(async (e) => {
        this.log('شروع ناموفق (احتمالاً کد سفر لازم است):', e.message);
        throw e;
      });
      this.log('شروع سفر', r.id);
      await this.drive(r.route.length > 1 ? r.route : [[r.dropoff.lat, r.dropoff.lng]]);
      if (this.cancelled) throw new Error('لغو شد');
      await api(this.token, 'POST', `/driver/rides/${r.id}/complete`);
      this.log('پایان سفر', r.id);
      await api(this.token, 'POST', `/driver/rides/${r.id}/rate`, { rating: 5 }).catch(() => {});
    } catch (err) {
      this.log('سفر متوقف شد:', err.message);
    } finally {
      this.busy = false;
      this.ride = null;
    }
  }
}

const admin = await login(ADMIN_PHONE);
const bots = [];
for (let i = 0; i < COUNT; i++) {
  const phone = `0912100${String(1000 + i).slice(-4)}`;
  const token = await login(phone);
  const me = await api(token, 'GET', '/me');
  if (!me.driver || me.driver.status !== 'approved') {
    const [type, model, color] = CARS[i % CARS.length];
    const plate = type === 'bike' ? `${100 + i}|${String(20000 + i * 137).slice(-5)}` : `${10 + (i % 89)}|${LETTERS[i % LETTERS.length]}|${String(100 + i * 7).slice(-3)}|${10 + (i % 80)}`;
    await api(token, 'POST', '/driver/register', {
      name: NAMES[i % NAMES.length], national_id: nationalId(310000000 + i), license_no: String(9000000000 + i),
      vehicle_type: type, vehicle_model: model, vehicle_color: color, vehicle_year: 1398 + (i % 5), plate,
    });
    await api(admin, 'POST', `/admin/drivers/${me.user.id}/status`, { status: 'approved' });
  }
  const bot = new Bot(i + 1, token);
  await api(token, 'POST', '/driver/online', { online: true, ...bot.pos });
  bot.wander();
  bots.push(bot);
}
console.log(`${COUNT} راننده شبیه‌سازی‌شده آنلاین شدند — ${BASE}/rider/ را باز کنید و سفر درخواست دهید.`);

process.on('SIGINT', async () => {
  await Promise.all(bots.map((b) => api(b.token, 'POST', '/driver/online', { online: false }).catch(() => {})));
  process.exit(0);
});
