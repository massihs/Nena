import { h, listItem } from './ui.js';
import { num } from './fa.js';

const ICONS = {
  square: 'pin', metro: 'train', neighbourhood: 'home', mall: 'bag', hospital: 'hospital', university: 'school',
  transport: 'plane', landmark: 'star', street: 'road', other: 'pin',
};
const LABELS = {
  square: 'میدان', metro: 'ایستگاه مترو', neighbourhood: 'محله', mall: 'مرکز خرید', hospital: 'بیمارستان', university: 'دانشگاه',
  transport: 'فرودگاه و پایانه', landmark: 'مکان دیدنی', street: 'خیابان', other: 'مکان',
};
export const categoryLabel = (c) => LABELS[c] || LABELS.other;

const distanceText = (km) => (km == null ? '' : km < 1 ? `${num(Math.round(km * 1000 / 50) * 50, 0)} متر` : `${num(km, 1)} کیلومتر`);

// One geocoder search result; picking it also tells the server, which ranks popular places higher.
export function placeResult(api, it, onPick) {
  return listItem({
    iconName: ICONS[it.category] || 'pin',
    title: it.title,
    sub: [it.address, it.source === 'local' ? categoryLabel(it.category) : null].filter(Boolean).join(' • '),
    end: it.distance_km != null ? h('span', { class: 'tiny muted', style: { whiteSpace: 'nowrap' } }, distanceText(it.distance_km)) : null,
    onclick: () => {
      api.post('/geo/select', { id: it.id, title: it.title, address: it.address, lat: it.lat, lng: it.lng }).catch(() => {});
      onPick({ lat: it.lat, lng: it.lng, address: [it.title, it.address].filter(Boolean).join('، ') });
    },
  });
}
