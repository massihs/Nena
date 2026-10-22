import { createApi } from '/shared/api.js';
import { h, mount, icon, toast, toastError, modal, confirmDialog, busy, plateEl, beep } from '/shared/ui.js';
import { createMap, carIcon, pinIcon } from '/shared/map.js';
import { renderLogin } from '/shared/login.js';
import * as fa from '/shared/fa.js';
import { categoryLabel } from '/shared/places.js';
import { economicsPage } from './economics.js';
import { surgePage } from './surge.js';

const L = window.L;
const api = createApi('admin');
const root = document.getElementById('root');
const S = { cfg: null, section: 'dashboard', main: null, nav: null, stats: null, liveTimer: null };
const ctx = { api, S };

const SECTIONS = [
  ['dashboard', 'داشبورد زنده', 'chart'],
  ['economics', 'اقتصاد و درآمد', 'money'],
  ['surge', 'افزایش قیمت', 'fire'],
  ['drivers', 'رانندگان', 'car'],
  ['users', 'کاربران', 'users'],
  ['rides', 'سفرها', 'history'],
  ['pricing', 'سرویس‌ها و تعرفه‌ها', 'tag'],
  ['places', 'مکان‌ها و آدرس‌ها', 'pin'],
  ['promos', 'کدهای تخفیف', 'gift'],
  ['sos', 'هشدارهای ایمنی', 'sos'],
  ['payouts', 'تسویه رانندگان', 'wallet'],
  ['settings', 'تنظیمات', 'settings'],
];

async function boot() {
  S.cfg = await api.get('/config');
  if (!api.token) return showLogin();
  const { user } = await api.get('/me');
  if (!user.is_admin) {
    api.setToken(null);
    toast('این شماره دسترسی مدیریت ندارد', 'error');
    return showLogin();
  }
  shell();
}

function showLogin() {
  mount(root, h('div', { class: 'center-page' }, h('div', { id: 'login', class: 'auth' })));
  renderLogin(root.querySelector('#login'), api, { title: 'پنل مدیریت نِنا', subtitle: 'ورود فقط برای مدیران مجاز است.', onDone: () => boot() });
}

function shell() {
  S.nav = h('nav', { class: 'side' });
  S.main = h('main', { class: 'main' });
  mount(root, h('div', { class: 'admin' }, S.nav, S.main));
  const socket = api.connect();
  socket.on('sos', (a) => {
    beep();
    toast(`🚨 هشدار اضطراری از ${a.name || a.phone} — سفر #${fa.num(a.ride_id)}`, 'error');
    refreshCounts();
  });
  socket.on('driver:registered', (d) => { toast(`درخواست رانندگی جدید: ${d.name}`); refreshCounts(); });
  refreshCounts();
  go(location.hash.slice(1) || 'dashboard');
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
}

async function refreshCounts() {
  try { S.stats = await api.get('/admin/stats'); } catch { /* ignore */ }
  drawNav();
}

function drawNav() {
  const counts = { drivers: S.stats?.pending_drivers, sos: S.stats?.open_sos, payouts: S.stats?.pending_payouts };
  mount(S.nav,
    h('div', { class: 'brand' }, 'نِنا', h('span', { class: 'small muted', style: { marginInlineStart: '8px', fontWeight: 500 } }, 'مدیریت')),
    SECTIONS.map(([k, label, ic]) => h('button', { class: S.section === k ? 'active' : '', onclick: () => { location.hash = k; } },
      icon(ic), label, counts[k] ? h('span', { class: 'count' }, fa.num(counts[k])) : null)),
    h('button', { onclick: () => { api.setToken(null); location.reload(); } }, icon('logout'), 'خروج'));
}

function go(section) {
  if (!SECTIONS.some(([k]) => k === section)) section = 'dashboard';
  S.section = section;
  clearInterval(S.liveTimer);
  drawNav();
  const pages = {
    dashboard, drivers, users, rides, pricing, places, promos, sos, payouts, settings,
    economics: () => economicsPage(ctx), surge: () => surgePage(ctx),
  };
  pages[section]().catch(toastError);
}

const table = (headers, rows) => h('div', { class: 'table-wrap' }, h('table', {},
  h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
  h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: headers.length, class: 'empty' }, 'موردی یافت نشد')))));

const statusBadge = (s, map = fa.STATUS_FA) => {
  const color = { completed: 'green', approved: 'green', paid: 'green', cancelled: 'red', rejected: 'red', suspended: 'red', no_driver: 'red', pending: 'yellow', searching: 'yellow' }[s] || 'blue';
  return h('span', { class: `badge ${color}` }, map[s] || s);
};

// ---------------------------------------------------------------------------

