import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { config } from '../config.js';
import { db, getSettings } from '../db.js';
import { HttpError, ah, int, isValidNationalId, normalizeSheba, now, parseJson, toEnDigits } from '../util.js';
import { requireAuth, requireApprovedDriver } from '../auth.js';
import { emitAdmins } from '../realtime.js';
import { notifyAdmins } from '../services/push.js';
import { getDriver, driverView, updateDriverLocation } from '../services/drivers.js';
import { acceptOffer, declineOffer, offerPayload, withdrawOffersFor } from '../services/matching.js';
import {
  getRide, rideView, activeRideFor, markArrived, startRide, completeRide, cancelByDriver, rateRide, driverEarning,
} from '../services/rides.js';
import { addTx, listTx } from '../services/wallet.js';
import { openReservations, myReservations, claimReservation, releaseReservation } from '../services/reservations.js';
import { createPayment } from '../services/payment.js';

const router = Router();

// Vehicle classes open for registration at launch.
const VEHICLE_TYPES = ['eco', 'black'];
const BLACK_MIN_YEAR = { jalali: 1398, gregorian: 2019 };
const PLATE_LETTERS = 'ب ج د س ص ط ق ل م ن و ه ی ع پ ت ث ز ژ ش ف ک گ الف'.split(' ');
export const DOCUMENT_KINDS = ['license', 'national_card', 'vehicle_card', 'insurance', 'photo'];

// Car plates: "12|ب|345|67" (two digits, letter, three digits, region). Motorcycles: "123|45678".
function normalizePlate(input, vehicleType) {
  const parts = String(input || '').split('|').map((p) => toEnDigits(p).trim());
  if (vehicleType === 'bike') {
    if (parts.length === 2 && /^\d{3}$/.test(parts[0]) && /^\d{5}$/.test(parts[1])) return parts.join('|');
    throw new HttpError(400, 'پلاک موتورسیکلت نامعتبر است (۳ رقم و ۵ رقم)');
  }
  if (parts.length === 4 && /^\d{2}$/.test(parts[0]) && PLATE_LETTERS.includes(parts[1]) && /^\d{3}$/.test(parts[2]) && /^\d{2}$/.test(parts[3])) {
    return parts.join('|');
  }
  throw new HttpError(400, 'پلاک خودرو نامعتبر است');
}

router.get('/driver/profile', requireAuth, (req, res) => {
  res.json({ driver: driverView(getDriver(req.user.id)), document_kinds: DOCUMENT_KINDS });
});

