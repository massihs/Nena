import { createApi } from '/shared/api.js';
import {
  h, mount, icon, toast, toastError, modal, confirmDialog, busy, ratingPill, starInput, plateEl, avatar, listItem,
  trackSheetHeight, debounce, shareLink, vehicleArt, notify,
} from '/shared/ui.js';
import { createMap, carIcon, setHeading, pinIcon, meIcon, animateTo, routeLayer, fitTo, getPosition } from '/shared/map.js';
import { renderLogin } from '/shared/login.js';
import { placeResult } from '/shared/places.js';
import * as fa from '/shared/fa.js';
import { openMenu, openChat, openSafety, searchPlace, openWallet } from './pages.js';

const L = window.L;
const api = createApi('rider');
const root = document.getElementById('root');

// Session state. pickup/dropoff/stops are {lat, lng, address, title?}.
export const S = {
  cfg: null, user: null, map: null, me: null, socket: null,
  pickup: null, dropoff: null, stops: [],
  estimate: null, type: 'eco', payment: 'cash', promo: '', scheduledAt: null, notes: '', recipient: { name: '', phone: '' },
  ride: null, view: null, unread: 0, places: [], recents: [],
};
const layers = { nearby: null, route: null, markers: null, driver: null, me: null };
let sheet, centerPin;

// ---------------------------------------------------------------------------
// boot

async function boot() {
  S.cfg = await api.get('/config');
  if (!api.token) return showLogin();
  try {
    await start();
  } catch (err) {
    toastError(err);
  }
}

function showLogin() {
  mount(root, h('div', { class: 'center-page' }, h('div', { id: 'login', class: 'auth' })));
  renderLogin(root.querySelector('#login'), api, {
    title: 'به نِنا خوش آمدید',
    subtitle: 'برای درخواست سفر، شماره موبایل خود را وارد کنید.',
    onDone: () => start(),
    footer: h('p', { class: 'center small mt' }, h('a', { href: '/driver/' }, 'رانندۀ نِنا شوید ←')),
  });
}

async function start() {
  const me = await api.get('/me');
  S.user = me.user;
  buildShell();
  if (!S.user.name) await askName();
  connectSocket();
  locate(true);
  loadPlaces();

  const params = new URLSearchParams(location.search);
  if (params.has('topup')) {
    toast(params.get('topup') === 'ok' ? 'کیف پول با موفقیت شارژ شد' : 'پرداخت ناموفق بود', params.get('topup') === 'ok' ? 'success' : 'error');
    history.replaceState(null, '', location.pathname);
    refreshUser();
  }
  await syncActiveRide();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export async function refreshUser() {
  S.user = (await api.get('/me')).user;
  return S.user;
}

async function loadPlaces() {
  try {
    const [p, r] = await Promise.all([api.get('/rider/places'), api.get('/rider/recent-destinations')]);
    S.places = p.places;
    S.recents = r.places;
    if (S.view === 'home') showHome();
  } catch { /* non-critical */ }
}
export { loadPlaces };

function askName() {
  return new Promise((resolve) => {
    modal((close) => {
      const name = h('input', { class: 'input', placeholder: 'مثلاً سارا محمدی', autocomplete: 'name' });
      const ref = h('input', { class: 'input ltr-input', placeholder: 'اختیاری' });
      const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'شروع');
      return h('form', {
        onsubmit: (e) => {
          e.preventDefault();
          busy(btn, async () => {
            S.user = (await api.patch('/me', { name: name.value })).user;
            if (ref.value.trim()) {
              try { await api.post('/me/referral', { code: ref.value.trim() }); toast('کد معرف ثبت شد؛ هدیه بعد از اولین سفر'); } catch (err) { toastError(err); }
            }
            close();
            resolve();
          });
        },
      },
      h('h2', {}, 'خوش آمدید 👋'),
      h('p', { class: 'muted' }, 'راننده شما را با این نام صدا می‌زند.'),
      h('div', { class: 'field' }, h('label', {}, 'نام و نام خانوادگی'), name),
      h('div', { class: 'field' }, h('label', {}, 'کد معرف'), ref),
      btn);
    }, { dismissible: false });
  });
}

function buildShell() {
  sheet = h('section', { class: 'sheet', id: 'sheet' });
  centerPin = h('div', { class: 'center-pin hidden' }, h('div', { class: 'cp-head' }), h('div', { class: 'cp-stick' }));
  const menuBtn = h('button', { class: 'btn btn-icon', 'aria-label': 'منو', onclick: () => openMenu(ctx) }, icon('menu'));
  menuBtn.id = 'menuBtn';
  mount(root, h('div', { class: 'app' },
    h('div', { id: 'map', class: 'map' }),
    h('div', { class: 'topbar' }, menuBtn, h('div', { class: 'brand brand-pill' }, 'نِنا')),
    centerPin,
    h('div', { class: 'map-fabs' }, h('button', { class: 'btn btn-icon', 'aria-label': 'موقعیت من', onclick: () => locate(false, true) }, icon('locate'))),
    sheet));
  trackSheetHeight(sheet);
  S.map = createMap(document.getElementById('map'), S.cfg);
  layers.nearby = L.layerGroup().addTo(S.map);
  layers.markers = L.layerGroup().addTo(S.map);
  setInterval(refreshNearby, 7000);
}