async function dashboard() {
  const s = await api.get('/admin/stats');
  S.stats = s;
  drawNav();
  const stat = (label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 's-label' }, label), h('div', { class: 's-value' }, value), sub ? h('div', { class: 'tiny muted' }, sub) : null);
  const mapEl = h('div', { class: 'live-map' });
  const activeList = h('div', { class: 'card', style: { maxHeight: '420px', overflowY: 'auto' } });
  const max = Math.max(1, ...s.daily.map((d) => d.trips));
  mount(S.main,
    h('h1', {}, 'داشبورد'),
    h('div', { class: 'stats' },
      stat('سفرهای ۲۴ ساعت اخیر', fa.num(s.today.trips)),
      stat('ارزش ناخالص سفرها', fa.toman(s.today.gmv)),
      stat('درآمد کمیسیون', fa.toman(s.today.commission), `تخفیف‌ها: ${fa.toman(s.today.discounts)}`),
      stat('سفرهای فعال', fa.num(s.active_rides)),
      stat('رانندگان آنلاین', fa.num(s.online_drivers), `از ${fa.num(s.total_drivers)} راننده فعال`),
      stat('لغو / بدون راننده', `${fa.num(s.cancelled_today)} / ${fa.num(s.no_driver_today)}`),
      stat('کاربران', fa.num(s.total_users)),
      stat('در انتظار تأیید', fa.num(s.pending_drivers))),
    h('div', { class: 'grid-2 mt-lg' },
      h('div', {}, h('h3', {}, 'نقشه زنده'), mapEl),
      h('div', {}, h('h3', {}, 'سفرهای در جریان'), activeList)),
    h('div', { class: 'card mt-lg' },
      h('h3', {}, 'سفرهای انجام‌شده — ۱۴ روز اخیر'),
      s.daily.length
        ? h('div', { class: 'bars' }, s.daily.map((d) => h('div', { class: 'bar', 'data-tip': `${fa.jDateShort(d.date)}: ${fa.num(d.trips)} سفر • ${fa.toman(d.gmv)}` },
          h('i', { style: { height: `${(d.trips / max) * 100}%` } }), h('small', {}, fa.jDateShort(d.date)))))
        : h('div', { class: 'empty' }, 'هنوز سفری انجام نشده است')));

  const map = createMap(mapEl, S.cfg);
  const layer = L.layerGroup().addTo(map);
  let fitted = false;
  const refresh = async () => {
    if (!mapEl.isConnected) return clearInterval(S.liveTimer);
    const live = await api.get('/admin/live');
    layer.clearLayers();
    for (const d of live.drivers) {
      L.marker([d.lat, d.lng], { icon: carIcon(d.vehicle_type, d.heading) }).bindTooltip(`${d.name}${d.current_ride_id ? ' — در سفر' : ' — آزاد'}`).addTo(layer);
    }
    for (const r of live.rides) {
      L.marker([r.pickup.lat, r.pickup.lng], { icon: pinIcon('o') }).bindTooltip(`#${r.id} ${fa.STATUS_FA[r.status]}`).addTo(layer);
    }
    if (!fitted && live.drivers.length) { map.fitBounds(L.latLngBounds(live.drivers.map((d) => [d.lat, d.lng])).pad(0.3), { maxZoom: 15 }); fitted = true; }
    mount(activeList, live.rides.length ? live.rides.map((r) => h('div', { class: 'list-item', onclick: () => rideDetail(r.id) },
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, `#${fa.num(r.id)} • ${r.type_name}`), h('div', { class: 'li-sub' }, `${r.rider.name || r.rider.phone} ← ${r.driver?.name || '—'}`)),
      statusBadge(r.status))) : h('div', { class: 'empty' }, 'سفر فعالی وجود ندارد'));
  };
  await refresh();
  S.liveTimer = setInterval(() => refresh().catch(() => {}), 5000);
}

// ---------------------------------------------------------------------------

const DRIVER_STATUS = { pending: 'در انتظار تأیید', approved: 'فعال', rejected: 'رد شده', suspended: 'تعلیق' };

async function drivers(filter = 'pending', q = '') {
  const { drivers: list } = await api.get(`/admin/drivers?status=${filter}&q=${encodeURIComponent(q)}`);
  const search = h('input', { class: 'input', placeholder: 'جستجوی نام، موبایل یا پلاک', value: q, onkeydown: (e) => { if (e.key === 'Enter') drivers(filter, search.value).catch(toastError); } });
  mount(S.main,
    h('h1', {}, 'رانندگان'),
    h('div', { class: 'toolbar' },
      h('div', { class: 'tabs' }, [['pending', 'در انتظار'], ['approved', 'فعال'], ['suspended', 'تعلیق'], ['rejected', 'رد شده'], ['', 'همه']].map(([k, l]) =>
        h('button', { class: filter === k ? 'active' : '', onclick: () => drivers(k, search.value).catch(toastError) }, l))),
      search),
    table(['نام', 'موبایل', 'وسیله', 'پلاک', 'امتیاز', 'سفرها', 'کیف پول', 'آنلاین', 'وضعیت', 'ثبت‌نام'],
      list.map((d) => h('tr', { class: 'clickable', onclick: () => driverDetail(d, () => drivers(filter, q)) },
        h('td', { class: 'bold' }, d.name), h('td', { class: 'ltr' }, fa.faDigits(d.phone)),
        h('td', {}, `${fa.VEHICLE_FA[d.vehicle_type]} — ${d.vehicle_model || ''}`), h('td', {}, plateEl(d.plate)),
        h('td', {}, fa.num(d.rating, 2)), h('td', {}, fa.num(d.trips)), h('td', {}, fa.toman(d.wallet)),
        h('td', {}, h('span', { class: `online-dot ${d.online ? 'on' : ''}`, style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: d.online ? 'var(--accent)' : 'var(--soft-2)' } })),
        h('td', {}, statusBadge(d.status, DRIVER_STATUS)), h('td', {}, fa.jDateShort(d.created_at))))));
}

