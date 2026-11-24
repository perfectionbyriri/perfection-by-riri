import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, confirmedRows, readStoredBooking } from '../../New Perfection/js/booking/confirmed.js';

function store(value) {
  return { getItem: (key) => (key === STORAGE_KEY ? value : null) };
}

test('readStoredBooking returns the booking only when its id matches ?ref=', () => {
  const raw = JSON.stringify({ id: 'bk_1', service: 'Lash lift', when: 'Thursday, November 27 · 1:00 PM' });
  assert.deepEqual(readStoredBooking(store(raw), 'bk_1'), { id: 'bk_1', service: 'Lash lift', when: 'Thursday, November 27 · 1:00 PM' });
  assert.equal(readStoredBooking(store(raw), 'bk_2'), null);
  assert.equal(readStoredBooking(store(raw), null), null);
});

test('readStoredBooking survives missing, broken or blocked storage', () => {
  assert.equal(readStoredBooking(undefined, 'bk_1'), null);
  assert.equal(readStoredBooking(store(null), 'bk_1'), null);
  assert.equal(readStoredBooking(store('{not json'), 'bk_1'), null);
  assert.equal(readStoredBooking({ getItem() { throw new Error('blocked'); } }, 'bk_1'), null);
});

test('confirmedRows lists the treatment, the Pacific time and the reference', () => {
  assert.deepEqual(confirmedRows({ id: 'bk_1', service: 'Lash lift', when: 'Thursday, November 27 · 1:00 PM' }), [
    ['Treatment', 'Lash lift'],
    ['Date & time', 'Thursday, November 27 · 1:00 PM Pacific Time'],
    ['Booking reference', 'bk_1']
  ]);
  assert.deepEqual(confirmedRows({ id: 'bk_1', service: '', when: '' }), [['Booking reference', 'bk_1']]);
});