async function locate(initial = false, recenter = false) {
  const pos = await getPosition();
  if (!pos) {
    if (!initial) toast('دسترسی به موقعیت مکانی ممکن نیست؛ مبدأ را روی نقشه انتخاب کنید', 'error');
    if (initial && !S.me) {
      const [lat, lng] = S.cfg.map.center;
      S.me = { lat, lng, approximate: true };
    }
  } else {
    S.me = pos;
    if (layers.me) layers.me.setLatLng(pos);
    else layers.me = L.marker(pos, { icon: meIcon(), interactive: false, zIndexOffset: -10 }).addTo(S.map);
  }
  if (S.me && (initial || recenter) && ['home', 'search', null].includes(S.view)) S.map.setView(S.me, 16);
  if (S.me && !S.pickup && !S.me.approximate) {
    S.pickup = { lat: S.me.lat, lng: S.me.lng, address: 'موقعیت فعلی', current: true };
    reverse(S.me).then((addr) => { if (S.pickup?.current && addr) S.pickup.address = addr; });
  }
  refreshNearby();
}

export async function reverse({ lat, lng }) {
  try { return (await api.get(`/geo/reverse?lat=${lat}&lng=${lng}`)).address; } catch { return ''; }
}

async function refreshNearby() {
  if (!S.map || !['home', 'search', 'options', 'pick'].includes(S.view)) {
    layers.nearby?.clearLayers();
    return;
  }
  const c = S.pickup || S.me || S.map.getCenter();
  try {
    const { drivers } = await api.get(`/rider/nearby?lat=${c.lat}&lng=${c.lng}`);
    layers.nearby.clearLayers();
    for (const d of drivers) L.marker([d.lat, d.lng], { icon: carIcon(d.vehicle_type, d.heading), interactive: false }).addTo(layers.nearby);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// realtime

function connectSocket() {
  S.socket = api.connect();
  S.socket.on('connect', () => { if (S.view) syncActiveRide(); });
  S.socket.on('ride:update', (ride) => {
    if (S.ride && ride.id !== S.ride.id && ride.status !== 'searching') return;
    const prev = S.ride?.status;
    setRide(ride);
    if (prev !== ride.status) announce(ride);
  });
  S.socket.on('driver:location', (p) => {
    if (!S.ride || p.ride_id !== S.ride.id || !layers.driver) return;
    animateTo(layers.driver, p);
    setHeading(layers.driver, p.heading);
    if (S.ride.driver) Object.assign(S.ride.driver, { lat: p.lat, lng: p.lng });
  });
  S.socket.on('chat:message', (m) => {
    if (m.sender_id === S.user.id) return;
    if (!document.querySelector('.chat')) {
      S.unread++;
      toast(`پیام راننده: ${m.text}`);
      notify('پیام جدید از راننده', m.text);
      if (S.view === 'trip') showTrip();
    }
  });
  S.socket.on('notice', (n) => toast(n.text));
}

function announce(ride) {
  const text = {
    accepted: `${ride.driver?.name || 'راننده'} درخواست شما را پذیرفت`,
    arrived: 'راننده به مبدأ رسید',
    in_progress: 'سفر شروع شد؛ سفر خوبی داشته باشید',
    completed: 'به مقصد رسیدید',
  }[ride.status];
  if (text) { toast(text, 'success'); notify('نِنا', text); navigator.vibrate?.(200); }
}

async function syncActiveRide() {
  const { ride, pending_rating } = await api.get('/rider/rides/active');
  if (ride) setRide(ride);
  else if (pending_rating) showRating(pending_rating);
  else if (!S.view || ['searching', 'trip', 'no_driver'].includes(S.view)) showHome();
}

// ---------------------------------------------------------------------------
// map drawing

function clearRoute() {
  layers.route?.remove();
  layers.route = null;
  layers.markers.clearLayers();
  if (layers.driver) { layers.driver.remove(); layers.driver = null; }
}

function drawTrip({ pickup, dropoff, stops = [], route }) {
  clearRoute();
  if (route?.length) layers.route = routeLayer(route).addTo(S.map);
  if (pickup) L.marker(pickup, { icon: pinIcon('o', shortAddr(pickup.address) || 'مبدأ'), interactive: false }).addTo(layers.markers);
  stops.forEach((s, i) => L.marker(s, { icon: pinIcon('d', `توقف ${fa.num(i + 1)}`), interactive: false }).addTo(layers.markers));
  if (dropoff) L.marker(dropoff, { icon: pinIcon('d', shortAddr(dropoff.address) || 'مقصد'), interactive: false }).addTo(layers.markers);
}

const shortAddr = (a) => (a || '').split('،')[0].slice(0, 28);

function setCenterPin(on) {
  centerPin.classList.toggle('hidden', !on);
}

// ---------------------------------------------------------------------------
// views

const greeting = () => {
  const hr = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: false, timeZone: 'Asia/Tehran' }).format(new Date()));
  return hr < 12 ? 'صبح بخیر' : hr < 17 ? 'روز بخیر' : 'عصر بخیر';
};

