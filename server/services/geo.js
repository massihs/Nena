const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Rough lat/lng box around a point, used to pre-filter rows before the exact distance check.
export function bbox(lat, lng, km) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos(rad(lat)) || 1);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Tehran-like city driving: winding roads and heavy traffic.
export const ROAD_FACTOR = 1.35;
export const CITY_SPEED_KMH = 22;

export const etaMinutes = (straightKm) => Math.max(1, Math.round((straightKm * ROAD_FACTOR) / CITY_SPEED_KMH * 60 + 1));

// Google encoded polyline → [[lat, lng], ...] (used by Neshan).
export function decodePolyline(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
