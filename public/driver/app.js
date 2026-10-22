import { createApi } from '/shared/api.js';
import {
  h, mount, icon, toast, toastError, modal, confirmDialog, busy, ratingPill, starInput, avatar, listItem, trackSheetHeight, beep, notify,
} from '/shared/ui.js';
import { createMap, carIcon, setHeading, pinIcon, animateTo, routeLayer, fitTo, bearing, moveTo } from '/shared/map.js';
import { renderLogin } from '/shared/login.js';
import { openChat } from '/shared/chat.js';
import { openSafety } from '/shared/safety.js';
import * as fa from '/shared/fa.js';
import { openMenu, openRegistration, openEarnings } from './pages.js';

const L = window.L;
const api = createApi('driver');
const root = document.getElementById('root');

export const S = {
  cfg: null, user: null, driver: null, map: null, socket: null,
  pos: null, manualPos: false, ride: null, offer: null, view: null, today: null, demandOn: false, unread: 0,
};
const layers = { me: null, route: null, markers: null, demand: null };
let sheet, offerEl, offerTimer, waitTimer;

const DRIVER_REPLIES = ['در راه هستم', 'رسیدم، جلوی در هستم', 'در ترافیک هستم، چند دقیقه دیگر می‌رسم', 'لطفاً لوکیشن دقیق بفرستید', 'باشه'];

// ---------------------------------------------------------------------------
// boot

async function boot() {
  S.cfg = await api.get('/config');
  if (!api.token) return showLogin();
  await start();
}

function showLogin() {
  mount(root, h('div', { class: 'center-page' }, h('div', { id: 'login', class: 'auth' })));
  renderLogin(root.querySelector('#login'), api, {
    title: 'نِنا برای رانندگان',
    subtitle: 'هر زمان که بخواهید کار کنید و درآمد داشته باشید.',
    onDone: () => start(),
    footer: h('p', { class: 'center small mt' }, h('a', { href: '/rider/' }, 'ورود به اپ مسافر ←')),
  });
}

export async function start() {
  const me = await api.get('/me');
  S.user = me.user;
  S.driver = me.driver;
  if (!S.driver || S.driver.status === 'rejected') return openRegistration(ctx);
  if (S.driver.status === 'pending') return showPending();
  if (S.driver.status === 'suspended') return showSuspended();

  buildShell();
  connectSocket();
  startGps();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const params = new URLSearchParams(location.search);
  if (params.has('topup')) {
    toast(params.get('topup') === 'ok' ? 'پرداخت با موفقیت انجام شد' : 'پرداخت ناموفق بود', params.get('topup') === 'ok' ? 'success' : 'error');
    history.replaceState(null, '', location.pathname);
  }
  await sync();
}

export function showPending() {
  const docs = S.driver.documents || {};
  const missing = ['license', 'national_card', 'vehicle_card', 'insurance', 'photo'].filter((k) => !docs[k]);
  mount(root, h('div', { class: 'center-page' }, h('div', { class: 'auth card center' },
    h('div', { class: 'logo' }, 'نِنا'),
    icon('clock'),
    h('h2', { class: 'mt' }, 'درخواست شما در حال بررسی است'),
    h('p', { class: 'muted' }, 'پس از بررسی مدارک توسط تیم نِنا، حساب شما فعال می‌شود و پیامک دریافت می‌کنید.'),
    missing.length ? h('p', { class: 'badge yellow' }, `${fa.num(missing.length)} مدرک هنوز بارگذاری نشده`) : h('p', { class: 'badge green' }, 'همه مدارک بارگذاری شده است'),
    h('div', { class: 'col mt' },
      h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => openRegistration(ctx, { step: 3 }) }, icon('upload'), 'مدارک'),
      h('button', { class: 'btn btn-lg btn-block', onclick: () => openRegistration(ctx) }, icon('edit'), 'ویرایش اطلاعات'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => start().catch(toastError) }, 'بررسی دوباره وضعیت'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: logout }, 'خروج')))));
  connectSocket();
}