export function showHome() {
  S.view = 'home';
  S.ride = null;
  S.dropoff = null;
  S.stops = [];
  S.scheduledAt = null;
  sheet.classList.remove('full');
  setCenterPin(false);
  clearRoute();
  refreshNearby();

  const home = S.places.find((p) => p.label === 'home');
  const work = S.places.find((p) => p.label === 'work');
  const goTo = (p) => { S.dropoff = { lat: p.lat, lng: p.lng, address: p.address || p.title }; ensurePickupThen(showOptions); };

  const firstName = (S.user.name || '').split(' ')[0];
  mount(sheet,
    h('h3', {}, `${greeting()}${firstName ? `، ${firstName}` : ''}`),
    h('button', { class: 'where-to mt', onclick: () => showSearch('dropoff') }, icon('search'), 'کجا می‌روید؟',
      h('span', { class: 'spacer' }),
      h('span', { class: 'chip', onclick: (e) => { e.stopPropagation(); pickSchedule(() => showSearch('dropoff')); } }, icon('clock'), 'رزرو')),
    h('div', { class: 'chips mt' },
      h('button', { class: 'chip', onclick: () => (home ? goTo(home) : addPlace('home')) }, icon('home'), home ? 'خانه' : 'افزودن خانه'),
      h('button', { class: 'chip', onclick: () => (work ? goTo(work) : addPlace('work')) }, icon('work'), work ? 'محل کار' : 'افزودن محل کار'),
      ...S.places.filter((p) => p.label === 'other').map((p) => h('button', { class: 'chip', onclick: () => goTo(p) }, icon('star'), p.title))),
    S.recents.length
      ? h('div', { class: 'list mt' }, S.recents.map((r) => listItem({ iconName: 'clock', title: shortAddr(r.address), sub: r.address, onclick: () => goTo(r) })))
      : null,
    h('div', { class: 'divider' }),
    h('div', { class: 'row between' },
      h('div', { class: 'bold' }, 'سرویس‌های نِنا'),
      h('span', { class: 'muted small' }, 'سواری • موتور • پیک')),
    h('div', { class: 'chips mt' },
      [['eco', 'سواری', 'car'], ['bike', 'موتور', 'bike'], ['box', 'ارسال مرسوله', 'box'], ['van', 'ون', 'van']].map(([k, label, art]) =>
        h('button', {
          class: 'card', style: { padding: '8px 12px', minWidth: '96px', cursor: 'pointer', border: 0, textAlign: 'center' },
          onclick: () => { S.type = k; showSearch('dropoff'); },
        }, h('div', { style: { width: '64px', height: '40px', margin: '0 auto' } }, vehicleArt(art)), h('div', { class: 'small bold' }, label)))),
  );
}

function ensurePickupThen(fn) {
  if (S.pickup) return fn();
  toast('ابتدا مبدأ را مشخص کنید');
  showSearch('pickup');
}

async function addPlace(label) {
  const place = await searchPlace(ctx, label === 'home' ? 'آدرس خانه' : 'آدرس محل کار');
  if (!place) return;
  try {
    await api.post('/rider/places', { ...place, label });
    toast('ذخیره شد', 'success');
    await loadPlaces();
  } catch (err) { toastError(err); }
}

// Search screen with origin, optional stops and destination.
export function showSearch(focus = 'dropoff') {
  S.view = 'search';
  setCenterPin(false);
  clearRoute();
  sheet.classList.add('full');

  const fields = [{ key: 'pickup' }, ...S.stops.map((_, i) => ({ key: 'stop', i })), { key: 'dropoff' }];
  const getVal = (f) => (f.key === 'stop' ? S.stops[f.i] : S[f.key]);
  const setVal = (f, v) => { if (f.key === 'stop') S.stops[f.i] = v; else S[f.key] = v; };
  const label = (f) => (f.key === 'pickup' ? 'مبدأ' : f.key === 'dropoff' ? 'مقصد' : `توقف ${fa.num(f.i + 1)}`);

  let active = fields.find((f) => f.key === focus) || fields[fields.length - 1];
  const results = h('div', { class: 'list mt' });
  const inputs = new Map();

  let searchSeq = 0;
  const doSearch = debounce(async (q) => {
    if (q.trim().length < 2) return renderSuggestions();
    const seq = ++searchSeq;
    mount(results, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    const c = S.me || S.map.getCenter();
    try {
      const { results: items } = await api.get(`/geo/search?q=${encodeURIComponent(q)}&lat=${c.lat}&lng=${c.lng}`);
      if (seq !== searchSeq) return; // a newer search is in flight
      mount(results,
        items.length ? items.map((it) => placeResult(api, it, choose))
          : h('div', { class: 'empty' }, 'نتیجه‌ای یافت نشد؛ از «انتخاب روی نقشه» استفاده کنید'),
        pickOnMapItem());
    } catch (err) { if (seq === searchSeq) mount(results, h('div', { class: 'empty' }, err.message)); }
  }, 250);

  const pickOnMapItem = () => listItem({ iconName: 'pin', title: 'انتخاب روی نقشه', sub: `${label(active)} را با جابجایی نقشه مشخص کنید`, onclick: () => showPickOnMap(active) });

  function renderSuggestions() {
    const items = [];
    if (active.key === 'pickup' && S.me && !S.me.approximate) {
      items.push(listItem({ iconName: 'locate', title: 'موقعیت فعلی من', sub: 'استفاده از GPS', onclick: async () => choose({ lat: S.me.lat, lng: S.me.lng, address: (await reverse(S.me)) || 'موقعیت فعلی', current: true }) }));
    }
    items.push(pickOnMapItem());
    for (const p of S.places) items.push(listItem({ iconName: p.label === 'home' ? 'home' : p.label === 'work' ? 'work' : 'star', title: p.title, sub: p.address, onclick: () => choose({ lat: p.lat, lng: p.lng, address: p.address || p.title }) }));
    for (const r of S.recents) items.push(listItem({ iconName: 'clock', title: shortAddr(r.address), sub: r.address, onclick: () => choose(r) }));
    mount(results, items);
  }

  function choose(place) {
    setVal(active, { lat: place.lat, lng: place.lng, address: place.address, current: place.current });
    inputs.get(active).value = place.address;
    const next = fields.find((f) => !getVal(f));
    if (!next) {
      sheet.classList.remove('full');
      return showOptions();
    }
    activate(next);
  }

  function activate(f) {
    active = f;
    const inp = inputs.get(f);
    inp.focus();
    inp.select();
    if (inp.value.trim().length >= 2 && !getVal(f)) doSearch(inp.value); else renderSuggestions();
  }

  const box = h('div', { class: 'route-inputs' });
  for (const f of fields) {
    const v = getVal(f);
    const inp = h('input', {
      class: 'input', placeholder: f.key === 'pickup' ? 'مبدأ' : f.key === 'dropoff' ? 'به کجا؟' : 'توقف میانی', value: v?.current ? 'موقعیت فعلی من' : v?.address || '',
      onfocus: () => { active = f; renderSuggestions(); },
      oninput: (e) => { setVal(f, null); doSearch(e.target.value); },
    });
    inputs.set(f, inp);
    const wrap = h('div', { class: 'input-wrap' }, h('span', { class: 'marker' }), inp);
    if (f.key === 'stop') {
      wrap.append(h('button', { class: 'btn btn-ghost btn-sm clear', type: 'button', onclick: () => { S.stops.splice(f.i, 1); showSearch('dropoff'); } }, icon('close')));
    }
    box.append(wrap);
  }

  mount(sheet,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-icon flat', 'aria-label': 'بازگشت', onclick: () => { sheet.classList.remove('full'); showHome(); } }, icon('back')),
      h('h3', { class: 'grow', style: { margin: 0 } }, S.scheduledAt ? `رزرو برای ${fa.jDateTime(S.scheduledAt)}` : 'مسیر سفر'),
      S.stops.length < 2 ? h('button', { class: 'btn btn-sm', onclick: () => { S.stops.push(null); showSearch('stop'); } }, icon('plus'), 'توقف') : null),
    h('div', { class: 'mt' }, box),
    results);
  activate(fields.find((f) => f.key === focus && (f.key !== 'stop' || !getVal(f))) || fields.find((f) => !getVal(f)) || active);
}