router.post('/driver/register', requireAuth, (req, res) => {
  const b = req.body || {};
  const existing = getDriver(req.user.id);
  if (existing && ['approved', 'suspended'].includes(existing.status)) {
    throw new HttpError(400, 'برای تغییر اطلاعات حساب فعال با پشتیبانی تماس بگیرید');
  }
  const name = String(b.name || '').trim();
  if (name.length < 3) throw new HttpError(400, 'نام و نام خانوادگی را کامل وارد کنید');
  const nationalId = toEnDigits(b.national_id).trim();
  if (!isValidNationalId(nationalId)) throw new HttpError(400, 'کد ملی نامعتبر است');
  const dup = db.prepare('SELECT user_id FROM drivers WHERE national_id = ? AND user_id != ?').get(nationalId, req.user.id);
  if (dup) throw new HttpError(400, 'این کد ملی قبلاً ثبت شده است');
  const licenseNo = toEnDigits(b.license_no).trim();
  if (!/^\d{10}$/.test(licenseNo)) throw new HttpError(400, 'شماره گواهینامه باید ۱۰ رقم باشد');
  const vehicleType = VEHICLE_TYPES.includes(b.vehicle_type) ? b.vehicle_type : null;
  if (!vehicleType) throw new HttpError(400, 'نوع وسیله نقلیه را انتخاب کنید');
  const model = String(b.vehicle_model || '').trim().slice(0, 60);
  const color = String(b.vehicle_color || '').trim().slice(0, 30);
  if (!model || !color) throw new HttpError(400, 'مدل و رنگ وسیله نقلیه را وارد کنید');
  const year = int(b.vehicle_year, { min: 1370, max: 2100, name: 'سال ساخت' }); // Jalali or Gregorian
  if (vehicleType === 'black') {
    const recent = year < 1500 ? year >= BLACK_MIN_YEAR.jalali : year >= BLACK_MIN_YEAR.gregorian;
    if (!recent) throw new HttpError(400, 'برای نِنا بلک، خودرو باید مدل ۱۳۹۸ (۲۰۱۹) یا جدیدتر باشد');
    if (!/مشکی|سیاه|black/i.test(color)) throw new HttpError(400, 'خودروهای نِنا بلک باید رنگ مشکی داشته باشند');
  }
  const plate = normalizePlate(b.plate, vehicleType);
  const sheba = b.sheba ? normalizeSheba(b.sheba) : null;
  if (b.sheba && !sheba) throw new HttpError(400, 'شماره شبا نامعتبر است');

  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  db.prepare(`INSERT INTO drivers (user_id, status, national_id, license_no, vehicle_type, vehicle_model, vehicle_color, vehicle_year, plate, sheba, created_at)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = 'pending', status_reason = NULL, national_id = excluded.national_id,
      license_no = excluded.license_no, vehicle_type = excluded.vehicle_type, vehicle_model = excluded.vehicle_model,
      vehicle_color = excluded.vehicle_color, vehicle_year = excluded.vehicle_year, plate = excluded.plate, sheba = excluded.sheba`)
    .run(req.user.id, nationalId, licenseNo, vehicleType, model, color, year, plate, sheba, now());
  emitAdmins('driver:registered', { user_id: req.user.id, name });
  notifyAdmins({ title: 'درخواست رانندگی جدید', body: `${name} — ${vehicleType === 'black' ? 'نِنا بلک' : 'نِنا اکو'}`, url: '/admin/#drivers', tag: 'driver-registered' });
  res.json({ driver: driverView(getDriver(req.user.id)) });
});

