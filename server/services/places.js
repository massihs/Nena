import fs from 'node:fs';
import { haversineKm } from './geo.js';

// --- Persian text normalization -------------------------------------------

const CHAR_MAP = { 'ي': 'ی', 'ى': 'ی', 'ئ': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ؤ': 'و' };
const DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

// Lower-cases, unifies Arabic/Persian letter variants and digits, strips diacritics and
// turns half-spaces and punctuation into spaces: "سعادت‌آباد" → "سعادت اباد".
export function normalizeFa(text) {
  return String(text ?? '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[يىئكةۀأإآٱؤ]/g, (c) => CHAR_MAP[c])
    .replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d])
    .replace(/[‌‍‎‏]/g, ' ')
    .replace(/[،,.؛;:!؟?()\-_/\\"'«»]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Common Iranian address abbreviations.
const ABBR = { 'خ': 'خیابان', 'م': 'میدان', 'ب': 'بلوار', 'بز': 'بزرگراه', 'ک': 'کوچه', 'ایستگاه': 'مترو', 'میدون': 'میدان', 'خیابون': 'خیابان' };
// Words describing the kind of place; matching on them alone is meaningless.
const GENERIC = new Set(['میدان', 'خیابان', 'بلوار', 'بزرگراه', 'کوچه', 'مترو', 'بیمارستان', 'دانشگاه', 'پارک', 'بوستان', 'مرکز', 'خرید',
  'ترمینال', 'فرودگاه', 'هتل', 'برج', 'کاخ', 'موزه', 'بازار', 'مجتمع', 'تهران']);

export function queryTokens(q) {
  return normalizeFa(q).split(' ').filter(Boolean).map((t) => ABBR[t] || t);
}

export const expandQuery = (q) => queryTokens(q).join(' ');

// --- in-memory index --------------------------------------------------------

let index = [];

export function buildIndex(rows) {
  index = rows.map((p) => {
    const names = [p.name, ...(p.aliases || [])].map(normalizeFa);
    return {
      place: p,
      names,
      keys: names.map((n) => n.replace(/ /g, '')),
      words: new Set(names.join(' ').split(' ').concat(normalizeFa(p.address).split(' ')).filter(Boolean)),
    };
  });
}

function textScore(entry, tokens, qKey) {
  let best = 0;
  for (let i = 0; i < entry.names.length; i++) {
    const key = entry.keys[i];
    const words = entry.names[i].split(' ');
    if (key === qKey) best = Math.max(best, 100);
    else if (key.startsWith(qKey)) best = Math.max(best, 85);
    else if (tokens.every((t) => words.some((w) => w.startsWith(t)))) best = Math.max(best, 70);
    else if (qKey.length >= 3 && key.includes(qKey)) best = Math.max(best, 55);
  }
  if (best) return best;
  // Fall back to matching against name + address words (e.g. "ونک ملاصدرا").
  const distinctive = tokens.filter((t) => !GENERIC.has(t));
  if (distinctive.length && distinctive.every((t) => [...entry.words].some((w) => w.startsWith(t)))) return 40;
  return 0;
}

// Ranks curated places by text match, then proximity to the user and popularity.
export function searchLocal(q, { lat, lng, limit = 8 } = {}) {
  const tokens = queryTokens(q);
  if (!tokens.length) return [];
  const qKey = tokens.join('');
  if (qKey.length < 2) return [];
  const here = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const hits = [];
  for (const entry of index) {
    const text = textScore(entry, tokens, qKey);
    if (!text) continue;
    const p = entry.place;
    const distance = here ? haversineKm(here, p) : null;
    const near = distance == null ? 0 : Math.max(0, 25 - distance);
    hits.push({ p, distance, text, score: text + near + Math.min(15, Math.log2(1 + (p.popularity || 0)) * 3) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ p, distance, text }) => ({
    id: p.id, title: p.name, address: p.address, lat: p.lat, lng: p.lng, category: p.category, source: 'local',
    distance_km: distance == null ? null : Math.round(distance * 10) / 10,
    // "weak": only the address matched (e.g. a hospital on the searched street).
    weak: text < 55,
  }));
}

// Nearest curated place, used to describe a point when reverse geocoding is unavailable.
export function nearestPlace(lat, lng, maxKm = 0.4) {
  let best = null;
  for (const { place } of index) {
    if (place.category === 'street') continue;
    const d = haversineKm({ lat, lng }, place);
    if (d <= maxKm && (!best || d < best.d)) best = { place, d };
  }
  return best?.place || null;
}

export function loadSeed(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