function showPickOnMap(field) {
  S.view = 'pick';
  sheet.classList.remove('full');
  clearRoute();
  setCenterPin(true);
  const current = field.key === 'stop' ? S.stops[field.i] : S[field.key];
  const start = current || S.me;
  if (start) S.map.setView(start, 17);

  const addr = h('div', { class: 'bold ellipsis' }, '...');
  const what = field.key === 'pickup' ? 'مبدأ' : field.key === 'dropoff' ? 'مقصد' : 'توقف';
  const update = debounce(async () => {
    addr.textContent = '...';
    addr.textContent = (await reverse(S.map.getCenter())) || 'نقطه انتخاب‌شده روی نقشه';
  }, 400);
  S.map.on('moveend', update);
  update();

  const done = (apply) => {
    S.map.off('moveend', update);
    setCenterPin(false);
    if (apply) {
      const c = S.map.getCenter();
      const v = { lat: c.lat, lng: c.lng, address: addr.textContent };
      if (field.key === 'stop') S.stops[field.i] = v; else S[field.key] = v;
      if (S.pickup && S.dropoff && S.stops.every(Boolean)) return showOptions();
    }
    showSearch(field.key);
  };

  mount(sheet,
    h('h3', {}, `${what} را مشخص کنید`),
    h('p', { class: 'muted small' }, 'نقشه را جابجا کنید تا نشانگر روی محل دقیق قرار گیرد.'),
    h('div', { class: 'row card mt' }, icon('pin'), addr),
    h('div', { class: 'row mt' },
      h('button', { class: 'btn btn-lg', onclick: () => done(false) }, 'بازگشت'),
      h('button', { class: 'btn btn-primary btn-lg grow', onclick: () => done(true) }, `تأیید ${what}`)));
}

// Ride options with prices.
export async function showOptions() {
  S.view = 'options';
  setCenterPin(false);
  sheet.classList.remove('full');
  mount(sheet, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), h('p', { class: 'mt' }, 'در حال محاسبه کرایه...')));
  drawTrip({ pickup: S.pickup, dropoff: S.dropoff, stops: S.stops });
  try {
    S.estimate = await api.post('/rider/estimate', { pickup: S.pickup, dropoff: S.dropoff, stops: S.stops, promo_code: S.promo || undefined });
  } catch (err) {
    toastError(err);
    return showSearch('dropoff');
  }
  if (S.estimate.promo_error) { toast(S.estimate.promo_error, 'error'); S.promo = ''; }
  drawTrip({ pickup: S.pickup, dropoff: S.dropoff, stops: S.stops, route: S.estimate.route });
  renderOptions();
  fitTo(S.map, [S.pickup, S.dropoff, ...S.stops, ...S.estimate.route.filter((_, i) => i % 5 === 0)], sheet);
}