function showSuspended() {
  mount(root, h('div', { class: 'center-page' }, h('div', { class: 'auth card center' },
    h('div', { class: 'logo' }, 'نِنا'),
    h('h2', {}, 'حساب شما تعلیق شده است'),
    h('p', { class: 'muted' }, S.driver.status_reason || 'برای اطلاعات بیشتر با پشتیبانی رانندگان تماس بگیرید.'),
    h('a', { class: 'btn btn-primary btn-lg btn-block mt', href: `tel:${S.cfg.support_phone}` }, 'تماس با پشتیبانی'),
    h('button', { class: 'btn btn-ghost btn-block mt', onclick: logout }, 'خروج'))));
}

export async function logout() {
  if (S.driver?.online) await api.post('/driver/online', { online: false }).catch(() => {});
  api.setToken(null);
  location.reload();
}

function buildShell() {
  sheet = h('section', { class: 'sheet', id: 'sheet' });
  const menuBtn = h('button', { class: 'btn btn-icon', 'aria-label': 'منو', onclick: () => openMenu(ctx) }, icon('menu'));
  const earn = h('button', { class: 'earn-pill', id: 'earnPill', onclick: () => openEarnings(ctx) }, h('small', {}, 'درآمد امروز'), '...');
  const demandBtn = h('button', { class: 'btn btn-icon', 'aria-label': 'نقشه تقاضا', onclick: toggleDemand }, icon('fire'));
  mount(root, h('div', { class: 'app' },
    h('div', { id: 'map', class: 'map' }),
    h('div', { class: 'topbar' }, menuBtn, h('div', { class: 'spacer' }), earn, h('div', { class: 'spacer' }), demandBtn),
    h('div', { class: 'map-fabs' }, h('button', { class: 'btn btn-icon', 'aria-label': 'موقعیت من', onclick: () => S.pos && moveTo(S.map, S.pos, 16) }, icon('locate'))),
    sheet));
  trackSheetHeight(sheet);
  S.map = createMap(document.getElementById('map'), S.cfg);
  layers.markers = L.layerGroup().addTo(S.map);
  layers.demand = L.layerGroup().addTo(S.map);
  refreshToday();
  setInterval(() => { if (S.demandOn) drawDemand(); }, 30000);
}

export async function refreshToday() {
  try {
    S.today = await api.get('/driver/earnings?range=today');
    const pill = document.getElementById('earnPill');
    if (pill) mount(pill, h('small', {}, 'درآمد امروز'), fa.toman(S.today.total));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// GPS

function startGps() {
  const [lat, lng] = S.cfg.map.center;
  setPos(S.driver.lat != null ? { lat: S.driver.lat, lng: S.driver.lng } : { lat, lng }, { send: false });
  if (S.driver.lat == null) S.map.setView([lat, lng], 15);
  else S.map.setView([S.driver.lat, S.driver.lng], 15);

  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      (p) => {
        if (S.manualPos) return;
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading });
      },
      () => enableManualPosition(),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  } else {
    enableManualPosition();
  }
  // Heartbeat keeps the driver marked as available even when stationary.
  setInterval(() => { if (S.driver.online && S.pos) sendPos(); }, 20000);
}

// Without GPS (e.g. on a desktop) the driver can drag their marker.
function enableManualPosition() {
  if (S.manualPos) return;
  S.manualPos = true;
  layers.me.dragging?.enable();
  toast('موقعیت GPS در دسترس نیست؛ می‌توانید خودرو را روی نقشه جابجا کنید');
}

let lastSent = 0;
function setPos(pos, { send = true } = {}) {
  const prev = S.pos;
  const heading = pos.heading ?? (prev && (prev.lat !== pos.lat || prev.lng !== pos.lng) ? bearing(prev, pos) : prev?.heading ?? 0);
  S.pos = { lat: pos.lat, lng: pos.lng, heading };
  if (!layers.me) {
    layers.me = L.marker(S.pos, { icon: carIcon(S.driver.vehicle_type, heading), draggable: true, zIndexOffset: 1000 }).addTo(S.map);
    layers.me.dragging.disable();
    layers.me.on('dragend', () => {
      const ll = layers.me.getLatLng();
      setPos({ lat: ll.lat, lng: ll.lng });
    });
  } else {
    if (!S.manualPos) animateTo(layers.me, S.pos, 900);
    setHeading(layers.me, heading);
  }
  if (send && Date.now() - lastSent > 2500) sendPos();
}

