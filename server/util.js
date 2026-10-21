import { randomInt } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const now = () => Date.now();

// Wrap async route handlers so thrown errors reach the error middleware.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toEnDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))
    .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));
}

// Normalizes Iranian mobile numbers to 09xxxxxxxxx, or returns null.
export function normalizePhone(input) {
  let p = toEnDigits(input).replace(/[\s\-()]/g, '');
  if (p.startsWith('+98')) p = '0' + p.slice(3);
  else if (p.startsWith('0098')) p = '0' + p.slice(4);
  else if (p.startsWith('98') && p.length === 12) p = '0' + p.slice(2);
  else if (p.startsWith('9') && p.length === 10) p = '0' + p;
  return /^09\d{9}$/.test(p) ? p : null;
}

// Iranian national code (کد ملی) checksum.
export function isValidNationalId(input) {
  const code = toEnDigits(input);
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(code[i]) * (10 - i);
  const r = sum % 11;
  const check = Number(code[9]);
  return r < 2 ? check === r : check === 11 - r;
}

// Iranian IBAN (شبا): IR + 24 digits, ISO 13616 mod-97 check.
export function normalizeSheba(input) {
  const s = toEnDigits(input).toUpperCase().replace(/\s/g, '');
  const v = s.startsWith('IR') ? s : 'IR' + s;
  if (!/^IR\d{24}$/.test(v)) return null;
  const rearranged = v.slice(4) + '1827' + v.slice(2, 4); // I=18, R=27
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1 ? v : null;
}

export function parseLatLng(obj, field = 'location') {
  const lat = Number(obj?.lat);
  const lng = Number(obj?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, `موقعیت نامعتبر است (${field})`);
  }
  return { lat, lng, address: String(obj.address || '').slice(0, 300) };
}

export function int(value, { min = -Infinity, max = Infinity, name = 'مقدار' } = {}) {
  const n = Number(toEnDigits(value));
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} نامعتبر است`);
  return n;
}

export const randomDigits = (n) =>
  Array.from({ length: n }, () => randomInt(10)).join('');

export function parseJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}
