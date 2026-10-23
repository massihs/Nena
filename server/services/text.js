// Persian date/time strings for notifications (Tehran time).
const fmt = (opts) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', ...opts });
const timeF = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
const dayF = fmt({ weekday: 'long', day: 'numeric', month: 'long' });

export const time = (t) => timeF.format(t);
export const dateTime = (t) => `${dayF.format(t)}، ساعت ${timeF.format(t)}`;
export const toman = (n) => `${Number(n || 0).toLocaleString('fa-IR')} تومان`;
