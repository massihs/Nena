import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './util.js';

export const signToken = (userId) => jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: '30d' });

// Returns the user row for a valid token, or null.
export function verifyToken(token) {
  if (!token) return null;
  try {
    const { uid } = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    return user && !user.blocked ? user : null;
  } catch {
    return null;
  }
}

export const userRating = (u) => (u.rating_count ? Math.round((u.rating_sum / u.rating_count) * 100) / 100 : 5);

export function userView(u) {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    email: u.email,
    wallet: u.wallet,
    rating: userRating(u),
    referral_code: u.referral_code,
    referred: !!u.referred_by,
    emergency_contact: u.emergency_contact,
    is_admin: !!u.is_admin,
    created_at: u.created_at,
  };
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const user = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!user) return next(new HttpError(401, 'لطفاً دوباره وارد شوید'));
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user.is_admin) return next(new HttpError(403, 'دسترسی مدیریت ندارید'));
    next();
  });
}

export function requireApprovedDriver(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver) return next(new HttpError(403, 'ابتدا به‌عنوان راننده ثبت‌نام کنید'));
    if (driver.status !== 'approved') return next(new HttpError(403, 'حساب رانندگی شما هنوز فعال نشده است'));
    req.driver = driver;
    next();
  });
}
