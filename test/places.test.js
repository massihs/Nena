import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { normalizeFa, searchLocal, buildIndex, expandQuery } from '../server/services/places.js';

test('Persian normalization unifies letters, digits and half-spaces', () => {
  assert.equal(normalizeFa('سعادت‌آباد'), 'سعادت اباد');
  assert.equal(normalizeFa('بيمارستان كسري'), 'بیمارستان کسری');
  assert.equal(normalizeFa('خیابان ۱۶ آذر'), 'خیابان 16 اذر');
  assert.equal(expandQuery('خ ولیعصر'), 'خیابان ولیعصر');
  assert.equal(expandQuery('م ونک'), 'میدان ونک');
});

test('local search ranks by match quality and distance', () => {
  buildIndex([
    { id: 1, name: 'میدان ونک', aliases: [], category: 'square', address: 'ونک', lat: 35.7575, lng: 51.4096, popularity: 0 },
    { id: 2, name: 'ونک', aliases: [], category: 'neighbourhood', address: 'منطقه ۳', lat: 35.76, lng: 51.405, popularity: 0 },
    { id: 3, name: 'مجتمع تجاری کوروش', aliases: ['کورش'], category: 'mall', address: 'ستاری', lat: 35.7516, lng: 51.3038, popularity: 0 },
    { id: 4, name: 'میدان آزادی', aliases: [], category: 'square', address: 'تهران', lat: 35.6997, lng: 51.338, popularity: 0 },
    { id: 5, name: 'میدان آزادی', aliases: [], category: 'other', address: 'قزوین', lat: 36.27, lng: 50.0, popularity: 0 },
  ]);
  assert.equal(searchLocal('ونک')[0].id, 2, 'exact name first');
  assert.equal(searchLocal('م ونک')[0].id, 1, 'abbreviation expands');
  assert.equal(searchLocal('ونك')[0].id, 2, 'Arabic kaf matches');
  assert.equal(searchLocal('کورش')[0].id, 3, 'alias matches');
  assert.equal(searchLocal('کور')[0].id, 3, 'prefix matches');
  assert.equal(searchLocal('میدان آزادی', { lat: 35.7, lng: 51.34 })[0].id, 4, 'nearer duplicate first');
  assert.equal(searchLocal('میدان آزادی', { lat: 36.27, lng: 50.0 })[0].id, 5);
  assert.equal(searchLocal('میدان').length > 0, true);
  assert.deepEqual(searchLocal('x'), []);
});

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test('admin-added places are searchable and selections raise popularity', async () => {
  const admin = await t.login('09120000000');
  const rider = await t.login('09357777777');
  const add = await t.api(admin, 'POST', '/api/admin/places', {
    name: 'کافه نِنا تست', aliases: 'کافه آزمایشی', category: 'landmark', address: 'ونک، تهران', lat: 35.758, lng: 51.41,
  });
  assert.equal(add.status, 201);
  assert.equal((await t.api(admin, 'POST', '/api/admin/places', { name: 'کافه نِنا تست', category: 'landmark', lat: 35.7, lng: 51.4 })).status, 400);
  assert.equal((await t.api(rider, 'POST', '/api/admin/places', { name: 'x', lat: 35, lng: 51 })).status, 403);

  const { results } = await t.api(rider, 'GET', `/api/geo/search?q=${encodeURIComponent('کافه آزمایشی')}&lat=35.75&lng=51.41`);
  assert.equal(results[0].title, 'کافه نِنا تست');
  assert.equal(results[0].source, 'local');
  assert.ok(results[0].distance_km < 2);

  await t.api(rider, 'POST', '/api/geo/select', { id: results[0].id });
  await t.api(rider, 'POST', '/api/geo/select', { title: 'نانوایی سنگکی', address: 'یوسف آباد', lat: 35.73, lng: 51.40 });
  await t.api(rider, 'POST', '/api/geo/select', { title: 'خارج از ایران', lat: 48.8, lng: 2.3 });
  const list = (await t.api(admin, 'GET', '/api/admin/places?q=' + encodeURIComponent('نانوایی'))).places;
  assert.equal(list.length, 1);
  assert.equal(list[0].source, 'osm');
  const cafe = (await t.api(admin, 'GET', '/api/admin/places?q=' + encodeURIComponent('کافه'))).places[0];
  assert.equal(cafe.popularity, 1);
  assert.equal((await t.api(admin, 'GET', '/api/admin/places?q=' + encodeURIComponent('خارج'))).places.length, 0);

  await t.api(admin, 'PUT', `/api/admin/places/${cafe.id}`, { ...cafe, aliases: '', active: false });
  const after = await t.api(rider, 'GET', `/api/geo/search?q=${encodeURIComponent('کافه نِنا')}`);
  assert.ok(!after.results.some((r) => r.id === cafe.id), 'inactive places are hidden');
});