function renderOptions() {
  if (S.view !== 'options') return;
  const est = S.estimate;
  if (!est.options.some((o) => o.type === S.type)) S.type = est.options[0]?.type;
  const sel = est.options.find((o) => o.type === S.type);
  const balance = S.user.wallet;

  const options = est.options.map((o) => h('button', {
    class: `ride-option ${o.type === S.type ? 'selected' : ''}`,
    onclick: () => { if (o.type === S.type) return; S.type = o.type; renderOptions(); },
  },
  h('span', { class: 'ro-icon' }, vehicleArt(o.icon)),
  h('span', { class: 'ro-body' },
    h('div', { class: 'row gap-sm' }, h('span', { class: 'ro-name' }, o.name), o.seats ? h('span', { class: 'muted small row gap-sm' }, icon('user'), fa.num(o.seats)) : null),
    h('div', { class: 'muted small' }, o.eta_min != null ? `${fa.minutes(o.eta_min)} تا رسیدن • ${o.description}` : 'فعلاً راننده‌ای در دسترس نیست')),
  h('span', { class: 'ro-price' }, o.discount ? h('s', {}, fa.toman(o.fare)) : null, fa.toman(o.payable))));

  const deliveryFields = sel?.is_delivery ? h('div', { class: 'card mt' },
    h('div', { class: 'bold mb' }, 'مشخصات گیرنده مرسوله'),
    h('div', { class: 'field' }, h('input', { class: 'input', placeholder: 'نام گیرنده', value: S.recipient.name, oninput: (e) => { S.recipient.name = e.target.value; } })),
    h('div', { class: 'field', style: { marginBottom: 0 } }, h('input', { class: 'input ltr-input', type: 'tel', placeholder: 'موبایل گیرنده', value: S.recipient.phone, oninput: (e) => { S.recipient.phone = e.target.value; } }))) : null;

  const settingRow = (ic, title, value, onclick) => h('button', { class: 'list-item', onclick },
    h('span', { class: 'li-icon' }, icon(ic)), h('span', { class: 'li-body' }, h('div', { class: 'li-title' }, title), value ? h('div', { class: 'li-sub' }, value) : null), icon('forward'));

  const reqBtn = h('button', { class: 'btn btn-primary btn-lg btn-block mt', disabled: !sel },
    S.scheduledAt ? `رزرو ${sel?.name || ''}` : `درخواست ${sel?.name || ''}`);
  reqBtn.onclick = () => busy(reqBtn, requestRide);

  mount(sheet,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-icon flat', 'aria-label': 'بازگشت', onclick: () => showSearch('dropoff') }, icon('back')),
      h('div', { class: 'grow' },
        h('div', { class: 'bold' }, 'انتخاب سرویس'),
        h('div', { class: 'muted small' }, `${fa.km(est.distance_km)} • حدود ${fa.minutes(est.duration_min)}`))),
    est.surge > 1 ? h('div', { class: 'surge-banner mt' }, icon('fire'), `تقاضا بالاست؛ ضریب کرایه ×${fa.num(est.surge)}`) : null,
    h('div', { class: 'list mt' }, options),
    deliveryFields,
    h('div', { class: 'list mt' },
      settingRow(S.payment === 'wallet' ? 'wallet' : 'cash', 'روش پرداخت', S.payment === 'wallet' ? `کیف پول (موجودی ${fa.toman(balance)})` : 'پرداخت نقدی به راننده', pickPayment),
      settingRow('tag', 'کد تخفیف', S.promo || 'افزودن کد تخفیف', pickPromo),
      settingRow('clock', 'زمان سفر', S.scheduledAt ? fa.jDateTime(S.scheduledAt) : 'همین حالا', () => pickSchedule(renderOptions)),
      settingRow('note', 'یادداشت برای راننده', S.notes || 'مثلاً: جلوی در شماره ۲', pickNotes)),
    reqBtn);
}

function pickPayment() {
  modal((close) => {
    const opt = (key, ic, title, sub) => h('button', { class: `ride-option ${S.payment === key ? 'selected' : ''}`, onclick: () => { S.payment = key; close(); renderOptions(); } },
      h('span', { class: 'li-icon' }, icon(ic)), h('span', { class: 'ro-body' }, h('div', { class: 'bold' }, title), h('div', { class: 'muted small' }, sub)));
    return h('div', {},
      h('h3', {}, 'روش پرداخت'),
      h('div', { class: 'col mt' },
        opt('cash', 'cash', 'نقدی', 'کرایه را در پایان سفر به راننده بپردازید'),
        opt('wallet', 'wallet', 'کیف پول نِنا', `موجودی: ${fa.toman(S.user.wallet)} — کسری به‌صورت نقدی دریافت می‌شود`)),
      h('button', { class: 'btn btn-block mt', onclick: () => { close(); openWallet(ctx); } }, icon('plus'), 'شارژ کیف پول'));
  });
}

function pickPromo() {
  modal((close) => {
    const input = h('input', { class: 'input ltr-input', placeholder: 'NENA50', value: S.promo });
    const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'اعمال کد');
    return h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        busy(btn, async () => {
          const code = input.value.trim();
          if (code) {
            const sel = S.estimate.options.find((o) => o.type === S.type);
            const r = await api.post('/rider/promo/check', { code, fare: sel?.fare });
            toast(r.description || 'کد تخفیف اعمال شد', 'success');
          }
          S.promo = code;
          close();
          showOptions();
        });
      },
    },
    h('h3', {}, 'کد تخفیف'),
    h('div', { class: 'field mt' }, input),
    btn,
    S.promo ? h('button', { class: 'btn btn-ghost btn-block mt', type: 'button', onclick: () => { S.promo = ''; close(); showOptions(); } }, 'حذف کد') : null);
  });
}

function pickNotes() {
  modal((close) => {
    const ta = h('textarea', { class: 'input', maxlength: 300, placeholder: 'توضیحات برای راننده' }, S.notes);
    return h('div', {},
      h('h3', {}, 'یادداشت برای راننده'),
      h('div', { class: 'field mt' }, ta),
      h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => { S.notes = ta.value.trim(); close(); renderOptions(); } }, 'ذخیره'));
  });
}