// Document photos arrive as data URLs (JPEG/PNG/WebP, ≤ 3 MB) and are stored on disk.
router.post('/driver/documents', express.json({ limit: '5mb' }), requireAuth, (req, res) => {
  const driver = getDriver(req.user.id);
  if (!driver) throw new HttpError(400, 'ابتدا فرم ثبت‌نام را تکمیل کنید');
  const kind = String(req.body?.kind || '');
  if (!DOCUMENT_KINDS.includes(kind)) throw new HttpError(400, 'نوع مدرک نامعتبر است');
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(req.body?.data || ''));
  if (!m) throw new HttpError(400, 'فقط تصویر JPG، PNG یا WebP قابل بارگذاری است');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw new HttpError(400, 'حجم تصویر حداکثر ۳ مگابایت است');

  fs.mkdirSync(config.uploadDir, { recursive: true });
  const file = `${req.user.id}-${kind}-${randomBytes(6).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(config.uploadDir, file), buf);
  const docs = parseJson(driver.documents, {});
  if (docs[kind]) fs.rm(path.join(config.uploadDir, docs[kind]), { force: true }, () => {});
  docs[kind] = file;
  db.prepare('UPDATE drivers SET documents = ? WHERE user_id = ?').run(JSON.stringify(docs), req.user.id);
  res.json({ driver: driverView(getDriver(req.user.id)) });
});

router.post('/driver/online', requireApprovedDriver, (req, res) => {
  const online = !!req.body?.online;
  if (online && req.body.lat != null) updateDriverLocation(req.user.id, req.body);
  if (online && req.driver.lat == null && req.body.lat == null) throw new HttpError(400, 'موقعیت شما مشخص نیست؛ دسترسی موقعیت مکانی را فعال کنید');
  if (!online && req.driver.current_ride_id) throw new HttpError(400, 'در حین سفر نمی‌توانید آفلاین شوید');
  if (online) {
    const { wallet } = db.prepare('SELECT wallet FROM users WHERE id = ?').get(req.user.id);
    if (wallet < -2000000) throw new HttpError(400, 'بدهی شما به نِنا از سقف مجاز گذشته است؛ لطفاً کیف پول را شارژ کنید');
  }
  db.prepare('UPDATE drivers SET online = ?, last_seen = ? WHERE user_id = ?').run(online ? 1 : 0, now(), req.user.id);
  if (!online) withdrawOffersFor(req.user.id);
  res.json({ driver: driverView(getDriver(req.user.id)) });
});

router.post('/driver/location', requireApprovedDriver, (req, res) => {
  updateDriverLocation(req.user.id, req.body || {});
  res.json({ ok: true });
});

// Pending offer, for drivers reloading the page mid-countdown.
router.get('/driver/offer', requireApprovedDriver, (req, res) => {
  const ride = db.prepare("SELECT * FROM rides WHERE status = 'searching' AND offered_driver_id = ? AND offer_expires_at > ?")
    .get(req.user.id, now());
  res.json({ offer: ride ? offerPayload(ride, req.driver) : null });
});

router.post('/driver/offers/:id/accept', requireApprovedDriver, (req, res) => {
  res.json({ ride: rideView(acceptOffer(Number(req.params.id), req.user.id), 'driver') });
});

router.post('/driver/offers/:id/decline', requireApprovedDriver, (req, res) => {
  declineOffer(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

router.get('/driver/rides/active', requireApprovedDriver, (req, res) => {
  const ride = activeRideFor(req.user.id, 'driver');
  const unrated = db.prepare(`SELECT * FROM rides WHERE driver_id = ? AND status = 'completed' AND rating_by_driver IS NULL
    AND completed_at > ? ORDER BY id DESC LIMIT 1`).get(req.user.id, now() - 30 * 60 * 1000);
  res.json({ ride: rideView(ride, 'driver'), pending_rating: rideView(unrated, 'driver') });
});

const driverRide = (req) => {
  const ride = getRide(req.params.id);
  if (!ride || ride.driver_id !== req.user.id) throw new HttpError(404, 'سفر یافت نشد');
  return ride;
};

router.post('/driver/rides/:id/arrived', requireApprovedDriver, (req, res) => {
  res.json({ ride: rideView(markArrived(driverRide(req), req.user.id), 'driver') });
});
router.post('/driver/rides/:id/start', requireApprovedDriver, (req, res) => {
  res.json({ ride: rideView(startRide(driverRide(req), req.user.id, req.body?.pin), 'driver') });
});
router.post('/driver/rides/:id/complete', requireApprovedDriver, (req, res) => {
  res.json({ ride: rideView(completeRide(driverRide(req), req.user.id), 'driver') });
});
router.post('/driver/rides/:id/cancel', requireApprovedDriver, (req, res) => {
  const ride = driverRide(req);
  cancelByDriver(ride, req.user.id, req.body?.reason);
  res.json({ ok: true });
});
router.post('/driver/rides/:id/rate', requireApprovedDriver, (req, res) => {
  res.json({ ride: rideView(rateRide(driverRide(req), 'driver', req.body?.rating, req.body?.comment), 'driver') });
});

// Reservations (rides booked in advance) the driver can claim, and the ones they hold.
router.get('/driver/reservations', requireApprovedDriver, (req, res) => {
  res.json({ open: openReservations(req.driver), mine: myReservations(req.user.id) });
});
router.post('/driver/reservations/:id/claim', requireApprovedDriver, (req, res) => {
  res.json({ ride: rideView(claimReservation(Number(req.params.id), req.driver), 'driver') });
});
router.post('/driver/reservations/:id/release', requireApprovedDriver, (req, res) => {
  releaseReservation(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

router.get('/driver/rides', requireApprovedDriver, (req, res) => {
  const page = Math.max(0, Number(req.query.page) || 0);
  const rows = db.prepare(`SELECT * FROM rides WHERE driver_id = ? AND status IN ('completed', 'cancelled')
    ORDER BY id DESC LIMIT 20 OFFSET ?`).all(req.user.id, page * 20);
  res.json({ rides: rows.map((r) => rideView(r, 'driver')) });
});

const DAY = 24 * 3600 * 1000;
function startOfToday() {
  // Iran Standard Time (UTC+3:30).
  const offset = 3.5 * 3600 * 1000;
  return Math.floor((now() + offset) / DAY) * DAY - offset;
}

router.get('/driver/earnings', requireApprovedDriver, (req, res) => {
  const range = ['today', 'week', 'month'].includes(req.query.range) ? req.query.range : 'today';
  const days = { today: 1, week: 7, month: 30 }[range];
  const from = startOfToday() - (days - 1) * DAY;
  const rides = db.prepare(`SELECT * FROM rides WHERE driver_id = ? AND status = 'completed' AND completed_at >= ?`).all(req.user.id, from);
  const compensation = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions
    WHERE user_id = ? AND type = 'cancel_compensation' AND created_at >= ?`).get(req.user.id, from).s;

  const byDay = Array.from({ length: days }, (_, i) => ({ date: from + i * DAY, earning: 0, trips: 0 }));
  let total = 0, cash = 0, tips = 0, commission = 0, distance = 0, minutes = 0;
  for (const r of rides) {
    const e = driverEarning(r);
    total += e; cash += r.paid_cash; tips += r.tip; commission += r.commission; distance += r.distance_km || 0;
    minutes += r.started_at ? (r.completed_at - r.started_at) / 60000 : 0;
    const slot = byDay[Math.min(days - 1, Math.floor((r.completed_at - from) / DAY))];
    slot.earning += e; slot.trips += 1;
  }
  res.json({
    range, from, trips: rides.length, total: total + compensation, cash_collected: cash, tips, commission, compensation,
    distance_km: Math.round(distance * 10) / 10, drive_minutes: Math.round(minutes), by_day: byDay,
  });
});