// Document images need the auth header, so they're fetched as blobs.
async function authedImage(file) {
  const res = await fetch(`/api/admin/documents/${encodeURIComponent(file)}`, { headers: { Authorization: `Bearer ${api.token}` } });
  if (!res.ok) throw new Error('بارگذاری تصویر ناموفق بود');
  return URL.createObjectURL(await res.blob());
}

const DOC_FA = { license: 'گواهینامه', national_card: 'کارت ملی', vehicle_card: 'کارت خودرو', insurance: 'بیمه‌نامه', photo: 'عکس پرسنلی' };

function driverDetail(d, reload) {
  modal((close) => {
    const docs = h('div', { class: 'docs-grid' });
    for (const [kind, label] of Object.entries(DOC_FA)) {
      const file = d.document_files[kind];
      const cell = h('div', {}, h('div', { class: 'small bold' }, label), file ? h('span', { class: 'spinner' }) : h('span', { class: 'badge red' }, 'ارسال نشده'));
      docs.append(cell);
      if (file) {
        authedImage(file).then((src) => {
          cell.lastChild.replaceWith(h('a', { href: src, target: '_blank' }, h('img', { class: 'doc-img', src, alt: label })));
        }).catch(() => { cell.lastChild.replaceWith(h('span', { class: 'badge red' }, 'خطا')); });
      }
    }
    const reason = h('input', { class: 'input', placeholder: 'دلیل (برای رد یا تعلیق)' });
    const setStatus = (status) => async (e) => {
      if (status !== 'approved' && !(await confirmDialog('تغییر وضعیت', `وضعیت به «${DRIVER_STATUS[status]}» تغییر کند؟`, { danger: true }))) return;
      busy(e.target, async () => {
        await api.post(`/admin/drivers/${d.user_id}/status`, { status, reason: reason.value });
        toast('وضعیت به‌روزرسانی شد', 'success');
        close();
        refreshCounts();
        reload().catch(toastError);
      });
    };
    const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v));
    return h('div', {},
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, d.name), statusBadge(d.status, DRIVER_STATUS)),
      h('div', { class: 'card mt' },
        kv('موبایل', fa.faDigits(d.phone)), kv('کد ملی', fa.faDigits(d.national_id)), kv('گواهینامه', fa.faDigits(d.license_no)),
        kv('وسیله', `${fa.VEHICLE_FA[d.vehicle_type]} ${d.vehicle_model} ${d.vehicle_color} — ${fa.faDigits(d.vehicle_year)}`),
        kv('پلاک', plateEl(d.plate)), kv('شبا', d.sheba || '—'), kv('امتیاز', `${fa.num(d.rating, 2)} (${fa.num(d.rating_count)})`),
        kv('نرخ پذیرش', `${fa.num(d.acceptance_rate)}٪`), kv('کیف پول', fa.toman(d.wallet)),
        d.status_reason ? kv('توضیح', d.status_reason) : null),
      h('h3', { class: 'mt' }, 'مدارک'), docs,
      h('div', { class: 'field mt' }, reason),
      h('div', { class: 'row wrap' },
        d.status !== 'approved' ? h('button', { class: 'btn btn-accent grow', onclick: setStatus('approved') }, 'تأیید و فعال‌سازی') : null,
        d.status === 'pending' ? h('button', { class: 'btn btn-danger-soft grow', onclick: setStatus('rejected') }, 'رد درخواست') : null,
        d.status === 'approved' ? h('button', { class: 'btn btn-danger-soft grow', onclick: setStatus('suspended') }, 'تعلیق') : null),
      h('button', { class: 'btn btn-ghost btn-block mt', onclick: close }, 'بستن'));
  });
}

// ---------------------------------------------------------------------------

