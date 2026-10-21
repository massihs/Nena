// Leaflet helpers. Leaflet is loaded globally from /vendor/leaflet/leaflet.js.
const L = window.L;

export function createMap(el, cfg) {
  const map = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: false })
    .setView(cfg.map.center, cfg.map.zoom);
  L.tileLayer(cfg.map.tileUrl, { attribution: cfg.map.attribution, maxZoom: 19, subdomains: 'abc' }).addTo(map);
  map.attributionControl.setPrefix(false);
  return map;
}

const CAR_TOP = (color) => `<svg viewBox="0 0 40 40"><rect x="12" y="4" width="16" height="32" rx="6" fill="${color}"/>
  <rect x="14" y="10" width="12" height="6" rx="2" fill="#9fc3ff"/><rect x="14" y="27" width="12" height="4" rx="1.5" fill="#9fc3ff"/>
  <rect x="13" y="18" width="14" height="8" rx="1" fill="${color}" stroke="#fff" stroke-opacity=".25"/></svg>`;
const BIKE_TOP = `<svg viewBox="0 0 40 40"><rect x="17" y="5" width="6" height="30" rx="3" fill="#e11900"/>
  <rect x="12" y="10" width="16" height="3" rx="1.5" fill="#222"/><circle cx="20" cy="22" r="4" fill="#222"/></svg>`;

export function carIcon(type = 'eco', heading = 0) {
  const svg = type === 'bike' ? BIKE_TOP : CAR_TOP(type === 'van' ? '#1d3fa6' : type === 'plus' ? '#444' : '#111');
  return L.divIcon({
    className: 'car-marker',
    html: `<div class="car-rot" style="transform:rotate(${heading || 0}deg)">${svg}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export function setHeading(marker, heading) {
  const el = marker.getElement()?.querySelector('.car-rot');
  if (el && heading != null) el.style.transform = `rotate(${heading}deg)`;
}

export function pinIcon(kind = 'o', label = '') {
  return L.divIcon({
    className: 'pin-marker',
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">${label ? `<div class="pin-label">${label}</div>` : ''}<div class="pm ${kind}"></div></div>`,
    iconSize: [160, 60],
    iconAnchor: [80, label ? 50 : 30],
  });
}

export const meIcon = () => L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });

export function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

// Smoothly moves a marker to a new position.
export function animateTo(marker, to, ms = 1000) {
  const from = marker.getLatLng();
  const start = performance.now();
  cancelAnimationFrame(marker._anim);
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    marker.setLatLng([from.lat + (to.lat - from.lat) * k, from.lng + (to.lng - from.lng) * k]);
    if (k < 1) marker._anim = requestAnimationFrame(step);
  };
  marker._anim = requestAnimationFrame(step);
}

export function routeLayer(coords, { dashed = false } = {}) {
  const group = L.layerGroup();
  if (!coords?.length) return group;
  L.polyline(coords, { color: '#fff', weight: 9, opacity: 0.9 }).addTo(group);
  L.polyline(coords, { color: '#000', weight: 5, dashArray: dashed ? '2 10' : null, lineCap: 'round' }).addTo(group);
  return group;
}

// Fits points into the part of the map not covered by the sheet.
export function fitTo(map, points, sheet) {
  const pts = points.filter(Boolean).map((p) => (Array.isArray(p) ? p : [p.lat, p.lng]));
  if (!pts.length) return;
  const desktop = window.innerWidth >= 900;
  const sheetH = sheet?.offsetHeight || 0;
  const sheetW = sheet?.offsetWidth || 0;
  const opts = desktop
    ? { paddingTopLeft: [60, 100], paddingBottomRight: [sheetW + 60, 60], maxZoom: 16 }
    : { paddingTopLeft: [40, 90], paddingBottomRight: [40, sheetH + 30], maxZoom: 16 };
  if (pts.length === 1) {
    map.setView(pts[0], 16);
    return;
  }
  map.fitBounds(L.latLngBounds(pts), opts);
}

export function getPosition({ timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}
