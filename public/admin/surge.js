import { h, mount, icon, toast, toastError, modal, confirmDialog, busy } from '/shared/ui.js';
import { createMap } from '/shared/map.js';
import * as fa from '/shared/fa.js';
import { rampColor, RAMP_COLORS } from './charts.js';

const L = window.L;
// Persian week order, mapped to JS weekdays (0 = Sunday).
const DAYS = [[6, 'شنبه'], [0, 'یکشنبه'], [1, 'دوشنبه'], [2, 'سه‌شنبه'], [3, 'چهارشنبه'], [4, 'پنجشنبه'], [5, 'جمعه']];
const hhmm = (m) => fa.faDigits(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const PRESETS = [
  { label: 'اوج صبح (۷ تا ۱۰، روزهای کاری)', days: [6, 0, 1, 2, 3], start: 7 * 60, end: 10 * 60 },
  { label: 'اوج عصر (۱۷ تا ۲۰، روزهای کاری)', days: [6, 0, 1, 2, 3], start: 17 * 60, end: 20 * 60 },
  { label: 'شب جمعه (پنجشنبه ۲۰ تا ۲۴)', days: [4], start: 20 * 60, end: 0 },
  { label: 'همیشه', days: [], start: null, end: null },
];

function scheduleText(z) {
  const days = z.days.length ? DAYS.filter(([d]) => z.days.includes(d)).map(([, l]) => l).join('، ') : 'همه روزها';
  const time = z.start_minute == null ? 'تمام روز' : `${hhmm(z.start_minute)} تا ${hhmm(z.end_minute)}`;
  return `${days} • ${time}`;
}

export async function surgePage(ctx) {
  const { api, S } = ctx;
  const [{ settings: s }, { zones }, { ride_types: types }] = await Promise.all([
    api.get('/admin/settings'), api.get('/admin/surge/zones'), api.get('/admin/ride-types'),
  ]);
  const active = types.filter((t) => t.active);
  const main = S.main;
  const typeName = (k) => types.find((t) => t.key === k)?.name || k;

  // --- global controls ---
  const f = { surge_enabled: s.surge_enabled, surge_max: s.surge_max, surge_sensitivity: s.surge_sensitivity, surge_radius_km: s.surge_radius_km, surge_zone_max: s.surge_zone_max };
  const slider = (key, min, max, step, fmt) => {
    const out = h('b', { style: { minWidth: '56px', textAlign: 'left' } }, fmt(f[key]));
    const input = h('input', { type: 'range', min, max, step, value: f[key], oninput: (e) => { f[key] = Number(e.target.value); out.textContent = fmt(f[key]); } });
    return h('div', { class: 'slider-row' }, input, out);
  };
  const enabled = h('input', { type: 'checkbox', checked: f.surge_enabled, onchange: (e) => { f.surge_enabled = e.target.checked; } });
  const save = h('button', { class: 'btn btn-primary btn-block mt' }, 'ذخیره تنظیمات');
  save.onclick = () => busy(save, async () => {
    await api.put('/admin/settings', f);
    toast(f.surge_enabled ? 'تنظیمات افزایش قیمت ذخیره شد' : 'افزایش قیمت در کل سامانه خاموش شد', 'success');
    refreshMap();
  });
  const row = (label, hint, control) => h('div', { class: 'setting-row' }, h('div', {}, h('div', { class: 'bold' }, label), h('span', { class: 'hint' }, hint)), control);
  const controls = h('div', { class: 'card' },
    h('h3', {}, 'تنظیمات کلی'),
    row('افزایش قیمت فعال', 'کلید اصلی: با خاموش‌کردن، هیچ ضریبی (پویا یا محدوده‌ای) اعمال نمی‌شود', h('label', { class: 'switch' }, enabled, h('span'))),
    h('div', { class: 'mt' }, h('div', { class: 'bold small' }, 'سقف ضریب پویا'), h('span', { class: 'hint' }, 'بیشترین ضریبی که بر اساس تقاضا خودکار اعمال می‌شود'), slider('surge_max', 1, 3, 0.1, (v) => `×${fa.num(v, 1)}`)),
    h('div', { class: 'mt' }, h('div', { class: 'bold small' }, 'حساسیت به تقاضا'), h('span', { class: 'hint' }, 'افزایش ضریب به ازای هر درخواست بیشتر از رانندگان آزاد (به نسبت تعداد رانندگان)'), slider('surge_sensitivity', 0.05, 0.5, 0.05, (v) => `+${fa.num(v, 2)}`)),
    h('div', { class: 'mt' }, h('div', { class: 'bold small' }, 'شعاع سنجش تقاضا'), h('span', { class: 'hint' }, 'درخواست‌ها و رانندگان در این فاصله از مبدأ شمرده می‌شوند'), slider('surge_radius_km', 1, 8, 0.5, (v) => `${fa.num(v, 1)} کم`)),
    h('div', { class: 'mt' }, h('div', { class: 'bold small' }, 'سقف نهایی هر ضریب'), h('span', { class: 'hint' }, 'هیچ ضریبی، حتی محدوده‌های دستی، از این بیشتر نمی‌شود'), slider('surge_zone_max', 1, 5, 0.1, (v) => `×${fa.num(v, 1)}`)),
    save);

  // --- live map ---
  const mapEl = h('div', { class: 'surge-map' });
  let mapType = active[0]?.key || 'eco';
  const typeTabs = h('div', { class: 'tabs' });
  const drawTabs = () => mount(typeTabs, active.map((t) => h('button', { class: t.key === mapType ? 'active' : '', onclick: () => { mapType = t.key; drawTabs(); refreshMap(); } }, t.name)));
  drawTabs();
  const preview = h('div', { class: 'card' }, h('h3', {}, 'ضریب در یک نقطه'), h('p', { class: 'muted small' }, 'روی نقشه کلیک کنید تا ضریب فعلی هر سرویس و دلیل آن را ببینید.'));
  const legend = h('div', { class: 'col gap-sm', style: { alignItems: 'flex-end' } },
    h('div', { class: 'ramp-legend' }, h('span', {}, '×۱'), RAMP_COLORS.map((c) => h('i', { style: { background: c } })), h('span', {}, `×${fa.num(f.surge_zone_max, 1)}`)),
    h('div', { class: 'tiny muted' }, 'مربع: ضریب پویای لحظه‌ای • دایره: محدوده دستی'));

  const zoneList = h('div', {});

  mount(main,
    h('div', { class: 'row between wrap' },
      h('h1', { style: { margin: 0 } }, 'افزایش قیمت (ضریب تقاضا)'),
      h('button', { class: 'btn btn-primary', onclick: () => zoneEditor(ctx, null, active, reload) }, icon('plus'), 'محدوده جدید')),
    h('p', { class: 'muted small mt' }, 'ضریب نهایی هر سفر = بیشترِ «ضریب پویا» (بر اساس نسبت درخواست به راننده آزاد) و «ضریب محدوده‌های دستی»، با سقف نهایی. سفرهای رزروی فقط ضریب محدوده‌ها در زمان سفر را می‌گیرند.'),
    h('div', { class: 'grid-2 mt' },
      h('div', {},
        h('div', { class: 'row between wrap mb' }, typeTabs, legend),
        mapEl),
      h('div', { class: 'col' }, controls, preview)),
    h('div', { class: 'section-title' }, h('h2', {}, 'محدوده‌های دستی'), h('span', { class: 'muted small' }, 'برای رویدادها، ساعات اوج یا مناطق پرتقاضا')),
    zoneList);

  const map = createMap(mapEl, S.cfg);
  const cellLayer = L.layerGroup().addTo(map);
  const zoneLayer = L.layerGroup().addTo(map);
  let clickMarker = null;

  let fitted = false;
  function drawZones(list) {
    zoneLayer.clearLayers();
    const shown = list.filter((x) => x.active);
    for (const z of shown) {
      L.circle([z.lat, z.lng], { radius: z.radius_km * 1000, color: '#000', weight: 1.5, dashArray: '5 5', fillColor: rampColor(z.multiplier, 1, f.surge_zone_max), fillOpacity: 0.35 })
        .bindTooltip(`${z.name} — ×${fa.num(z.multiplier, 1)}<br>${scheduleText(z)}`).addTo(zoneLayer);
    }
    if (!fitted && shown.length) {
      map.fitBounds(L.featureGroup(zoneLayer.getLayers()).getBounds().pad(0.2), { maxZoom: 13 });
      fitted = true;
    }
  }

  async function refreshMap() {
    if (!mapEl.isConnected) return;
    try {
      const { cells, max, enabled: on } = await api.get(`/admin/surge/map?type=${mapType}`);
      cellLayer.clearLayers();
      // Squares show live, demand-driven surge; manual zones are drawn as circles.
      for (const c of cells) {
        if (c.dynamic <= 1) continue;
        L.rectangle([[c.south, c.west], [c.north, c.east]], { stroke: false, fillColor: rampColor(c.dynamic, 1, max), fillOpacity: 0.5 })
          .bindTooltip(`ضریب پویا ×${fa.num(c.dynamic, 1)} — ${fa.num(c.demand)} درخواست باز، ${fa.num(c.supply)} راننده آزاد${c.zone ? `<br>محدوده: ${c.zone}` : ''}`)
          .addTo(cellLayer);
      }
      if (!on) toast('افزایش قیمت خاموش است');
    } catch (err) { toastError(err); }
  }

  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    clickMarker?.remove();
    clickMarker = L.circleMarker([lat, lng], { radius: 7, color: '#000', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(map);
    try {
      const { services } = await api.get(`/admin/surge/preview?lat=${lat}&lng=${lng}`);
      mount(preview,
        h('h3', {}, 'ضریب در نقطه انتخابی'),
        services.map((x) => h('div', { class: 'kv' },
          h('span', {}, h('b', {}, x.name), h('span', { class: 'tiny muted' }, x.enabled
            ? ` — پویا ×${fa.num(x.dynamic, 1)} (${fa.num(x.demand)} درخواست / ${fa.num(x.supply)} راننده)${x.zone ? ` • محدوده «${x.zone.name}» ×${fa.num(x.zone.multiplier, 1)}` : ''}`
            : ' — خاموش')),
          h('span', { class: 'bold' }, `×${fa.num(x.multiplier, 1)}`))),
        h('button', { class: 'btn btn-sm mt', onclick: () => zoneEditor(ctx, { lat, lng }, active, reload) }, icon('plus'), 'محدوده جدید در این نقطه'));
    } catch (err) { toastError(err); }
  });

  async function reload() {
    const { zones: list } = await api.get('/admin/surge/zones');
    renderZones(list);
    drawZones(list);
    refreshMap();
  }

  function renderZones(list) {
    mount(zoneList, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['نام', 'ضریب', 'شعاع', 'سرویس‌ها', 'زمان', 'فعال', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.length ? list.map((z) => h('tr', {},
        h('td', { class: 'bold' }, z.name),
        h('td', {}, h('span', { class: 'badge blue' }, `×${fa.num(z.multiplier, 1)}`)),
        h('td', {}, `${fa.num(z.radius_km, 1)} کم`),
        h('td', {}, z.ride_types.length ? z.ride_types.map(typeName).join('، ') : 'همه'),
        h('td', { class: 'small' }, scheduleText(z)),
        h('td', {}, h('input', {
          type: 'checkbox', checked: z.active,
          onchange: (e) => api.put(`/admin/surge/zones/${z.id}`, { ...z, active: e.target.checked }).then(() => { toast('ذخیره شد'); reload(); }).catch(toastError),
        })),
        h('td', {},
          h('button', { class: 'btn btn-sm', onclick: () => { map.flyTo([z.lat, z.lng], 13); zoneEditor(ctx, z, active, reload); } }, 'ویرایش'), ' ',
          h('button', {
            class: 'btn btn-sm btn-danger-soft',
            onclick: async () => { if (await confirmDialog('حذف محدوده', z.name, { danger: true })) { await api.del(`/admin/surge/zones/${z.id}`); reload(); } },
          }, 'حذف'))))
        : h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'هنوز محدوده‌ای تعریف نشده؛ روی «محدوده جدید» بزنید یا روی نقشه کلیک کنید.'))))));
  }

  renderZones(zones);
  drawZones(zones);
  refreshMap();
  clearInterval(S.liveTimer);
  S.liveTimer = setInterval(refreshMap, 20000);
}