function sendPos() {
  lastSent = Date.now();
  S.socket?.emit('driver:location', S.pos);
}

// ---------------------------------------------------------------------------
// realtime

function connectSocket() {
  if (S.socket) return;
  S.socket = api.connect();
  S.socket.on('connect', () => { if (S.view) sync().catch(() => {}); });
  S.socket.on('ride:offer', (offer) => showOffer(offer));
  S.socket.on('ride:offer_cancel', ({ ride_id }) => { if (S.offer?.ride.id === ride_id) closeOffer(); });
  S.socket.on('ride:update', (ride) => {
    if (ride.status === 'cancelled' && (!S.ride || S.ride.id === ride.id)) {
      if (S.ride) {
        const why = ride.cancelled_by === 'rider' ? 'مسافر سفر را لغو کرد' : ride.cancelled_by === 'admin' ? 'سفر توسط پشتیبانی لغو شد' : 'سفر لغو شد';
        toast(ride.cancel_fee && ride.cancelled_by === 'rider' ? `${why}؛ ${fa.toman(ride.cancel_fee)} به کیف پول شما اضافه شد` : why);
        notify('نِنا', why);
      }
      S.ride = null;
      refreshToday();
      return showIdle();
    }
    if (S.ride && ride.id !== S.ride.id) return;
    setRide(ride);
  });
  S.socket.on('chat:message', (m) => {
    if (m.sender_id === S.user.id || document.querySelector('.chat')) return;
    S.unread++;
    toast(`پیام مسافر: ${m.text}`);
    notify('پیام مسافر', m.text);
    if (S.view === 'trip') renderTrip();
  });
  S.socket.on('notice', (n) => {
    toast(n.text);
    if (n.refresh) setTimeout(() => location.reload(), 1500);
  });
}

async function sync() {
  const [{ ride, pending_rating }, { offer }] = await Promise.all([api.get('/driver/rides/active'), api.get('/driver/offer')]);
  const me = await api.get('/me');
  S.driver = me.driver;
  S.user = me.user;
  if (ride) return setRide(ride);
  if (pending_rating) return showCompleted(pending_rating);
  showIdle();
  if (offer) showOffer(offer);
}

// ---------------------------------------------------------------------------
// idle / online

function clearTrip() {
  layers.route?.remove();
  layers.route = null;
  layers.markers.clearLayers();
}

export function showIdle() {
  S.view = 'idle';
  S.ride = null;
  clearInterval(waitTimer);
  clearTrip();
  const online = S.driver.online;
  const go = h('button', { class: `go-btn ${online ? 'stop' : ''}` }, online ? 'آفلاین' : 'شروع');
  go.onclick = () => busy(go, async () => {
    if (!online && !S.pos) throw new Error('موقعیت شما مشخص نیست');
    const { driver } = await api.post('/driver/online', { online: !online, ...(S.pos || {}) });
    S.driver = driver;
    toast(driver.online ? 'شما آنلاین هستید؛ منتظر درخواست باشید' : 'شما آفلاین شدید', driver.online ? 'success' : '');
    showIdle();
  });
  const t = S.today;
  mount(sheet,
    h('div', { class: 'row between' },
      h('div', { class: 'row gap-sm' }, h('span', { class: `online-dot ${online ? 'on' : ''}` }), h('span', { class: 'bold' }, online ? 'آنلاین' : 'آفلاین')),
      h('span', { class: 'muted small' }, `${fa.VEHICLE_FA[S.driver.vehicle_type]} • `, ratingPill(S.driver.rating))),
    h('div', { class: 'mt-lg' }, go),
    h('h3', { class: 'center mt-lg' }, online ? 'در حال یافتن سفر برای شما...' : 'برای دریافت سفر آنلاین شوید'),
    online ? h('div', { class: 'progress-bar mt' }, h('i')) : h('p', { class: 'muted small center' }, 'با زدن «شروع»، درخواست‌های اطراف برای شما ارسال می‌شود.'),
    h('div', { class: 'stats mt-lg' },
      h('div', { class: 'stat' }, h('div', { class: 's-label' }, 'سفرهای امروز'), h('div', { class: 's-value' }, fa.num(t?.trips || 0))),
      h('div', { class: 'stat' }, h('div', { class: 's-label' }, 'نرخ پذیرش'), h('div', { class: 's-value' }, `${fa.num(S.driver.acceptance_rate)}٪`))),
    S.manualPos ? h('p', { class: 'hint center mt' }, 'حالت دستی: خودروی خود را روی نقشه بکشید تا موقعیتتان تغییر کند.') : null);
  if (S.pos) moveTo(S.map, S.pos, Math.max(S.map.getZoom(), 14));
}