// Areas with recent requests, so drivers can move toward demand.
router.get('/driver/demand', requireApprovedDriver, (_req, res) => {
  const points = db.prepare(`SELECT pickup_lat AS lat, pickup_lng AS lng, status FROM rides
    WHERE created_at > ? AND status IN ('searching', 'no_driver', 'accepted', 'arrived', 'in_progress', 'completed')`)
    .all(now() - 45 * 60 * 1000);
  res.json({ points });
});

router.get('/driver/wallet', requireApprovedDriver, (req, res) => {
  const { wallet } = db.prepare('SELECT wallet FROM users WHERE id = ?').get(req.user.id);
  const payouts = db.prepare('SELECT * FROM payouts WHERE driver_id = ? ORDER BY id DESC LIMIT 20').all(req.user.id);
  res.json({ balance: wallet, transactions: listTx(req.user.id), payouts, min_payout: getSettings().min_payout, sheba: req.driver.sheba });
});

router.post('/driver/sheba', requireApprovedDriver, (req, res) => {
  const sheba = normalizeSheba(req.body?.sheba);
  if (!sheba) throw new HttpError(400, 'شماره شبا نامعتبر است');
  db.prepare('UPDATE drivers SET sheba = ? WHERE user_id = ?').run(sheba, req.user.id);
  res.json({ sheba });
});

router.post('/driver/payouts', requireApprovedDriver, (req, res) => {
  if (!req.driver.sheba) throw new HttpError(400, 'ابتدا شماره شبا را ثبت کنید');
  const amount = int(req.body?.amount, { min: getSettings().min_payout, max: 500000000, name: 'مبلغ برداشت' });
  const { wallet } = db.prepare('SELECT wallet FROM users WHERE id = ?').get(req.user.id);
  if (wallet < amount) throw new HttpError(400, 'موجودی کافی نیست');
  addTx(req.user.id, -amount, 'payout', { description: 'درخواست تسویه به حساب بانکی' });
  db.prepare('INSERT INTO payouts (driver_id, amount, sheba, created_at) VALUES (?, ?, ?, ?)').run(req.user.id, amount, req.driver.sheba, now());
  res.status(201).json({ ok: true });
});

router.post('/driver/wallet/topup', requireApprovedDriver, ah(async (req, res) => {
  const amount = int(req.body?.amount, { min: 10000, max: 50000000, name: 'مبلغ' });
  res.json(await createPayment(req.user.id, amount, 'driver'));
}));

export default router;