function pickSchedule(after) {
  modal((close) => {
    const days = h('select', { class: 'input' });
    const DAY = 86400000;
    for (let i = 0; i < 7; i++) {
      const t = Date.now() + i * DAY;
      days.append(h('option', { value: i }, i === 0 ? 'امروز' : i === 1 ? 'فردا' : `${fa.jWeekday(t)} ${fa.jDateShort(t)}`));
    }
    const times = h('select', { class: 'input' });
    for (let m = 0; m < 24 * 60; m += 15) {
      times.append(h('option', { value: m }, fa.faDigits(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)));
    }
    // Tehran local midnight for a day offset.
    const tehranMidnight = (offsetDays) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + offsetDays * DAY);
      return Date.parse(`${parts}T00:00:00+03:30`);
    };
    const nowMin = Math.ceil(((Date.now() - tehranMidnight(0)) / 60000 + 30) / 15) * 15;
    times.value = String(Math.min(nowMin, 24 * 60 - 15));
    return h('div', {},
      h('h3', {}, 'رزرو سفر'),
      h('p', { class: 'muted small' }, 'راننده از ۱۰ دقیقه قبل از زمان انتخابی برای شما جستجو می‌شود.'),
      h('div', { class: 'row mt' }, h('div', { class: 'field grow' }, h('label', {}, 'روز'), days), h('div', { class: 'field grow' }, h('label', {}, 'ساعت'), times)),
      h('button', {
        class: 'btn btn-primary btn-lg btn-block',
        onclick: () => {
          const t = tehranMidnight(Number(days.value)) + Number(times.value) * 60000;
          if (t < Date.now() + 15 * 60000) return toast('زمان رزرو باید حداقل ۱۵ دقیقه بعد باشد', 'error');
          S.scheduledAt = t;
          close();
          after?.();
        },
      }, 'تأیید زمان'),
      S.scheduledAt ? h('button', { class: 'btn btn-ghost btn-block mt', onclick: () => { S.scheduledAt = null; close(); after?.(); } }, 'همین حالا') : null);
  });
}

async function requestRide() {
  const { ride } = await api.post('/rider/rides', {
    type: S.type, pickup: S.pickup, dropoff: S.dropoff, stops: S.stops, payment_method: S.payment, promo_code: S.promo || undefined,
    scheduled_at: S.scheduledAt || undefined, notes: S.notes || undefined,
    recipient_name: S.recipient.name || undefined, recipient_phone: S.recipient.phone || undefined,
  });
  S.promo = '';
  S.notes = '';
  if (ride.status === 'scheduled') {
    toast(`سفر برای ${fa.jDateTime(ride.scheduled_at)} رزرو شد`, 'success');
    S.scheduledAt = null;
    showHome();
    return;
  }
  setRide(ride);
}

// ---------------------------------------------------------------------------
// active ride

export function setRide(ride) {
  if (!ride) return showHome();
  S.ride = ride;
  switch (ride.status) {
    case 'scheduled': return showHome();
    case 'searching': return showSearching();
    case 'no_driver': return showNoDriver();
    case 'accepted': case 'arrived': case 'in_progress': return showTrip();
    case 'completed': S.ride = null; return showRating(ride);
    case 'cancelled': S.ride = null; return onCancelled(ride);
    default: return showHome();
  }
}

function showSearching() {
  const r = S.ride;
  S.view = 'searching';
  setCenterPin(false);
  drawTrip(r);
  S.map.setView(r.pickup, 16);
  mount(sheet,
    h('div', { class: 'searching-anim' }, h('span'), h('span'), h('span'), h('i')),
    h('h3', { class: 'center' }, 'در حال یافتن نزدیک‌ترین راننده'),
    h('p', { class: 'center muted small' }, `${r.type_name} • ${fa.toman(r.payable)}`),
    h('div', { class: 'progress-bar mt' }, h('i')),
    h('div', { class: 'list mt' },
      listItem({ iconName: 'dot', title: r.pickup.address || 'مبدأ', sub: 'مبدأ' }),
      listItem({ iconName: 'pin', title: r.dropoff.address || 'مقصد', sub: 'مقصد' })),
    h('button', { class: 'btn btn-danger-soft btn-lg btn-block mt', onclick: (e) => busy(e.currentTarget, async () => setRide((await api.post(`/rider/rides/${r.id}/cancel`, { reason: 'لغو پیش از پذیرش' })).ride)) }, 'لغو درخواست'));
}

function showNoDriver() {
  const r = S.ride;
  S.view = 'no_driver';
  mount(sheet,
    h('div', { class: 'empty' }, icon('car'), h('h3', {}, 'راننده‌ای پیدا نشد'), h('p', {}, 'همه رانندگان اطراف مشغول هستند. چند لحظه دیگر دوباره تلاش کنید یا سرویس دیگری انتخاب کنید.')),
    h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: (e) => busy(e.currentTarget, async () => setRide((await api.post(`/rider/rides/${r.id}/retry`)).ride)) }, 'تلاش دوباره'),
    h('button', {
      class: 'btn btn-lg btn-block mt',
      onclick: () => { S.pickup = r.pickup; S.dropoff = r.dropoff; S.stops = r.stops; S.ride = null; showOptions(); },
    }, 'انتخاب سرویس دیگر'),
    h('button', { class: 'btn btn-ghost btn-block mt', onclick: showHome }, 'بازگشت'));
}

function tripStatus(r) {
  if (r.status === 'accepted') return { title: r.driver?.eta_min ? `راننده ${fa.minutes(r.driver.eta_min)} دیگر می‌رسد` : 'راننده در راه است', sub: 'به مبدأ بروید و منتظر بمانید' };
  if (r.status === 'arrived') return { title: 'راننده رسیده و منتظر شماست', sub: `${fa.num(r.free_wait_minutes)} دقیقه انتظار رایگان؛ پس از آن هزینه توقف محاسبه می‌شود` };
  const eta = (r.started_at || Date.now()) + r.duration_min * 60000;
  return { title: 'در مسیر مقصد', sub: `زمان تقریبی رسیدن: ${fa.jTime(Math.max(eta, Date.now() + 60000))}` };
}