async function toggleDemand() {
  S.demandOn = !S.demandOn;
  if (S.demandOn) { await drawDemand(); toast('نقاط پرتقاضا روی نقشه نمایش داده شد'); } else layers.demand.clearLayers();
}

async function drawDemand() {
  try {
    const { points } = await api.get('/driver/demand');
    layers.demand.clearLayers();
    for (const p of points) {
      L.circle([p.lat, p.lng], { radius: 350, stroke: false, fillColor: p.status === 'no_driver' || p.status === 'searching' ? '#ff4d2e' : '#ffb020', fillOpacity: 0.28 }).addTo(layers.demand);
    }
  } catch (err) { toastError(err); }
}

// ---------------------------------------------------------------------------
// incoming offer

function closeOffer() {
  clearInterval(offerTimer);
  offerEl?.remove();
  offerEl = null;
  S.offer = null;
}

function showOffer(offer) {
  closeOffer();
  S.offer = offer;
  const r = offer.ride;
  beep();
  navigator.vibrate?.([300, 150, 300]);
  notify('درخواست سفر جدید', `${fa.toman(r.estimated_earning)} — ${r.pickup.address || ''}`);

  const total = offer.timeout_seconds;
  const C = 2 * Math.PI * 32;
  const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ringSvg.setAttribute('viewBox', '0 0 74 74');
  ringSvg.innerHTML = `<circle cx="37" cy="37" r="32" fill="none" stroke="var(--soft-2)" stroke-width="6"/><circle class="rp" cx="37" cy="37" r="32" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"/>`;
  const ringText = h('div', { class: 'ring-text' });
  const tick = () => {
    const left = Math.max(0, Math.ceil((offer.expires_at - Date.now()) / 1000));
    ringText.textContent = fa.num(left);
    ringSvg.querySelector('.rp').setAttribute('stroke-dashoffset', String(C * (1 - left / total)));
    if (left <= 0) closeOffer();
  };

  const accept = h('button', { class: 'btn btn-accent btn-lg btn-block accept-btn' }, 'قبول سفر');
  accept.onclick = () => busy(accept, async () => {
    try {
      const { ride } = await api.post(`/driver/offers/${r.id}/accept`);
      closeOffer();
      setRide(ride);
    } catch (err) {
      closeOffer();
      throw err;
    }
  });
  const decline = h('button', { class: 'btn btn-lg btn-block mt' }, 'رد کردن');
  decline.onclick = () => { api.post(`/driver/offers/${r.id}/decline`).catch(() => {}); closeOffer(); };

  offerEl = h('div', { class: 'offer' }, h('div', { class: 'offer-card' },
    h('div', { class: 'row between' },
      h('div', {},
        h('span', { class: 'badge blue' }, r.type_name),
        r.surge > 1 ? h('span', { class: 'badge yellow', style: { marginInlineStart: '6px' } }, `×${fa.num(r.surge)}`) : null,
        h('div', { class: 'offer-fare mt' }, fa.toman(r.estimated_earning)),
        h('div', { class: 'muted small' }, `کرایه ${fa.toman(r.fare_estimate)} • ${r.payment_method === 'wallet' ? 'کیف پول' : 'نقدی'}`)),
      h('div', { class: 'ring' }, ringSvg, ringText)),
    h('div', { class: 'row mt small' }, ratingPill(r.rider.rating), h('span', { class: 'muted' }, r.rider.name || 'مسافر')),
    h('div', { class: 'list mt' },
      listItem({ iconName: 'dot', title: r.pickup.address || 'مبدأ', sub: `${fa.minutes(offer.pickup_eta_min)} (${fa.km(offer.pickup_distance_km)}) تا مبدأ` }),
      ...r.stops.map((s, i) => listItem({ iconName: 'pin', title: s.address || '—', sub: `توقف ${fa.num(i + 1)}` })),
      listItem({ iconName: 'pin', title: r.dropoff.address || 'مقصد', sub: `سفر ${fa.km(r.distance_km)} • حدود ${fa.minutes(r.duration_min)}` })),
    r.notes ? h('div', { class: 'card small mt' }, icon('note'), ' ', r.notes) : null,
    r.is_delivery ? h('div', { class: 'badge yellow mt' }, 'ارسال مرسوله') : null,
    h('div', { class: 'mt' }, accept),
    decline));
  document.body.append(offerEl);
  tick();
  offerTimer = setInterval(tick, 250);

  drawRoute(r, true);
}

