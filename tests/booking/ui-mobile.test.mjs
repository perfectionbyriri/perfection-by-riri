import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stepFromHistory, summaryLine } from '../../New Perfection/js/booking/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, 'New Perfection', file), 'utf8');

const SERVICE = { service_id: 'svc_classic', name: 'Classic full set' };
const WEEK = { days: [{ date: '2026-11-26', weekday: 'Thursday' }, { date: '2026-11-27', weekday: 'Friday' }] };
const FULL = {
  serviceId: 'svc_classic',
  startAt: '2026-11-26T13:00:00-08:00',
  details: { first_name: 'Anna', email: 'anna@example.com' }
};

test('summaryLine joins service and short day with the slot label', () => {
  const line = summaryLine({ service: SERVICE, week: WEEK, startAt: '2026-11-26T13:00:00-08:00', startLabel: '1:00 PM' });
  assert.equal(line, 'Classic full set · Thu 26, 1:00 PM');
});

test('summaryLine shows only the service before a time is chosen', () => {
  assert.equal(summaryLine({ service: SERVICE, week: null, startAt: null, startLabel: null }), 'Classic full set');
});

test('summaryLine is empty before a service is chosen', () => {
  assert.equal(summaryLine({ service: null }), '');
});

test('summaryLine falls back to the service when the week no longer lists the day', () => {
  assert.equal(summaryLine({ service: SERVICE, week: WEEK, startAt: '2026-12-30T10:00:00-08:00', startLabel: '10:00 AM' }), 'Classic full set');
});

test('stepFromHistory restores a valid step and keeps the form values', () => {
  const result = stepFromHistory({ step: 3 }, FULL);
  assert.equal(result.step, 3);
  assert.deepEqual(result.details, FULL.details);
});

test('stepFromHistory with no history entry returns step 1', () => {
  assert.equal(stepFromHistory(null, FULL).step, 1);
  assert.equal(stepFromHistory({ step: 'x' }, FULL).step, 1);
  assert.equal(stepFromHistory({ step: 9 }, FULL).step, 1);
});

test('stepFromHistory never lands on a step whose data is missing', () => {
  assert.equal(stepFromHistory({ step: 2 }, { serviceId: null, details: {} }).step, 1);
  assert.equal(stepFromHistory({ step: 3 }, { serviceId: 'svc_classic', startAt: null, details: {} }).step, 2);
  assert.equal(stepFromHistory({ step: 4 }, { serviceId: 'svc_classic', startAt: FULL.startAt, details: {} }).step, 3);
});

test('stepFromHistory never returns the confirmation step', () => {
  assert.equal(stepFromHistory({ step: 5 }, { ...FULL, booking: { id: 'b1' } }).step, 1);
});

test('book page has the sticky bar and a summary sheet dialog', () => {
  const html = read('book/index.html');
  assert.match(html, /<div class="bk-bar"[^>]*id="bk-bar"[^>]*hidden/);
  assert.match(html, /id="bk-bar-summary"/);
  assert.match(html, /id="bk-bar-action"/);
  assert.match(html, /<dialog[^>]*id="bk-sheet"/);
  assert.match(html, /id="bk-sheet-close"/);
});

test('booking.css pads the bar with the safe-area inset and hides it on desktop', () => {
  const css = read('css/booking.css');
  assert.match(css, /\.bk-bar\s*\{[^}]*env\(safe-area-inset-bottom\)/s);
  assert.match(css, /@media \(min-width: 801px\)\s*\{[^}]*\.bk-bar\s*\{\s*display:\s*none/s);
  assert.match(css, /\.bk-sheet/);
});