async function users(q = '') {
  const { users: list } = await api.get(`/admin/users?q=${encodeURIComponent(q)}`);
  const search = h('input', { class: 'input', placeholder: 'جستجوی نام یا موبایل', value: q, onkeydown: (e) => { if (e.key === 'Enter') users(search.value).catch(toastError); } });
  mount(S.main,
    h('h1', {}, 'کاربران'),
    h('div', { class: 'toolbar' }, search),
    table(['#', 'نام', 'موبایل', 'سفرها', 'امتیاز', 'کیف پول', 'عضویت', 'وضعیت', ''],
      list.map((u) => h('tr', {},
        h('td', {}, fa.num(u.id)), h('td', { class: 'bold' }, u.name || '—', u.is_admin ? h('span', { class: 'badge blue', style: { marginInlineStart: '6px' } }, 'مدیر') : null),
        h('td', { class: 'ltr' }, fa.faDigits(u.phone)), h('td', {}, fa.num(u.trips)), h('td', {}, fa.num(u.rating, 2)),
        h('td', {}, fa.toman(u.wallet)), h('td', {}, fa.jDateShort(u.created_at)),
        h('td', {}, u.blocked ? h('span', { class: 'badge red' }, 'مسدود') : h('span', { class: 'badge green' }, 'فعال')),
        h('td', {},
          h('button', { class: 'btn btn-sm', onclick: () => adjustWallet(u, () => users(q)) }, 'کیف پول'),
          ' ',
          u.is_admin ? null : h('button', {
            class: `btn btn-sm ${u.blocked ? '' : 'btn-danger-soft'}`,
            onclick: async () => {
              if (!(await confirmDialog(u.blocked ? 'رفع مسدودیت' : 'مسدودسازی کاربر', u.name || u.phone, { danger: !u.blocked }))) return;
              await api.post(`/admin/users/${u.id}/block`, { blocked: !u.blocked });
              users(q).catch(toastError);
            },
          }, u.blocked ? 'رفع مسدودیت' : 'مسدود'))))));
}

function adjustWallet(u, reload) {
  modal((close) => {
    const amount = h('input', { class: 'input ltr-input', placeholder: 'مثلاً 50000 یا -20000' });
    const desc = h('input', { class: 'input', placeholder: 'توضیح (مثلاً جبران خسارت)' });
    const btn = h('button', { class: 'btn btn-primary btn-lg btn-block' }, 'ثبت');
    btn.onclick = () => busy(btn, async () => {
      await api.post(`/admin/users/${u.id}/wallet`, { amount: fa.enDigits(amount.value), description: desc.value });
      toast('ثبت شد', 'success');
      close();
      reload().catch(toastError);
    });
    return h('div', {}, h('h3', {}, `اصلاح موجودی ${u.name || u.phone}`), h('p', { class: 'muted small' }, `موجودی فعلی: ${fa.toman(u.wallet)}`),
      h('div', { class: 'field' }, h('label', {}, 'مبلغ (تومان، منفی برای کسر)'), amount), h('div', { class: 'field' }, desc), btn);
  });
}

// ---------------------------------------------------------------------------

async function rides(filter = '') {
  const { rides: list } = await api.get(`/admin/rides?status=${filter}`);
  mount(S.main,
    h('h1', {}, 'سفرها'),
    h('div', { class: 'toolbar' }, h('div', { class: 'tabs' }, [['', 'همه'], ['searching', 'در جستجو'], ['in_progress', 'در حال سفر'], ['completed', 'انجام‌شده'], ['cancelled', 'لغو'], ['no_driver', 'بدون راننده'], ['scheduled', 'رزرو']].map(([k, l]) =>
      h('button', { class: filter === k ? 'active' : '', onclick: () => rides(k).catch(toastError) }, l)))),
    table(['#', 'زمان', 'سرویس', 'مسافر', 'راننده', 'مسیر', 'مسافت', 'کرایه', 'پرداخت', 'وضعیت'],
      list.map((r) => h('tr', { class: 'clickable', onclick: () => rideDetail(r.id) },
        h('td', {}, fa.num(r.id)), h('td', {}, fa.jDateTime(r.created_at)), h('td', {}, r.type_name),
        h('td', {}, r.rider.name || fa.faDigits(r.rider.phone)), h('td', {}, r.driver?.name || '—'),
        h('td', { style: { maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' } }, `${(r.pickup.address || '').split('،')[0]} ← ${(r.dropoff.address || '').split('،')[0]}`),
        h('td', {}, fa.km(r.distance_km)), h('td', {}, fa.toman(r.fare_final ?? r.fare_estimate)),
        h('td', {}, r.payment_method === 'wallet' ? 'کیف پول' : 'نقدی'), h('td', {}, statusBadge(r.status))))));
}

async function rideDetail(id) {
  const { ride: r, messages } = await api.get(`/admin/rides/${id}`).catch((e) => { toastError(e); return {}; });
  if (!r) return;
  modal((close) => {
    const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v ?? '—'));
    const cancel = ['searching', 'accepted', 'arrived', 'in_progress', 'scheduled', 'no_driver'].includes(r.status)
      ? h('button', { class: 'btn btn-danger-soft btn-block mt' }, 'لغو سفر (بدون هزینه برای مسافر)') : null;
    if (cancel) {
      cancel.onclick = async () => {
        if (!(await confirmDialog('لغو سفر', `سفر #${fa.num(r.id)} لغو شود؟`, { danger: true }))) return;
        busy(cancel, async () => { await api.post(`/admin/rides/${r.id}/cancel`); toast('سفر لغو شد'); close(); });
      };
    }
    return h('div', {},
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, `سفر #${fa.num(r.id)} — ${r.type_name}`), statusBadge(r.status)),
      h('div', { class: 'card mt' },
        kv('مسافر', `${r.rider.name || ''} ${fa.faDigits(r.rider.phone)}`),
        kv('راننده', r.driver ? `${r.driver.name} ${fa.faDigits(r.driver.phone)}` : null),
        kv('مبدأ', r.pickup.address), kv('مقصد', r.dropoff.address),
        kv('مسافت / زمان', `${fa.km(r.distance_km)} / ${fa.minutes(r.duration_min)}`),
        kv('ضریب تقاضا', `×${fa.num(r.surge)}`),
        kv('کرایه برآوردی', fa.toman(r.fare_estimate)), r.fare_final != null ? kv('کرایه نهایی', fa.toman(r.fare_final)) : null,
        r.discount ? kv('تخفیف', `${fa.toman(r.discount)} (${r.promo_code})`) : null,
        r.commission != null ? kv('کمیسیون', fa.toman(r.commission)) : null,
        kv('نقد / کیف پول', `${fa.toman(r.paid_cash)} / ${fa.toman(r.paid_wallet)}`),
        r.tip ? kv('انعام', fa.toman(r.tip)) : null,
        kv('امتیاز مسافر به راننده', r.rating_by_rider ? fa.num(r.rating_by_rider) : null),
        r.cancel_reason ? kv('دلیل لغو', `${r.cancel_reason} (${r.cancelled_by})`) : null,
        kv('رد شده توسط', r.declined.length ? `${fa.num(r.declined.length)} راننده` : null),
        kv('ثبت', fa.jDateTime(r.created_at))),
      messages.length ? [h('h3', { class: 'mt' }, 'گفتگو'), h('div', { class: 'card' }, messages.map((m) => h('div', { class: 'small', style: { padding: '4px 0' } },
        h('b', {}, m.sender_id === r.rider.id ? 'مسافر: ' : 'راننده: '), m.text, h('span', { class: 'tiny muted' }, ` — ${fa.jTime(m.created_at)}`))))] : null,
      cancel,
      h('button', { class: 'btn btn-ghost btn-block mt', onclick: close }, 'بستن'));
  });
}

