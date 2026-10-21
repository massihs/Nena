import { config } from '../config.js';
import { haversineKm, ROAD_FACTOR, CITY_SPEED_KMH, decodePolyline } from './geo.js';

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function estimate(points) {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  const distance_km = km * ROAD_FACTOR;
  return {
    distance_km,
    duration_min: (distance_km / CITY_SPEED_KMH) * 60 + 2 * (points.length - 1),
    geometry: points.map((p) => [p.lat, p.lng]),
    provider: 'estimate',
  };
}

async function osrm(points) {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const res = await fetch(`${config.routing.osrmUrl}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`, {
    signal: AbortSignal.timeout(4000),
  });
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('no route');
  return {
    distance_km: route.distance / 1000,
    // OSRM has no live traffic; scale up to match city conditions.
    duration_min: (route.duration / 60) * 1.5,
    geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    provider: 'osrm',
  };
}

async function neshan(points) {
  const origin = points[0];
  const dest = points[points.length - 1];
  const waypoints = points.slice(1, -1).map((p) => `${p.lat},${p.lng}`).join('|');
  const url = new URL('https://api.neshan.org/v4/direction');
  url.searchParams.set('type', 'car');
  url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destination', `${dest.lat},${dest.lng}`);
  if (waypoints) url.searchParams.set('waypoints', waypoints);
  const res = await fetch(url, { headers: { 'Api-Key': config.neshanKey }, signal: AbortSignal.timeout(4000) });
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('no route');
  let meters = 0, seconds = 0;
  for (const leg of route.legs) { meters += leg.distance.value; seconds += leg.duration.value; }
  return {
    distance_km: meters / 1000,
    duration_min: seconds / 60,
    geometry: decodePolyline(route.overview_polyline.points),
    provider: 'neshan',
  };
}

export async function getRoute(points) {
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_TTL) return hit.route;

  let route;
  try {
    if (config.routing.provider === 'osrm') route = await osrm(points);
    else if (config.routing.provider === 'neshan' && config.neshanKey) route = await neshan(points);
  } catch (err) {
    console.warn(`[routing] ${config.routing.provider} failed, using estimate:`, err.message);
  }
  route ??= estimate(points);
  route.distance_km = Math.round(route.distance_km * 10) / 10;
  route.duration_min = Math.max(1, Math.round(route.duration_min));

  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), route });
  return route;
}
