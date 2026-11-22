import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  studioToday, addDays, zonedDateTimeToInstant, offsetFor, formatRfc3339Local,
  instantToZonedParts, weekWindow, formatSlotLabel
} from '../../worker/src/time.js';

const TZ = 'America/Los_Angeles';

test('weekWindow carries -07:00 at start and -08:00 at end across the 2026 fall-back', () => {
  assert.deepEqual(weekWindow('2026-10-26', TZ),
    { startAt: '2026-10-26T00:00:00-07:00', endAt: '2026-11-02T00:00:00-08:00' });
});

test('weekWindow carries -08:00 at start and -07:00 at end across the 2027 spring-forward', () => {
  assert.deepEqual(weekWindow('2027-03-08', TZ),
    { startAt: '2027-03-08T00:00:00-08:00', endAt: '2027-03-15T00:00:00-07:00' });
});

test('zonedDateTimeToInstant rejects a time inside the spring-forward gap', () => {
  assert.throws(() => zonedDateTimeToInstant('2027-03-14', '02:30', TZ), { name: 'RangeError', message: 'nonexistent_local_time' });
});

test('zonedDateTimeToInstant resolves an ambiguous fall-back time to the earlier instant', () => {
  assert.equal(zonedDateTimeToInstant('2027-11-07', '01:30', TZ).toISOString(), '2027-11-07T08:30:00.000Z');
});

test('zonedDateTimeToInstant converts a normal PST and PDT wall time', () => {
  assert.equal(zonedDateTimeToInstant('2026-11-27', '13:00', TZ).toISOString(), '2026-11-27T21:00:00.000Z');
  assert.equal(zonedDateTimeToInstant('2026-07-01', '10:00', TZ).toISOString(), '2026-07-01T17:00:00.000Z');
});

test('studioToday returns the Pacific date, not the UTC date', () => {
  assert.equal(studioToday(new Date('2026-11-23T07:30:00Z'), TZ), '2026-11-22');
  assert.equal(studioToday(new Date('2026-11-23T08:30:00Z'), TZ), '2026-11-23');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-11-23', -1), '2026-11-22');
});

test('offsetFor reports the zone offset at an instant', () => {
  assert.equal(offsetFor(new Date('2026-11-27T21:00:00Z'), TZ), '-08:00');
  assert.equal(offsetFor(new Date('2026-07-01T17:00:00Z'), TZ), '-07:00');
});

test('formatRfc3339Local formats a wall time with its own offset', () => {
  assert.equal(formatRfc3339Local('2026-11-23', '00:00', TZ), '2026-11-23T00:00:00-08:00');
  assert.equal(formatRfc3339Local('2026-11-01', '00:00', TZ), '2026-11-01T00:00:00-07:00');
});

test('instantToZonedParts returns date, time, offset and weekday in studio time', () => {
  assert.deepEqual(instantToZonedParts(new Date('2026-11-23T07:30:00Z'), TZ),
    { date: '2026-11-22', time: '23:30', offset: '-08:00', weekday: 'Sunday' });
});

test('formatSlotLabel renders 12-hour studio time', () => {
  assert.equal(formatSlotLabel(new Date('2026-11-27T21:00:00Z'), TZ), '1:00 PM');
  assert.equal(formatSlotLabel(new Date('2026-11-27T18:05:00Z'), TZ), '10:05 AM');
});

test('invalid calendar dates are rejected', () => {
  assert.throws(() => weekWindow('2026-02-30', TZ), RangeError);
  assert.throws(() => addDays('2026-13-01', 1), RangeError);
});