// ---------------------------------------------------------------------------

async function pricing() {
  const { ride_types: types } = await api.get('/admin/ride-types');
  const fields = [['base_fare', 'ورودی'], ['per_km', 'هر کیلومتر'], ['per_min', 'هر دقیقه'], ['min_fare', 'حداقل کرایه'], ['wait_per_min', 'توقف/دقیقه'], ['commission_pct', 'کمیسیون ٪']];
  // Same formula as the server (pricing.fareFor), for the live example.
  const fareOf = (v, km, min) => Math.ceil(Math.max(v.min_fare, v.base_fare + v.per_km * km + v.per_min * min) / 1000) * 1000;
  mount(S.main,
    h('h1', {}, 'سرویس‌ها و تعرفه‌ها'),
    h('p', { class: 'muted' }, 'همه مبالغ به تومان است. کرایه = max(حداقل، ورودی + مسافت × نرخ کیلومتر + زمان × نرخ دقیقه) × ضریب تقاضا، گرد به هزار تومان. سرویس غیرفعال در اپ مسافر و ثبت‌نام راننده نمایش داده نمی‌شود.'),
    h('div', { class: 'grid-cards' }, types.map((t) => {
      const v = { ...t };
      const sample = h('div', { class: 'small' });
      const drawSample = () => {
        const short = fareOf(v, 5, 15), long = fareOf(v, 15, 40);
        const cut = (f) => Math.round((f * v.commission_pct) / 100);
        mount(sample,
          h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'سفر ۵ کیلومتر / ۱۵ دقیقه'), h('span', { class: 'bold' }, fa.toman(short))),
          h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'سفر ۱۵ کیلومتر / ۴۰ دقیقه'), h('span', { class: 'bold' }, fa.toman(long))),
          h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'سهم نِنا / راننده (سفر کوتاه)'), h('span', {}, `${fa.toman(cut(short))} / ${fa.toman(short - cut(short))}`)));
      };
      const inputs = Object.fromEntries(fields.map(([k]) => [k, h('input', {
        class: 'input num-input', value: t[k],
        oninput: (e) => { v[k] = Number(fa.enDigits(e.target.value)) || 0; drawSample(); },
      })]));
      const name = h('input', { class: 'input', value: t.name });
      const desc = h('input', { class: 'input', value: t.description || '' });
      const active = h('input', { type: 'checkbox', checked: !!t.active });
      const save = h('button', { class: 'btn btn-primary btn-block mt' }, 'ذخیره');
      save.onclick = () => busy(save, async () => {
        const body = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, fa.enDigits(el.value)]));
        await api.put(`/admin/ride-types/${t.key}`, { ...body, name: name.value, description: desc.value, active: active.checked });
        toast(`تعرفه ${name.value} ذخیره شد`, 'success');
      });
      drawSample();
      return h('div', { class: 'card', style: { opacity: t.active ? 1 : 0.75 } },
        h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, t.name),
          h('label', { class: 'row gap-sm small' }, h('label', { class: 'switch' }, active, h('span')), 'فعال')),
        h('div', { class: 'row mt' }, h('div', { class: 'field grow' }, h('label', {}, 'نام نمایشی'), name)),
        h('div', { class: 'field' }, h('label', {}, 'توضیح کوتاه'), desc),
        h('div', { class: 'grid-cards', style: { gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' } },
          fields.map(([k, l]) => h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', {}, l), inputs[k]))),
        h('div', { class: 'card mt', style: { background: 'var(--soft)', boxShadow: 'none' } }, h('div', { class: 'small bold mb' }, 'نمونه کرایه (بدون ضریب)'), sample),
        save);
    })));
}