// ---------------------------------------------------------------------------
// active ride

function drawRoute(r, fit) {
  clearTrip();
  if (r.route?.length) layers.route = routeLayer(r.route).addTo(S.map);
  L.marker(r.pickup, { icon: pinIcon('o', 'مبدأ'), interactive: false }).addTo(layers.markers);
  r.stops.forEach((s, i) => L.marker(s, { icon: pinIcon('d', `توقف ${fa.num(i + 1)}`), interactive: false }).addTo(layers.markers));
  L.marker(r.dropoff, { icon: pinIcon('d', 'مقصد'), interactive: false }).addTo(layers.markers);
  if (fit) {
    const pts = r.status === 'in_progress' ? [S.pos, r.dropoff, ...r.stops] : [S.pos, r.pickup];
    if (r.status === 'searching') pts.push(r.dropoff);
    fitTo(S.map, pts, r.status === 'searching' ? null : sheet);
  }
}

export function setRide(ride) {
  S.ride = ride;
  if (ride.status === 'completed') return showCompleted(ride);
  if (['accepted', 'arrived', 'in_progress'].includes(ride.status)) {
    const changed = S.view !== 'trip' || S.lastStatus !== ride.status;
    S.view = 'trip';
    S.lastStatus = ride.status;
    drawRoute(ride, changed);
    return renderTrip();
  }
  showIdle();
}

const navLinks = (p) => [
  ['نشان / بلد (پیش‌فرض گوشی)', `geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}`],
  ['Google Maps', `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`],
  ['Waze', `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`],
];

function openNavigation(p) {
  modal((close) => h('div', {},
    h('h3', {}, 'مسیریابی با'),
    h('div', { class: 'col mt' }, navLinks(p).map(([name, href]) => h('a', { class: 'btn btn-lg btn-block', href, target: '_blank', rel: 'noopener', onclick: close }, icon('navigate'), name)))));
}

