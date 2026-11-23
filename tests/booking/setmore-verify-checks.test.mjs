import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDIO_HOURS, applyMap, findSlotConflicts, isBlocking, mapCatalog, slotsOutsideHours, slugId
} from '../../worker/tools/setmore-verify/checks.js';
import { MOCK_SERVICES } from '../../worker/src/setmore/fixtures.js';

test('slugId reproduces every placeholder id in the Setmore fixtures', () => {
  for (const service of MOCK_SERVICES) assert.equal(slugId(service.title), service.id);
});

test('mapCatalog matches by slugged title and reports gaps', () => {
  const r = mapCatalog([{ service_id: 'svc_lip_blushing' }, { service_id: 'svc_missing' }], [
    { id: 'real-1', title: 'Lip Blushing', duration: 150, cost: 450, buffer: { before: 0, after: 15 }, provider_ids: ['p'], visibility: 'PUBLIC' },
    { id: 'real-2', title: 'Brow Tint', duration: 20, cost: 30, buffer: { before: 0, after: 0 }, provider_ids: ['p'], visibility: 'PUBLIC' }
  ]);
  assert.equal(r.map[0].id, 'real-1');
  assert.equal(r.map[0].placeholder, 'svc_lip_blushing');
  assert.equal(r.map[0].buffer_after, 15);
  assert.deepEqual(r.unmatched, ['svc_missing']);
  assert.deepEqual(r.unlisted, ['Brow Tint']);
});

test('mapCatalog keeps entries that already carry a real Setmore id', () => {
  const r = mapCatalog([{ service_id: 'real-1' }], [{ id: 'real-1', title: 'Lip Blushing' }]);
  assert.equal(r.map[0].id, 'real-1');
  assert.deepEqual(r.unmatched, []);
});

test('mapCatalog flags two Setmore titles with the same slug as ambiguous', () => {
  const r = mapCatalog([{ service_id: 'svc_lash_lift' }], [{ id: 'a', title: 'Lash Lift' }, { id: 'b', title: 'Lash  lift' }]);
  assert.deepEqual(r.ambiguous, ['svc_lash_lift']);
  assert.equal(r.map.length, 0);
});

test('isBlocking ignores only cancelled or deleted bookings', () => {
  assert.equal(isBlocking({ status: 'cancelled' }), false);
  assert.equal(isBlocking({ status: 'CANCELED' }), false);
  assert.equal(isBlocking({ status: 'DELETED' }), false);
  assert.equal(isBlocking({ status: 'CONFIRMED' }), true);
  assert.equal(isBlocking({}), true);
});

test('findSlotConflicts: overlap conflicts, touching edges do not, cancelled ignored, unknown status blocks', () => {
  const days = { '2026-12-01': [
    { start_at: '2026-12-01T10:00:00-08:00', end_at: '2026-12-01T11:00:00-08:00' },
    { start_at: '2026-12-01T11:00:00-08:00', end_at: '2026-12-01T12:00:00-08:00' },
    { start_at: '2026-12-01T13:00:00-08:00', end_at: '2026-12-01T14:00:00-08:00' }
  ] };
  const bookings = [
    { start_at: '2026-12-01T10:30:00-08:00', end_at: '2026-12-01T11:00:00-08:00', status: 'CONFIRMED' },
    { start_at: '2026-12-01T13:00:00-08:00', end_at: '2026-12-01T13:30:00-08:00', status: 'cancelled' },
    { start_at: '2026-12-01T13:30:00-08:00', end_at: '2026-12-01T13:45:00-08:00' }
  ];
  const conflicts = findSlotConflicts(days, bookings, {});
  assert.deepEqual(conflicts.map((c) => c.start), ['10:00', '13:00']);
  assert.equal(conflicts[0].date, '2026-12-01');
  assert.equal(conflicts[0].end, '11:00');
});

test('findSlotConflicts applies buffers', () => {
  const days = { '2026-12-01': [{ start_at: '2026-12-01T11:00:00-08:00', end_at: '2026-12-01T12:00:00-08:00' }] };
  const bookings = [{ start_at: '2026-12-01T10:00:00-08:00', end_at: '2026-12-01T10:50:00-08:00', status: 'CONFIRMED' }];
  assert.equal(findSlotConflicts(days, bookings, {}).length, 0);
  assert.equal(findSlotConflicts(days, bookings, { bufferBefore: 15 }).length, 1);
  const after = [{ start_at: '2026-12-01T12:10:00-08:00', end_at: '2026-12-01T13:00:00-08:00', status: 'CONFIRMED' }];
  assert.equal(findSlotConflicts(days, after, { bufferAfter: 15 }).length, 1);
});

test('findSlotConflicts compares instants across a DST change', () => {
  const days = { '2026-11-01': [{ start_at: '2026-11-01T10:00:00-08:00', end_at: '2026-11-01T11:00:00-08:00' }] };
  const bookings = [{ start_at: '2026-11-01T17:30:00Z', end_at: '2026-11-01T18:30:00Z', status: 'CONFIRMED' }];
  assert.equal(findSlotConflicts(days, bookings, {}).length, 1);
});

test('slotsOutsideHours flags Sunday and after-close starts', () => {
  const days = {
    '2026-12-05': [{ start_at: '2026-12-05T10:00:00-08:00', end_at: '2026-12-05T11:00:00-08:00' }],
    '2026-12-06': [{ start_at: '2026-12-06T11:00:00-08:00', end_at: '2026-12-06T12:00:00-08:00' }],
    '2026-12-07': [{ start_at: '2026-12-07T16:30:00-08:00', end_at: '2026-12-07T17:30:00-08:00' }]
  };
  const outside = slotsOutsideHours(days, STUDIO_HOURS, 'America/Los_Angeles');
  assert.deepEqual(outside, [{ date: '2026-12-06', start: '11:00' }, { date: '2026-12-07', start: '16:30' }]);
});

test('applyMap replaces every placeholder and refuses gaps', () => {
  const meta = { version: 1, groups: [], services: [{ service_id: 'svc_a', group: 'g' }] };
  const applied = applyMap(meta, [{ placeholder: 'svc_a', id: 'real-a' }]);
  assert.equal(applied.services[0].service_id, 'real-a');
  assert.equal(meta.services[0].service_id, 'svc_a');
  assert.throws(() => applyMap(meta, []));
});