function showTrip() {
  const r = S.ride;
  S.view = 'trip';
  setCenterPin(false);
  drawTrip(r);
  const d = r.driver;
  if (d?.lat != null) {
    layers.driver = L.marker([d.lat, d.lng], { icon: carIcon(d.vehicle_type, d.heading), zIndexOffset: 1000 }).addTo(S.map);
  }
  const focus = r.status === 'in_progress' ? [d, r.dropoff] : r.status === 'arrived' ? [r.pickup] : [d, r.pickup];
  fitTo(S.map, focus.filter((p) => p?.lat != null), sheet);

  const st = tripStatus(r);
  const canCancel = ['accepted', 'arrived'].includes(r.status);
  const action = (ic, label, onclick, { danger, href, badge } = {}) => h(href ? 'a' : 'button', { class: `action ${danger ? 'danger' : ''}`, onclick, href },
    h('span', { class: 'a-ic', style: { position: 'relative' } }, icon(ic), badge ? h('span', { class: 'badge red', style: { position: 'absolute', top: '-4px', left: '-4px' } }, fa.num(badge)) : null), label);

  mount(sheet,
    h('div', { class: 'status-line' }, st.title),
    h('div', { class: 'muted small' }, st.sub),
    r.require_pin && r.status !== 'in_progress' ? h('div', { class: 'pin-box mt' }, h('span', {}, 'کد سفر را به راننده بگویید'), h('span', { class: 'pin' }, fa.faDigits(r.pin))) : null,
    h('div', { class: 'divider' }),
    d ? h('div', { class: 'driver-card' },
      avatar(d.name),
      h('div', { class: 'grow' },
        h('div', { class: 'bold' }, d.name),
        h('div', { class: 'row gap-sm small muted' }, ratingPill(d.rating), `${fa.num(d.trips)} سفر`)),
      h('div', { class: 'car-info col gap-sm', style: { alignItems: 'flex-end' } },
        plateEl(d.plate),
        h('div', { class: 'small muted' }, `${d.vehicle_model} ${d.vehicle_color}`))) : null,
    h('div', { class: 'action-row mt-lg' },
      action('phone', 'تماس', null, { href: d ? `tel:${d.phone}` : undefined }),
      action('chat', 'پیام', () => { S.unread = 0; openChat(ctx, r, 'راننده'); showTrip(); }, { badge: S.unread }),
      action('share', 'اشتراک سفر', () => shareLink('سفر من با نِنا', `من با ${d?.name || 'نِنا'} در سفر هستم؛ موقعیت زنده:`, `${location.origin}/track/${r.share_token}`)),
      action('shield', 'ایمنی', () => openSafety(ctx, r), { danger: true }),
      r.status === 'in_progress' ? action('edit', 'تغییر مقصد', changeDestination) : null,
      canCancel ? action('close', 'لغو سفر', cancelTrip) : null),
    h('div', { class: 'divider' }),
    h('div', { class: 'list' },
      listItem({ iconName: 'dot', title: r.pickup.address || 'مبدأ', sub: 'مبدأ' }),
      ...r.stops.map((s, i) => listItem({ iconName: 'pin', title: s.address || '—', sub: `توقف ${fa.num(i + 1)}` })),
      listItem({ iconName: 'pin', title: r.dropoff.address || 'مقصد', sub: 'مقصد' })),
    h('div', { class: 'card mt row between' },
      h('div', {}, h('div', { class: 'bold' }, fa.toman(r.payable)), h('div', { class: 'muted small' }, `${r.type_name} • ${r.payment_method === 'wallet' ? 'کیف پول' : 'نقدی'}`)),
      r.discount ? h('span', { class: 'badge green' }, `${fa.toman(r.discount)} تخفیف`) : null),
    r.is_delivery ? h('div', { class: 'card mt small' }, `گیرنده: ${r.recipient_name} — `, h('span', { class: 'ltr' }, fa.faDigits(r.recipient_phone))) : null);
}

async function changeDestination() {
  const place = await searchPlace(ctx, 'مقصد جدید');
  if (!place) return;
  try {
    const { ride } = await api.post(`/rider/rides/${S.ride.id}/destination`, { dropoff: place });
    toast(`مقصد تغییر کرد؛ کرایه جدید: ${fa.toman(ride.payable)}`, 'success');
    setRide(ride);
  } catch (err) { toastError(err); }
}

function cancelTrip() {
  const r = S.ride;
  const lateAccept = r.status === 'accepted' && Date.now() - r.accepted_at > S.cfg.free_cancel_seconds * 1000;
  const fee = lateAccept || r.status === 'arrived' ? S.cfg.cancel_fee : 0;
  const reasons = ['راننده دیر کرد', 'تغییر برنامه', 'مبدأ را اشتباه زدم', 'راننده خواست لغو کنم', 'سایر'];
  let reason = reasons[1];
  modal((close) => {
    const chips = h('div', { class: 'chips', style: { flexWrap: 'wrap' } });
    const draw = () => mount(chips, reasons.map((x) => h('button', { class: `chip ${x === reason ? 'active' : ''}`, onclick: () => { reason = x; draw(); } }, x)));
    draw();
    const btn = h('button', { class: 'btn btn-danger btn-lg btn-block mt' }, 'لغو سفر');
    btn.onclick = () => busy(btn, async () => { const res = await api.post(`/rider/rides/${r.id}/cancel`, { reason }); close(); setRide(res.ride); });
    return h('div', {},
      h('h3', {}, 'سفر لغو شود؟'),
      fee ? h('p', { class: 'badge red' }, `هزینه لغو: ${fa.toman(fee)}`) : h('p', { class: 'muted small' }, 'لغو در این مرحله رایگان است.'),
      h('p', { class: 'muted small mt' }, 'دلیل لغو:'), chips, btn,
      h('button', { class: 'btn btn-lg btn-block mt', onclick: close }, 'ادامه سفر'));
  });
}