function renderTrip() {
  const r = S.ride;
  clearInterval(waitTimer);
  const target = r.status === 'in_progress' ? (r.stops[0] || r.dropoff) : r.pickup;
  const action = (ic, label, onclick, { href, danger, badge } = {}) => h(href ? 'a' : 'button', { class: `action ${danger ? 'danger' : ''}`, onclick, href },
    h('span', { class: 'a-ic', style: { position: 'relative' } }, icon(ic), badge ? h('span', { class: 'badge red', style: { position: 'absolute', top: '-4px', left: '-4px' } }, fa.num(badge)) : null), label);

  let title, sub, main;
  if (r.status === 'accepted') {
    title = 'به سمت مبدأ بروید';
    sub = r.pickup.address;
    main = h('button', { class: 'btn btn-primary btn-lg btn-block' }, 'به مبدأ رسیدم');
    main.onclick = () => busy(main, async () => setRide((await api.post(`/driver/rides/${r.id}/arrived`)).ride));
  } else if (r.status === 'arrived') {
    title = 'منتظر مسافر';
    sub = 'پس از سوار شدن مسافر، سفر را شروع کنید';
    main = h('div', {});
    const timer = h('div', { class: 'wait-timer' });
    const freeMs = r.free_wait_minutes * 60000;
    const tick = () => {
      const ms = Date.now() - r.arrived_at;
      const s = Math.floor(ms / 1000);
      timer.textContent = fa.faDigits(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
      timer.classList.toggle('charging', ms > freeMs);
    };
    tick();
    waitTimer = setInterval(tick, 1000);

    const pinBoxes = r.require_pin ? [0, 1, 2, 3].map(() => h('input', { inputmode: 'numeric', maxlength: 1 })) : [];
    pinBoxes.forEach((inp, i) => inp.addEventListener('input', () => { inp.value = fa.enDigits(inp.value).replace(/\D/g, ''); if (inp.value && pinBoxes[i + 1]) pinBoxes[i + 1].focus(); }));
    const startBtn = h('button', { class: 'btn btn-accent btn-lg btn-block mt' }, 'شروع سفر');
    startBtn.onclick = () => busy(startBtn, async () => {
      const pin = pinBoxes.map((b) => b.value).join('');
      if (r.require_pin && pin.length !== 4) throw new Error('کد ۴ رقمی سفر را از مسافر بپرسید');
      setRide((await api.post(`/driver/rides/${r.id}/start`, { pin })).ride);
    });
    mount(main,
      h('div', { class: 'card center' }, h('div', { class: 'muted small' }, 'زمان انتظار'), timer,
        h('div', { class: 'tiny muted' }, `${fa.num(r.free_wait_minutes)} دقیقه اول رایگان؛ پس از آن هزینه توقف به کرایه اضافه می‌شود`)),
      r.require_pin ? h('div', { class: 'mt' }, h('div', { class: 'small bold center mb' }, 'کد سفر مسافر'), h('div', { class: 'pin-inputs' }, pinBoxes)) : null,
      startBtn);
  } else {
    title = r.stops.length ? 'به سمت توقف/مقصد' : 'به سمت مقصد';
    sub = target.address;
    main = h('button', { class: 'btn btn-danger btn-lg btn-block' }, 'پایان سفر');
    main.onclick = async () => {
      if (!(await confirmDialog('پایان سفر', 'آیا مسافر به مقصد رسیده است؟', { ok: 'بله، پایان سفر' }))) return;
      busy(main, async () => setRide((await api.post(`/driver/rides/${r.id}/complete`)).ride));
    };
  }

  mount(sheet,
    h('div', { class: 'row between' },
      h('div', { class: 'grow' }, h('div', { class: 'status-line' }, title), h('div', { class: 'muted small ellipsis' }, sub || '')),
      h('button', { class: 'btn btn-primary', onclick: () => openNavigation(target) }, icon('navigate'), 'مسیریابی')),
    h('div', { class: 'divider' }),
    h('div', { class: 'driver-card' },
      avatar(r.rider.name),
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, r.rider.name || 'مسافر'), h('div', { class: 'small muted row gap-sm' }, ratingPill(r.rider.rating), r.type_name)),
      h('div', { style: { textAlign: 'left' } }, h('div', { class: 'bold' }, fa.toman(r.payable)), h('div', { class: 'tiny muted' }, r.payment_method === 'wallet' ? 'کیف پول' : 'نقدی'))),
    r.notes ? h('div', { class: 'card small mt' }, icon('note'), ' ', r.notes) : null,
    r.is_delivery ? h('div', { class: 'card small mt' }, `تحویل به: ${r.recipient_name} — `, h('a', { href: `tel:${r.recipient_phone}`, class: 'ltr' }, fa.faDigits(r.recipient_phone))) : null,
    h('div', { class: 'action-row mt' },
      action('phone', 'تماس', null, { href: `tel:${r.rider.phone}` }),
      action('chat', 'پیام', () => { S.unread = 0; openChat({ api, socket: S.socket, ride: r, myId: S.user.id, otherLabel: 'مسافر', quickReplies: DRIVER_REPLIES }); renderTrip(); }, { badge: S.unread }),
      action('shield', 'ایمنی', () => openSafety({ api, ride: r, supportPhone: S.cfg.support_phone }), { danger: true }),
      r.status !== 'in_progress' ? action('close', 'لغو', cancelRide) : null),
    h('div', { class: 'mt' }, main));
}

