import { Router } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError, ah, normalizePhone, now, randomDigits, toEnDigits } from '../util.js';
import { signToken, userView, requireAuth } from '../auth.js';
import { sendOtp } from '../services/sms.js';
import { getDriver, driverView } from '../services/drivers.js';

const router = Router();
const OTP_TTL = 2 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const hashCode = (phone, code) => createHash('sha256').update(`${phone}:${code}:${config.jwtSecret}`).digest();

router.post('/auth/otp', ah(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) throw new HttpError(400, 'شماره موبایل نامعتبر است');
  const existing = db.prepare('SELECT sent_at FROM otps WHERE phone = ?').get(phone);
  if (existing && now() - existing.sent_at < RESEND_MS) {
    const wait = Math.ceil((RESEND_MS - (now() - existing.sent_at)) / 1000);
    throw new HttpError(429, `لطفاً ${wait.toLocaleString('fa-IR')} ثانیه دیگر دوباره تلاش کنید`);
  }
  const code = randomDigits(5);
  db.prepare(`INSERT INTO otps (phone, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`)
    .run(phone, hashCode(phone, code).toString('hex'), now() + OTP_TTL, now());
  await sendOtp(phone, code);
  res.json({ ok: true, phone, expires_in: OTP_TTL / 1000, ...(config.exposeOtp ? { dev_code: code } : {}) });
}));

router.post('/auth/verify', ah(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = toEnDigits(req.body?.code).trim();
  const row = phone && db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
  if (!row || row.expires_at < now()) throw new HttpError(400, 'کد منقضی شده است؛ دوباره درخواست کنید');
  if (row.attempts >= 5) throw new HttpError(429, 'تعداد تلاش‌ها بیش از حد مجاز است؛ کد جدید بگیرید');
  if (!timingSafeEqual(hashCode(phone, code), Buffer.from(row.code_hash, 'hex'))) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    throw new HttpError(400, 'کد وارد شده صحیح نیست');
  }
  db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  const isNew = !user;
  if (!user) {
    const referral = 'N' + randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    db.prepare('INSERT INTO users (phone, referral_code, created_at) VALUES (?, ?, ?)').run(phone, referral, now());
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  }
  if (config.adminPhones.includes(phone) && !user.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
    user.is_admin = 1;
  }
  if (user.blocked) throw new HttpError(403, 'حساب کاربری شما مسدود شده است؛ با پشتیبانی تماس بگیرید');
  res.json({ token: signToken(user.id), user: userView(user), is_new: isNew });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: userView(req.user), driver: driverView(getDriver(req.user.id)) });
});

router.patch('/me', requireAuth, ah(async (req, res) => {
  const { name, email, emergency_contact } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (n.length < 2 || n.length > 60) throw new HttpError(400, 'نام باید بین ۲ تا ۶۰ حرف باشد');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(n, req.user.id);
  }
  if (email !== undefined) {
    const e = String(email).trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'ایمیل نامعتبر است');
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(e || null, req.user.id);
  }
  if (emergency_contact !== undefined) {
    const p = emergency_contact ? normalizePhone(emergency_contact) : null;
    if (emergency_contact && !p) throw new HttpError(400, 'شماره تماس اضطراری نامعتبر است');
    db.prepare('UPDATE users SET emergency_contact = ? WHERE id = ?').run(p, req.user.id);
  }
  res.json({ user: userView(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
}));

router.post('/me/referral', requireAuth, ah(async (req, res) => {
  if (req.user.referred_by) throw new HttpError(400, 'قبلاً کد معرف ثبت کرده‌اید');
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM rides WHERE rider_id = ? AND status = 'completed'").get(req.user.id);
  if (n > 0) throw new HttpError(400, 'کد معرف فقط پیش از اولین سفر قابل ثبت است');
  const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ? COLLATE NOCASE').get(String(req.body?.code || '').trim());
  if (!referrer || referrer.id === req.user.id) throw new HttpError(400, 'کد معرف معتبر نیست');
  db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(referrer.id, req.user.id);
  res.json({ ok: true });
}));

export default router;
