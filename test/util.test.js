import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, isValidNationalId, normalizeSheba, toEnDigits } from '../server/util.js';
import { decodePolyline } from '../server/services/geo.js';
import { nationalId } from './helpers.js';

test('normalizePhone accepts Iranian formats and Persian digits', () => {
  assert.equal(normalizePhone('09121234567'), '09121234567');
  assert.equal(normalizePhone('+989121234567'), '09121234567');
  assert.equal(normalizePhone('00989121234567'), '09121234567');
  assert.equal(normalizePhone('9121234567'), '09121234567');
  assert.equal(normalizePhone('۰۹۱۲ ۱۲۳ ۴۵۶۷'), '09121234567');
  assert.equal(normalizePhone('02112345678'), null);
  assert.equal(normalizePhone('0912123'), null);
});

test('national id checksum', () => {
  assert.equal(isValidNationalId(nationalId(123456789)), true);
  assert.equal(isValidNationalId('0000000000'), false);
  assert.equal(isValidNationalId('1234567890'), false);
  assert.equal(isValidNationalId('0499370899'), true);
});

test('sheba validation', () => {
  assert.equal(normalizeSheba('IR062960000000100324200001'), 'IR062960000000100324200001');
  assert.equal(normalizeSheba('062960000000100324200001'), 'IR062960000000100324200001');
  assert.equal(normalizeSheba('IR062960000000100324200002'), null);
});

test('digits and polyline', () => {
  assert.equal(toEnDigits('۱۲۳٤٥'), '12345');
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});