function onCancelled(ride) {
  if (ride.cancelled_by === 'driver' && ride.cancel_reason === 'no_show') {
    modal((close) => h('div', {},
      h('h3', {}, 'سفر لغو شد'),
      h('p', { class: 'muted' }, 'راننده پس از انتظار در مبدأ، به دلیل عدم حضور شما سفر را لغو کرد.'),
      ride.cancel_fee ? h('p', { class: 'badge red' }, `هزینه لغو: ${fa.toman(ride.cancel_fee)}`) : null,
      h('button', { class: 'btn btn-primary btn-lg btn-block mt', onclick: close }, 'متوجه شدم')));
  } else if (ride.cancelled_by === 'admin') {
    toast('سفر توسط پشتیبانی لغو شد');
  } else if (ride.cancel_fee) {
    toast(`سفر لغو شد؛ هزینه لغو ${fa.toman(ride.cancel_fee)}`);
  } else {
    toast('سفر لغو شد');
  }
  refreshUser();
  showHome();
}

const GOOD_TAGS = ['رانندگی ایمن', 'خوش‌برخورد', 'خودروی تمیز', 'مسیریابی عالی', 'وقت‌شناس'];
const BAD_TAGS = ['رانندگی پرخطر', 'تأخیر در رسیدن', 'خودروی نامرتب', 'برخورد نامناسب', 'مسیر طولانی', 'درخواست کرایه بیشتر'];

export function showRating(ride) {
  S.view = 'rating';
  S.ride = null;
  setCenterPin(false);
  clearRoute();
  refreshUser().then(() => { if (S.view === 'rating') tipLine.textContent = `موجودی کیف پول: ${fa.toman(S.user.wallet)}`; }).catch(() => {});
  let rating = 0, tip = 0;
  const tags = new Set();
  const tagBox = h('div', { class: 'chips mt', style: { flexWrap: 'wrap', justifyContent: 'center' } });
  const drawTags = () => mount(tagBox, rating ? (rating >= 4 ? GOOD_TAGS : BAD_TAGS).map((t) => h('button', {
    class: `chip ${tags.has(t) ? 'active' : ''}`, onclick: () => { tags.has(t) ? tags.delete(t) : tags.add(t); drawTags(); },
  }, t)) : []);
  const comment = h('textarea', { class: 'input mt', placeholder: 'نظر شما (اختیاری)', maxlength: 500 });
  const tipChips = h('div', { class: 'chips' });
  const drawTips = () => mount(tipChips, [0, 5000, 10000, 20000, 50000].map((v) => h('button', { class: `chip ${tip === v ? 'active' : ''}`, onclick: () => { tip = v; drawTips(); } }, v ? fa.tomanShort(v) : 'بدون انعام')));
  drawTips();
  const tipLine = h('div', { class: 'muted tiny mt' });

  const submit = h('button', { class: 'btn btn-primary btn-lg btn-block mt' }, 'ثبت امتیاز');
  submit.onclick = () => busy(submit, async () => {
    if (!rating) return toast('لطفاً امتیاز دهید', 'error');
    await api.post(`/rider/rides/${ride.id}/rate`, { rating, comment: comment.value, tags: [...tags] });
    if (tip) {
      try { await api.post(`/rider/rides/${ride.id}/tip`, { amount: tip }); } catch (err) { toastError(err); }
    }
    toast('ممنون از بازخورد شما 🙏', 'success');
    refreshUser();
    showHome();
  });

  const paidLine = ride.paid_wallet && ride.paid_cash
    ? `${fa.toman(ride.paid_wallet)} از کیف پول + ${fa.toman(ride.paid_cash)} نقدی`
    : ride.paid_wallet ? 'پرداخت‌شده از کیف پول' : 'پرداخت نقدی به راننده';

  mount(sheet,
    h('div', { class: 'center' },
      h('div', { class: 'muted small' }, 'به مقصد رسیدید'),
      h('div', { style: { fontSize: '34px', fontWeight: 900 } }, fa.toman(ride.payable)),
      h('div', { class: 'muted small' }, paidLine),
      ride.paid_cash ? h('div', { class: 'badge yellow mt' }, `مبلغ نقدی: ${fa.toman(ride.paid_cash)}`) : null),
    h('details', { class: 'card mt' },
      h('summary', { class: 'bold', style: { cursor: 'pointer' } }, 'جزئیات کرایه'),
      h('div', { class: 'kv' }, h('span', {}, 'کرایه سفر'), h('span', {}, fa.toman(ride.fare_final - ride.wait_fee))),
      ride.wait_fee ? h('div', { class: 'kv' }, h('span', {}, 'هزینه توقف'), h('span', {}, fa.toman(ride.wait_fee))) : null,
      ride.surge > 1 ? h('div', { class: 'kv muted' }, h('span', {}, 'ضریب تقاضا'), h('span', {}, `×${fa.num(ride.surge)}`)) : null,
      ride.discount ? h('div', { class: 'kv' }, h('span', {}, 'تخفیف'), h('span', {}, `− ${fa.toman(ride.discount)}`)) : null,
      h('div', { class: 'kv total' }, h('span', {}, 'مبلغ نهایی'), h('span', {}, fa.toman(ride.payable)))),
    ride.driver ? h('div', { class: 'center mt-lg' },
      h('div', { class: 'row', style: { justifyContent: 'center' } }, avatar(ride.driver.name, 'lg')),
      h('h3', { class: 'mt' }, `سفر با ${ride.driver.name} چطور بود؟`)) : null,
    starInput((v) => { rating = v; drawTags(); }),
    tagBox,
    comment,
    h('div', { class: 'bold mt' }, 'انعام برای راننده (از کیف پول)'),
    tipChips,
    tipLine,
    submit,
    h('button', { class: 'btn btn-ghost btn-block mt', onclick: showHome }, 'بعداً'));
}

// Context passed to menu pages.
export const ctx = {
  api, S, showHome, showSearch, showOptions, setRide, refreshUser, loadPlaces, reverse,
  get map() { return S.map; },
};

boot().catch(toastError);