function cancelRide() {
  const r = S.ride;
  const noShowReady = r.status === 'arrived';
  const reasons = ['مسافر پاسخ نمی‌دهد', 'خرابی خودرو', 'مبدأ در دسترس نیست', 'مسافر بیش از ظرفیت', 'سایر'];
  let reason = reasons[0];
  modal((close) => {
    const chips = h('div', { class: 'chips', style: { flexWrap: 'wrap' } });
    const draw = () => mount(chips, reasons.map((x) => h('button', { class: `chip ${x === reason ? 'active' : ''}`, onclick: () => { reason = x; draw(); } }, x)));
    draw();
    const btn = h('button', { class: 'btn btn-danger btn-lg btn-block mt' }, 'لغو سفر');
    btn.onclick = () => busy(btn, async () => {
      await api.post(`/driver/rides/${r.id}/cancel`, { reason });
      close();
      S.ride = null;
      toast('سفر لغو شد و به راننده دیگری سپرده می‌شود');
      showIdle();
    });
    const noShow = noShowReady ? h('button', { class: 'btn btn-lg btn-block mt' }, 'مسافر نیامد (دریافت هزینه لغو)') : null;
    if (noShow) {
      noShow.onclick = () => busy(noShow, async () => {
        await api.post(`/driver/rides/${r.id}/cancel`, { reason: 'no_show' });
        close();
        S.ride = null;
        toast('سفر لغو شد؛ هزینه لغو به کیف پول شما اضافه شد', 'success');
        refreshToday();
        showIdle();
      });
    }
    return h('div', {},
      h('h3', {}, 'لغو سفر'),
      h('p', { class: 'muted small' }, 'لغوهای مکرر بر نرخ پذیرش و دریافت سفرهای بعدی شما تأثیر می‌گذارد.'),
      chips, btn, noShow,
      h('button', { class: 'btn btn-ghost btn-block mt', onclick: close }, 'بازگشت'));
  });
}

function showCompleted(ride) {
  S.view = 'completed';
  S.ride = null;
  clearInterval(waitTimer);
  clearTrip();
  refreshToday();
  let rating = 0;
  const done = h('button', { class: 'btn btn-primary btn-lg btn-block mt' }, 'ثبت و ادامه');
  done.onclick = () => busy(done, async () => {
    if (rating) await api.post(`/driver/rides/${ride.id}/rate`, { rating });
    showIdle();
  });
  mount(sheet,
    h('div', { class: 'center' },
      h('div', { class: 'muted small' }, 'سفر به پایان رسید'),
      ride.paid_cash
        ? [h('div', { class: 'small bold mt' }, 'مبلغ نقدی را از مسافر دریافت کنید'), h('div', { style: { fontSize: '38px', fontWeight: 900, color: 'var(--accent)' } }, fa.toman(ride.paid_cash))]
        : h('div', { style: { fontSize: '26px', fontWeight: 900 } }, 'پرداخت از کیف پول مسافر — دریافت نقدی ندارد')),
    h('div', { class: 'card mt' },
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'کرایه کل'), h('span', {}, fa.toman(ride.fare_final))),
      ride.wait_fee ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'شامل هزینه توقف'), h('span', {}, fa.toman(ride.wait_fee))) : null,
      ride.discount ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'تخفیف (پرداخت توسط نِنا)'), h('span', {}, fa.toman(ride.discount))) : null,
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'کمیسیون نِنا'), h('span', {}, `− ${fa.toman(ride.commission)}`)),
      h('div', { class: 'kv total' }, h('span', {}, 'درآمد شما'), h('span', {}, fa.toman(ride.earning)))),
    h('h3', { class: 'center mt-lg' }, `به ${ride.rider?.name || 'مسافر'} امتیاز دهید`),
    starInput((v) => { rating = v; }),
    done);
}

export const ctx = {
  api, S, start, showIdle, refreshToday, logout,
  get root() { return root; },
};

boot().catch(toastError);
