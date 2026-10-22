// Looks up coordinates for the curated places list on OpenStreetMap (Nominatim, ≤1 req/s)
// and writes server/data/places.json. Usage: node scripts/build-places.js
import fs from 'node:fs';
import { CITY, PLACES } from './places-list.js';
import { normalizeFa } from '../server/services/places.js';

const OUT = new URL('../server/data/places.json', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Words that describe the kind of place rather than its name.
const GENERIC = new Set(['میدان', 'مترو', 'ایستگاه', 'خیابان', 'بزرگراه', 'بلوار', 'بیمارستان', 'دانشگاه', 'مرکز', 'خرید', 'مجتمع', 'تجاری',
  'پارک', 'بوستان', 'ترمینال', 'فرودگاه', 'کاخ', 'موزه', 'هتل', 'شمالی', 'جنوبی', 'واحد', 'پاساژ', 'بازار', 'باغ', 'برج', 'سفارت', 'تهران']);

// OSM classes accepted for each of our categories (Nominatim jsonv2 `category`/`type`).
const KIND_OK = {
  square: (r) => (r.category === 'place' && r.type === 'square') || r.category === 'highway' || r.category === 'junction',
  metro: (r) => ['railway', 'public_transport'].includes(r.category),
  neighbourhood: (r) => ['place', 'boundary'].includes(r.category),
  mall: (r) => ['shop', 'building', 'amenity', 'landuse'].includes(r.category),
  hospital: (r) => (r.category === 'amenity' && ['hospital', 'clinic'].includes(r.type)) || r.category === 'healthcare' || (r.category === 'building' && r.type === 'hospital'),
  university: (r) => (r.category === 'amenity' && ['university', 'college'].includes(r.type)) || (r.category === 'building' && r.type === 'university') || r.category === 'landuse',
  transport: (r) => ['aeroway', 'railway', 'public_transport'].includes(r.category) || (r.category === 'amenity' && r.type === 'bus_station'),
  street: (r) => r.category === 'highway',
  landmark: () => true,
};

// OSM writes the city as "شهر تهران".
const inCity = (r) => normalizeFa(r.address?.city || r.address?.town || '').replace(/^شهر /, '') === normalizeFa(CITY.name);

async function lookup(q, wide = false) {
  const [minLng, maxLat, maxLng, minLat] = wide ? CITY.wideViewbox : CITY.viewbox;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q, format: 'jsonv2', addressdetails: '1', namedetails: '1', limit: '10', countrycodes: 'ir', 'accept-language': 'fa',
    viewbox: `${minLng},${maxLat},${maxLng},${minLat}`, bounded: '1',
  });
  const res = await fetch(url, { headers: { 'User-Agent': 'NenaRideApp/1.0 (places seed)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function addressOf(a = {}) {
  const parts = [a.neighbourhood || a.suburb || a.quarter, a.road, a.city_district, a.city || a.town || CITY.name];
  return [...new Set(parts.filter(Boolean))].join('، ');
}

// Pass --keep to reuse coordinates already in places.json and only look up new entries.
const old = process.argv.includes('--keep') && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const known = new Map(old.map((p) => [`${p.category}:${p.name}`, p]));
const out = [];
const failed = [];

for (const [category, entries] of Object.entries(PLACES)) {
  for (const entry of entries) {
    const [name, ...aliases] = entry.split('|');
    const key = `${category}:${name}`;
    if (known.has(key)) { out.push({ ...known.get(key), aliases }); continue; }
    try {
      const base = name.replace(/^(مترو|مرکز خرید|مجتمع تجاری|پاساژ)\s+/, '');
      // OSM often names things differently: "ایستگاه X" for metro, "کریم خان" vs "کریمخان", a missing "شهید".
      const variants = [...new Set([
        category === 'neighbourhood' ? `${name} ${CITY.name}` : name,
        ...(category === 'metro' ? [`ایستگاه مترو ${base}`, `ایستگاه ${base}`] : []),
        ...(category === 'street' ? [name.replace(/^(\S+) /, '$1 شهید ')] : []),
        // Tehran parks are officially "بوستان": "پارک ملت" is "بوستان ملت" in OSM.
        ...(/^(پارک|بوستان) /.test(name) ? [name.replace(/^پارک /, '\u0000').replace(/^بوستان /, 'پارک ').replace('\u0000', 'بوستان ')] : []),
        ...(category !== 'metro' && category !== 'street' && base !== name ? [base] : []),
        ...aliases,
      ])];
      const want = normalizeFa(base).split(' ');
      const exactBase = normalizeFa(base).replace(/ /g, '');
      const names = (r) => [r.name, r.namedetails?.name, r.namedetails?.['name:fa']].filter(Boolean).map((x) => normalizeFa(x));
      const matches = (r) => {
        // The search box also covers satellite towns (Andisheh, Qarchak…) with same-named places.
        if (category !== 'transport' && !inCity(r)) return false;
        const all = names(r).join(' ');
        if (category === 'metro') {
          // Station names must match exactly: "امام خمینی" is not "مصلی امام خمینی".
          const stripped = names(r).map((x) => x.replace(/^(ایستگاه )?(مترو )?/, '').replace(/ /g, ''));
          return (KIND_OK.metro(r) || (r.category === 'highway' && r.type === 'bus_stop')) && stripped.includes(exactBase);
        }
        if (category === 'neighbourhood') {
          if (KIND_OK.neighbourhood(r)) return names(r).some((x) => x.replace(/ /g, '') === exactBase);
          // Otherwise accept a road whose suburb is exactly this neighbourhood ("پاسداران - ضرابخانه" ✓, "دولت آباد" ✗).
          const parts = [r.address?.neighbourhood, r.address?.suburb, r.address?.quarter].filter(Boolean)
            .flatMap((x) => x.split(/[-–]/)).map((x) => normalizeFa(x).replace(/ /g, ''));
          return parts.includes(exactBase);
        }
        // Every word must appear as a word; longer ones may also be glued ("کریمخان" ~ "کریم خان").
        const syn = (x) => x.replace(/بوستان/g, 'پارک');
        const words = syn(all).split(' ');
        const glued = syn(all).replace(/ /g, '');
        if (KIND_OK[category](r)) return want.map(syn).every((w) => words.includes(w) || (w.length > 3 && glued.includes(w)));
        // A stop named exactly like the place sits at its entrance: a good pickup point.
        const isStop = (r.category === 'highway' && r.type === 'bus_stop') || r.category === 'public_transport';
        return isStop && names(r).some((x) => x.replace(/ /g, '') === normalizeFa(name).replace(/ /g, ''));
      };
      // Among streets prefer the most important road class.
      const ROAD_RANK = { motorway: 5, trunk: 4, primary: 3, secondary: 2, tertiary: 1 };
      let hit = null;
      for (const [i, q] of variants.entries()) {
        if (i) await sleep(1100);
        const ok = (await lookup(q, category === 'transport')).filter(matches);
        hit = category === 'street' ? ok.sort((x, y) => (ROAD_RANK[y.type] || 0) - (ROAD_RANK[x.type] || 0))[0] : ok[0];
        if (hit) break;
      }
      if (!hit) { failed.push(entry); console.log('✗', entry); } else {
        out.push({ name, aliases, category, address: addressOf(hit.address), lat: Number(Number(hit.lat).toFixed(6)), lng: Number(Number(hit.lon).toFixed(6)) });
        console.log('✓', entry);
      }
    } catch (err) {
      failed.push(entry);
      console.log('!', entry, err.message);
    }
    await sleep(1100);
  }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/},{/g, '},\n{') + '\n');
console.log(`\n${out.length} places written, ${failed.length} not found:`, failed.join('، '));
