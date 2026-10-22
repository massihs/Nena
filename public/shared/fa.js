// Persian formatting helpers: digits, toman, Jalali dates.
const FA = '۰۱۲۳۴۵۶۷۸۹';

export const faDigits = (s) => String(s ?? '').replace(/\d/g, (d) => FA[d]);
export const enDigits = (s) => String(s ?? '').replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

export const num = (n, max = 1) => Number(n || 0).toLocaleString('fa-IR', { maximumFractionDigits: max });
export const toman = (n) => `${num(n, 0)} تومان`;
export const tomanShort = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return `${num(v / 1e6, 1)} میلیون`;
  if (Math.abs(v) >= 1e3) return `${num(v / 1e3, 0)} هزار`;
  return num(v, 0);
};

const fmt = (opts) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', ...opts });
const dateF = fmt({ day: 'numeric', month: 'long', year: 'numeric' });
const dateShortF = fmt({ day: 'numeric', month: 'long' });
const timeF = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
const weekdayF = fmt({ weekday: 'short' });

export const jDate = (ts) => dateF.format(ts);
export const jDateShort = (ts) => dateShortF.format(ts);
export const jTime = (ts) => timeF.format(ts);
export const jDateTime = (ts) => `${dateShortF.format(ts)}، ساعت ${timeF.format(ts)}`;
export const jWeekday = (ts) => weekdayF.format(ts);

export const minutes = (m) => `${num(Math.max(1, Math.round(m)), 0)} دقیقه`;
export const km = (k) => `${num(k, 1)} کیلومتر`;

export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'لحظاتی پیش';
  if (s < 3600) return `${num(Math.floor(s / 60), 0)} دقیقه پیش`;
  if (s < 86400) return `${num(Math.floor(s / 3600), 0)} ساعت پیش`;
  return jDateShort(ts);
}

export const STATUS_FA = {
  scheduled: 'رزرو شده',
  searching: 'در جستجوی راننده',
  no_driver: 'راننده‌ای یافت نشد',
  accepted: 'راننده در راه',
  arrived: 'راننده رسیده',
  in_progress: 'در حال سفر',
  completed: 'انجام شده',
  cancelled: 'لغو شده',
};

export const VEHICLE_FA = { eco: 'اکو', black: 'بلک (لوکس مشکی)', plus: 'سواری لوکس', van: 'ون', bike: 'موتورسیکلت' };