function zoneEditor(ctx, zone, types, reload) {
  const { api, S } = ctx;
  const editing = zone?.id != null;
  const f = editing ? { ...zone } : {
    name: '', lat: zone?.lat ?? S.cfg.map.center[0], lng: zone?.lng ?? S.cfg.map.center[1], radius_km: 2, multiplier: 1.5,
    ride_types: [], days: [], start_minute: null, end_minute: null, active: true,
  };
  modal((close) => {
    const mapEl = h('div', { style: { height: '240px', borderRadius: '12px', overflow: 'hidden' } });
    const multOut = h('b', {}, `×${fa.num(f.multiplier, 1)}`);
    const radOut = h('b', {}, `${fa.num(f.radius_km, 1)} کم`);
    let circle;
    const typeBox = h('div', { class: 'chips', style: { flexWrap: 'wrap' } });
    const drawTypes = () => mount(typeBox,
      h('button', { type: 'button', class: `chip ${f.ride_types.length ? '' : 'active'}`, onclick: () => { f.ride_types = []; drawTypes(); } }, 'همه سرویس‌ها'),
      types.map((t) => h('button', {
        type: 'button', class: `chip ${f.ride_types.includes(t.key) ? 'active' : ''}`,
        onclick: () => { f.ride_types = f.ride_types.includes(t.key) ? f.ride_types.filter((k) => k !== t.key) : [...f.ride_types, t.key]; drawTypes(); },
      }, t.name)));
    const dayBox = h('div', { class: 'day-chips' });
    const drawDays = () => mount(dayBox, DAYS.map(([d, l]) => h('button', {
      type: 'button', class: `chip ${f.days.includes(d) ? 'active' : ''}`,
      onclick: () => { f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d]; drawDays(); },
    }, l)));
    const timeSel = (key) => {
      const sel = h('select', { class: 'input', onchange: (e) => { f[key] = e.target.value === '' ? null : Number(e.target.value); } },
        h('option', { value: '' }, '—'));
      for (let m = 0; m < 1440; m += 30) sel.append(h('option', { value: m, selected: f[key] === m }, hhmm(m)));
      return sel;
    };
    const timeBox = h('div', { class: 'row' });
    const drawTime = () => mount(timeBox, h('div', { class: 'field grow' }, h('label', {}, 'از ساعت'), timeSel('start_minute')), h('div', { class: 'field grow' }, h('label', {}, 'تا ساعت'), timeSel('end_minute')));
    drawTypes(); drawDays(); drawTime();

    const save = h('button', { class: 'btn btn-primary btn-lg btn-block mt' }, editing ? 'ذخیره' : 'ایجاد محدوده');
    save.onclick = () => busy(save, async () => {
      await (editing ? api.put(`/admin/surge/zones/${zone.id}`, f) : api.post('/admin/surge/zones', f));
      toast('محدوده ذخیره شد', 'success');
      close();
      reload();
    });

    setTimeout(() => {
      const map = createMap(mapEl, { map: { ...S.cfg.map, center: [f.lat, f.lng], zoom: 12 } });
      const marker = L.marker([f.lat, f.lng], { draggable: true }).addTo(map);
      circle = L.circle([f.lat, f.lng], { radius: f.radius_km * 1000, color: '#000', weight: 2, fillColor: '#2a78d6', fillOpacity: 0.15 }).addTo(map);
      const move = (ll) => { f.lat = ll.lat; f.lng = ll.lng; marker.setLatLng(ll); circle.setLatLng(ll); };
      marker.on('drag', () => move(marker.getLatLng()));
      map.on('click', (e) => move(e.latlng));
      map.fitBounds(circle.getBounds(), { padding: [20, 20] });
    }, 50);

    return h('div', {},
      h('h3', {}, editing ? 'ویرایش محدوده' : 'محدوده افزایش قیمت'),
      h('div', { class: 'field' }, h('label', {}, 'نام'), h('input', { class: 'input', value: f.name, placeholder: 'مثلاً کنسرت برج میلاد', oninput: (e) => { f.name = e.target.value; } })),
      h('div', { class: 'field' }, h('label', {}, 'مرکز و شعاع (روی نقشه کلیک کنید یا نشانگر را بکشید)'), mapEl),
      h('div', { class: 'field' }, h('label', {}, 'شعاع'), h('div', { class: 'slider-row' },
        h('input', { type: 'range', min: 0.5, max: 15, step: 0.5, value: f.radius_km, oninput: (e) => { f.radius_km = Number(e.target.value); radOut.textContent = `${fa.num(f.radius_km, 1)} کم`; circle?.setRadius(f.radius_km * 1000); } }), radOut)),
      h('div', { class: 'field' }, h('label', {}, 'ضریب کرایه'), h('div', { class: 'slider-row' },
        h('input', { type: 'range', min: 1.1, max: 5, step: 0.1, value: f.multiplier, oninput: (e) => { f.multiplier = Number(e.target.value); multOut.textContent = `×${fa.num(f.multiplier, 1)}`; } }), multOut),
        h('span', { class: 'hint' }, 'سقف نهایی تنظیمات کلی همچنان اعمال می‌شود.')),
      h('div', { class: 'field' }, h('label', {}, 'سرویس‌ها'), typeBox),
      h('div', { class: 'field' }, h('label', {}, 'الگوی آماده'), h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, PRESETS.map((p) => h('button', {
        type: 'button', class: 'chip', onclick: () => { f.days = [...p.days]; f.start_minute = p.start; f.end_minute = p.end; drawDays(); drawTime(); },
      }, p.label)))),
      h('div', { class: 'field' }, h('label', {}, 'روزها (هیچ‌کدام = همه روزها)'), dayBox),
      timeBox,
      h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: f.active !== false, onchange: (e) => { f.active = e.target.checked; } }), 'فعال'),
      save,
      h('button', { class: 'btn btn-ghost btn-block mt', onclick: close }, 'انصراف'));
  });
}