const PLACE_CATS = ['square', 'metro', 'neighbourhood', 'mall', 'hospital', 'university', 'transport', 'landmark', 'street', 'other'];
const SOURCE_FA = { seed: 'پایه', admin: 'مدیر', osm: 'یادگیری از جستجو' };

async function places(category = '', q = '') {
  const { places: list } = await api.get(`/admin/places?category=${category}&q=${encodeURIComponent(q)}`);
  const search = h('input', { class: 'input', placeholder: 'جستجوی نام، نام دیگر یا آدرس', value: q, onkeydown: (e) => { if (e.key === 'Enter') places(category, search.value).catch(toastError); } });
  const cat = h('select', { class: 'input', style: { minWidth: '160px' }, onchange: (e) => places(e.target.value, search.value).catch(toastError) },
    h('option', { value: '' }, 'همه دسته‌ها'), PLACE_CATS.map((c) => h('option', { value: c, selected: c === category }, categoryLabel(c))));
  const reload = () => places(category, search.value);
  mount(S.main,
    h('h1', {}, 'مکان‌ها و آدرس‌ها'),
    h('p', { class: 'muted' }, 'این مکان‌ها در جستجوی مسافران فوراً و با اولویت نمایش داده می‌شوند. مکان‌هایی که مسافران از نتایج OpenStreetMap انتخاب می‌کنند خودکار اضافه می‌شوند و پرانتخاب‌ترها بالاتر قرار می‌گیرند.'),
    h('div', { class: 'toolbar' }, search, cat, h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary', onclick: () => placeEditor(null, reload) }, icon('plus'), 'افزودن مکان')),
    table(['نام', 'نام‌های دیگر', 'دسته', 'آدرس', 'انتخاب', 'منبع', 'فعال', ''], list.map((p) => h('tr', {},
      h('td', { class: 'bold' }, p.name), h('td', { class: 'small muted' }, p.aliases.join('، ') || '—'),
      h('td', {}, categoryLabel(p.category)),
      h('td', { class: 'small', style: { maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.address || '—'),
      h('td', {}, fa.num(p.popularity)), h('td', {}, h('span', { class: 'badge' }, SOURCE_FA[p.source] || p.source)),
      h('td', {}, h('input', { type: 'checkbox', checked: p.active, onchange: (e) => api.put(`/admin/places/${p.id}`, { ...p, aliases: p.aliases.join('،'), active: e.target.checked }).then(() => toast('ذخیره شد')).catch(toastError) })),
      h('td', {},
        h('button', { class: 'btn btn-sm', onclick: () => placeEditor(p, reload) }, 'ویرایش'), ' ',
        h('button', { class: 'btn btn-sm btn-danger-soft', onclick: async () => { if (await confirmDialog('حذف مکان', p.name, { danger: true })) { await api.del(`/admin/places/${p.id}`); reload().catch(toastError); } } }, 'حذف'))))),
    h('p', { class: 'tiny muted mt' }, `${fa.num(list.length)} مکان نمایش داده شد`));
}

function placeEditor(p, reload) {
  const f = p ? { ...p, aliases: p.aliases.join('، ') } : { name: '', aliases: '', category: 'landmark', address: '', lat: S.cfg.map.center[0], lng: S.cfg.map.center[1] };
  modal((close) => {
    const inp = (k, ph) => h('input', { class: 'input', placeholder: ph, value: f[k] || '', oninput: (e) => { f[k] = e.target.value; } });
    const coords = h('div', { class: 'tiny muted ltr' });
    const showCoords = () => { coords.textContent = `${f.lat.toFixed(6)}, ${f.lng.toFixed(6)}`; };
    const mapEl = h('div', { style: { height: '260px', borderRadius: '12px', overflow: 'hidden' } });
    const save = h('button', { class: 'btn btn-primary btn-lg btn-block mt' }, 'ذخیره');
    save.onclick = () => busy(save, async () => {
      await (p ? api.put(`/admin/places/${p.id}`, f) : api.post('/admin/places', f));
      toast('مکان ذخیره شد', 'success');
      close();
      reload().catch(toastError);
    });
    setTimeout(() => {
      const map = createMap(mapEl, { map: { ...S.cfg.map, center: [f.lat, f.lng], zoom: p ? 16 : 12 } });
      const marker = L.marker([f.lat, f.lng], { draggable: true }).addTo(map);
      const set = (ll) => { f.lat = ll.lat; f.lng = ll.lng; marker.setLatLng(ll); showCoords(); };
      marker.on('dragend', () => set(marker.getLatLng()));
      map.on('click', (e) => set(e.latlng));
      showCoords();
    }, 50);
    return h('div', {},
      h('h3', {}, p ? 'ویرایش مکان' : 'افزودن مکان'),
      h('div', { class: 'field' }, h('label', {}, 'نام'), inp('name', 'مثلاً مجتمع تجاری کوروش')),
      h('div', { class: 'field' }, h('label', {}, 'نام‌های دیگر (با ویرگول جدا کنید)'), inp('aliases', 'مثلاً کورش، پاساژ کوروش')),
      h('div', { class: 'field' }, h('label', {}, 'دسته'), h('select', { class: 'input', onchange: (e) => { f.category = e.target.value; } },
        PLACE_CATS.map((c) => h('option', { value: c, selected: c === f.category }, categoryLabel(c))))),
      h('div', { class: 'field' }, h('label', {}, 'آدرس'), inp('address', 'محله، خیابان، منطقه')),
      h('div', { class: 'field' }, h('label', {}, 'موقعیت (روی نقشه کلیک کنید یا نشانگر را بکشید)'), mapEl, coords),
      save,
      h('button', { class: 'btn btn-ghost btn-block mt', onclick: close }, 'انصراف'));
  });
}

async function promos() {
  const { promos: list } = await api.get('/admin/promos');
  const f = { code: '', description: '', kind: 'percent', value: '', max_discount: '', min_fare: '', usage_limit: '', per_user_limit: '1', days: '30' };
  const inp = (k, ph, attrs = {}) => h('input', { class: 'input', placeholder: ph, value: f[k], oninput: (e) => { f[k] = fa.enDigits(e.target.value); }, ...attrs });
  const create = h('button', { class: 'btn btn-primary' }, 'ایجاد کد');
  create.onclick = () => busy(create, async () => {
    await api.post('/admin/promos', { ...f, expires_at: f.days ? Date.now() + Number(f.days) * 86400000 : '' });
    toast('کد تخفیف ایجاد شد', 'success');
    promos().catch(toastError);
  });
  mount(S.main,
    h('h1', {}, 'کدهای تخفیف'),
    h('div', { class: 'card mb' },
      h('div', { class: 'row wrap' },
        inp('code', 'کد (لاتین)', { class: 'input ltr-input', style: { maxWidth: '150px' } }),
        h('select', { class: 'input', style: { maxWidth: '120px' }, onchange: (e) => { f.kind = e.target.value; } }, h('option', { value: 'percent' }, 'درصدی'), h('option', { value: 'fixed' }, 'مبلغ ثابت')),
        inp('value', 'مقدار', { style: { maxWidth: '100px' } }),
        inp('max_discount', 'سقف تخفیف', { style: { maxWidth: '120px' } }),
        inp('min_fare', 'حداقل کرایه', { style: { maxWidth: '120px' } }),
        inp('usage_limit', 'ظرفیت کل', { style: { maxWidth: '100px' } }),
        inp('per_user_limit', 'هر کاربر', { style: { maxWidth: '90px' } }),
        inp('days', 'اعتبار (روز)', { style: { maxWidth: '100px' } })),
      h('div', { class: 'row mt' }, h('div', { class: 'grow' }, inp('description', 'توضیح برای کاربر')), create)),
    table(['کد', 'توضیح', 'نوع', 'مقدار', 'سقف', 'استفاده', 'انقضا', 'فعال'], list.map((p) => h('tr', {},
      h('td', { class: 'bold ltr' }, p.code), h('td', {}, p.description || '—'), h('td', {}, p.kind === 'percent' ? 'درصدی' : 'ثابت'),
      h('td', {}, p.kind === 'percent' ? `${fa.num(p.value)}٪` : fa.toman(p.value)), h('td', {}, p.max_discount ? fa.toman(p.max_discount) : '—'),
      h('td', {}, `${fa.num(p.used_count)}${p.usage_limit ? ` / ${fa.num(p.usage_limit)}` : ''}`),
      h('td', {}, p.expires_at ? fa.jDateShort(p.expires_at) : 'نامحدود'),
      h('td', {}, h('input', { type: 'checkbox', checked: !!p.active, onchange: (e) => api.post(`/admin/promos/${p.code}/active`, { active: e.target.checked }).then(() => toast('ذخیره شد')).catch(toastError) }))))));
}

async function sos() {
  const { alerts } = await api.get('/admin/sos');
  mount(S.main,
    h('h1', {}, 'هشدارهای ایمنی'),
    table(['زمان', 'کاربر', 'موبایل', 'سفر', 'موقعیت', 'وضعیت', ''], alerts.map((a) => h('tr', {},
      h('td', {}, fa.jDateTime(a.created_at)), h('td', { class: 'bold' }, a.name || '—'), h('td', {}, h('a', { href: `tel:${a.phone}`, class: 'ltr' }, fa.faDigits(a.phone))),
      h('td', {}, h('button', { class: 'btn btn-sm', onclick: () => rideDetail(a.ride_id) }, `#${fa.num(a.ride_id)}`)),
      h('td', {}, a.lat ? h('a', { href: `https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=17/${a.lat}/${a.lng}`, target: '_blank' }, 'نقشه') : '—'),
      h('td', {}, a.resolved ? h('span', { class: 'badge green' }, 'رسیدگی شد') : h('span', { class: 'badge red' }, 'باز')),
      h('td', {}, a.resolved ? null : h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { await api.post(`/admin/sos/${a.id}/resolve`); refreshCounts(); sos().catch(toastError); } }, 'رسیدگی شد'))))));
}

async function payouts() {
  const { payouts: list } = await api.get('/admin/payouts');
  const act = (p, status) => async (e) => {
    if (!(await confirmDialog(status === 'paid' ? 'تأیید واریز' : 'رد درخواست', `${p.name} — ${fa.toman(p.amount)}`, { danger: status !== 'paid' }))) return;
    busy(e.target, async () => { await api.post(`/admin/payouts/${p.id}`, { status }); refreshCounts(); payouts().catch(toastError); });
  };
  mount(S.main,
    h('h1', {}, 'تسویه رانندگان'),
    table(['زمان', 'راننده', 'موبایل', 'مبلغ', 'شبا', 'وضعیت', ''], list.map((p) => h('tr', {},
      h('td', {}, fa.jDateTime(p.created_at)), h('td', { class: 'bold' }, p.name), h('td', { class: 'ltr' }, fa.faDigits(p.phone)),
      h('td', {}, fa.toman(p.amount)), h('td', { class: 'ltr small' }, p.sheba),
      h('td', {}, statusBadge(p.status, { pending: 'در انتظار', paid: 'واریز شد', rejected: 'رد شد' })),
      h('td', {}, p.status === 'pending' ? [h('button', { class: 'btn btn-sm btn-accent', onclick: act(p, 'paid') }, 'واریز شد'), ' ', h('button', { class: 'btn btn-sm btn-danger-soft', onclick: act(p, 'rejected') }, 'رد')] : null)))));
}

// Operating rules grouped by theme. Surge settings live on the surge page.
const SETTING_GROUPS = [
  ['لغو و انتظار', [
    ['cancel_fee', 'هزینه لغو', 'تومان؛ پس از مهلت رایگان یا رسیدن راننده از مسافر دریافت و به راننده داده می‌شود'],
    ['free_cancel_seconds', 'مهلت لغو رایگان پس از پذیرش', 'ثانیه'],
    ['free_wait_minutes', 'انتظار رایگان در مبدأ', 'دقیقه؛ پس از آن هزینه توقف هر سرویس محاسبه می‌شود'],
    ['no_show_wait_minutes', 'انتظار لازم برای «مسافر نیامد»', 'دقیقه'],
  ]],
  ['تخصیص سفر', [
    ['offer_timeout_seconds', 'مهلت پاسخ راننده', 'ثانیه؛ پس از آن درخواست به راننده بعدی می‌رود'],
    ['search_radius_km', 'شعاع جستجوی راننده', 'کیلومتر'],
    ['max_search_seconds', 'حداکثر زمان جستجو', 'ثانیه؛ پس از آن «راننده‌ای یافت نشد»'],
  ]],
  ['ایمنی', [
    ['require_pin', 'الزام کد ۴ رقمی برای شروع سفر', 'راننده فقط با کد مسافر سفر را شروع می‌کند'],
    ['support_phone', 'شماره پشتیبانی', 'در اپ مسافر و راننده نمایش داده می‌شود'],
  ]],
  ['مالی و بازاریابی', [
    ['referral_bonus', 'هدیه دعوت از دوستان', 'تومان برای هر دو نفر پس از اولین سفر'],
    ['min_payout', 'حداقل مبلغ تسویه رانندگان', 'تومان'],
  ]],
];

async function settings() {
  const { settings: s } = await api.get('/admin/settings');
  const inputs = {};
  const control = (k) => {
    const v = s[k];
    const el = typeof v === 'boolean'
      ? h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: v }), h('span'))
      : h('input', { class: 'input num-input', style: { width: '160px' }, value: v });
    inputs[k] = el;
    return el;
  };
  const save = h('button', { class: 'btn btn-primary btn-lg mt' }, 'ذخیره تنظیمات');
  save.onclick = () => busy(save, async () => {
    const body = {};
    for (const [k, el] of Object.entries(inputs)) body[k] = typeof s[k] === 'boolean' ? el.querySelector('input').checked : fa.enDigits(el.value);
    await api.put('/admin/settings', body);
    toast('تنظیمات ذخیره شد', 'success');
  });
  mount(S.main,
    h('h1', {}, 'تنظیمات'),
    h('p', { class: 'muted small' }, 'کمیسیون و کرایه هر سرویس در «سرویس‌ها و تعرفه‌ها» و ضرایب در «افزایش قیمت» تنظیم می‌شوند.'),
    h('div', { class: 'grid-cards' }, SETTING_GROUPS.map(([title, rows]) => h('div', { class: 'card' },
      h('h3', {}, title),
      rows.map(([k, label, hint]) => h('div', { class: 'setting-row' }, h('div', {}, h('div', { class: 'bold' }, label), h('span', { class: 'hint' }, hint)), control(k)))))),
    save);
}

boot().catch(toastError);
