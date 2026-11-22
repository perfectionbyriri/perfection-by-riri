import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaOf, redact, studioWeekAfter, runProbe } from '../../worker/tools/setmore-probe.js';

const V2 = 'https://developer.setmore.com/api/v2';
const V1_TOKEN = 'https://developer.setmore.com/api/v1/o/oauth2/token';

function v2TokenBody(accessToken = 'ACCESS-SECRET-123') {
  return { response: true, data: { token: { access_token: accessToken, token_type: 'BEARER', expires_in: 604799, user_id: 'usr_1' } } };
}

function fakeFetch(routes) {
  const calls = [];
  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    calls.push({ method: init.method ?? 'GET', url: url.href, path: url.pathname });
    const key = `${url.origin}${url.pathname}`;
    const handler = routes[key];
    if (!handler) return Response.json({ errors: [{ code: 'not_found' }] }, { status: 404 });
    const { status = 200, body } = typeof handler === 'function' ? handler(url, init) : handler;
    return Response.json(body, { status });
  }
  return { fetch, calls };
}

function okRoutes(accessToken) {
  return {
    [`${V2}/o/oauth2/token`]: { body: v2TokenBody(accessToken) },
    [`${V2}/staff`]: { body: { data: [
      { id: 'staff_owner', first_name: 'Owner', email: 'owner@example.com' },
      { id: 'staff_riri', first_name: 'Riri', email: 'riri@example.com' }
    ] } },
    [`${V2}/services`]: { body: { data: [
      { id: 'svc_lash_lift', title: 'Lash Lift', duration: 60, cost: 115, provider_ids: ['staff_riri'], visibility: 'PUBLIC' },
      { id: 'svc_hidden', title: 'Hidden', duration: 30, cost: 10, provider_ids: ['staff_riri'], visibility: 'PRIVATE' }
    ], cursor: 'next' } },
    [`${V2}/categories`]: { body: { data: [{ id: 'cat_1', title: 'Lash Lift', service_ids: ['svc_lash_lift'], visibility: 'PUBLIC' }] } },
    [`${V2}/slots`]: { body: { data: { days: { '2026-11-23': ['2026-11-23T10:00:00-08:00'] } } } },
    [`${V2}/bookings/staffs/staff_owner`]: { body: { data: [] } },
    [`${V2}/bookings/staffs/staff_riri`]: { body: { data: [
      { id: 'bk_1', consumer_ids: ['cus_1'], title: 'Anna Smith', notes: 'call 425 555 0100', start_at: '2026-11-24T10:00:00-08:00' }
    ], cursor: 'more' } },
    [V1_TOKEN]: { body: { response: true, data: { token: { access_token: 'V1-ACCESS', expires_in: 7200 } } } }
  };
}

const silent = { log() {} };

test('schemaOf describes nested objects and arrays by type only', () => {
  assert.deepEqual(schemaOf({ a: 'x', b: [{ c: 1 }], d: null, e: true }),
    { a: 'string', b: [{ c: 'number' }], d: 'null', e: 'boolean' });
});

test('redact keeps allowlisted id and name values', () => {
  assert.deepEqual(redact({ id: 'svc_1', service_name: 'Lash Lift', duration: 60 }),
    { id: 'svc_1', service_name: 'Lash Lift', duration: 60 });
});

test('redact hides values of unknown keys', () => {
  assert.deepEqual(redact({ email_addresses: [{ value: 'a@b.co' }], age: 30 }),
    { email_addresses: [{ value: '<string>' }], age: '<number>' });
});

test('redact hides email-like and phone-like strings under allowlisted keys', () => {
  assert.deepEqual(redact({ name: 'anna@x.com', title: '(425) 845 0045' }),
    { name: '<redacted>', title: '<redacted>' });
});

test('redact always hides tokens but keeps token_type', () => {
  assert.deepEqual(redact({ access_token: 'abc', token_type: 'BEARER', refreshToken: 'r' }),
    { access_token: '<redacted>', token_type: 'BEARER', refreshToken: '<redacted>' });
});

test('redact turns cursor into presence only', () => {
  assert.deepEqual(redact({ cursor: 'opaque-value' }), { cursor: true });
});

test('redact hides first_name', () => {
  assert.deepEqual(redact({ first_name: 'Riri' }), { first_name: '<string>' });
});

test('redact keeps provider_ids, category_ids and service_ids', () => {
  assert.deepEqual(redact({ provider_ids: ['p1'], category_ids: ['c1'], service_ids: ['s1'] }),
    { provider_ids: ['p1'], category_ids: ['c1'], service_ids: ['s1'] });
});

test('redact keeps visibility', () => {
  assert.deepEqual(redact({ visibility: 'PUBLIC' }), { visibility: 'PUBLIC' });
});

test('redact truncates arrays to three items', () => {
  assert.deepEqual(redact({ staff_ids: ['a', 'b', 'c', 'd', 'e'] }).staff_ids,
    ['a', 'b', 'c', '…(+2 more)']);
});

test('studioWeekAfter returns next Monday window in Pacific time', () => {
  assert.deepEqual(studioWeekAfter(new Date('2026-11-22T20:00:00Z')),
    { startAt: '2026-11-23T00:00:00-08:00', endAt: '2026-11-30T00:00:00-08:00' });
});

test('studioWeekAfter carries different offsets across the DST change', () => {
  assert.deepEqual(studioWeekAfter(new Date('2026-10-20T19:00:00Z')),
    { startAt: '2026-10-26T00:00:00-07:00', endAt: '2026-11-02T00:00:00-08:00' });
});

test('studioWeekAfter with offset 1 returns the following week', () => {
  assert.deepEqual(studioWeekAfter(new Date('2026-11-22T20:00:00Z'), 1),
    { startAt: '2026-11-30T00:00:00-08:00', endAt: '2026-12-07T00:00:00-08:00' });
});

test('runProbe skips without a refresh token and makes no request', async () => {
  const { fetch, calls } = fakeFetch(okRoutes());
  const report = await runProbe({ env: {}, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.equal(report.conclusion, 'skipped');
  assert.equal(calls.length, 0);
});

test('runProbe uses only GET, never touches customers, and reads bookings only by staff', async () => {
  const { fetch, calls } = fakeFetch(okRoutes());
  await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'REFRESH-SECRET-456' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.ok(calls.length >= 6);
  for (const call of calls) {
    assert.equal(call.method, 'GET');
    assert.doesNotMatch(call.path, /customers/);
    if (call.path.includes('bookings')) assert.match(call.path, /\/api\/v2\/bookings\/staffs\/[^/]+$/);
  }
});

test('runProbe never prints the refresh or access token', async () => {
  const { fetch } = fakeFetch(okRoutes('ACCESS-SECRET-123'));
  const lines = [];
  const report = await runProbe({
    env: { SETMORE_REFRESH_TOKEN: 'REFRESH-SECRET-456' }, fetch,
    now: () => new Date('2026-11-22T20:00:00Z'), log: { log: (...args) => lines.push(args.join(' ')) }
  });
  const output = JSON.stringify(report) + lines.join('\n');
  assert.doesNotMatch(output, /REFRESH-SECRET-456/);
  assert.doesNotMatch(output, /ACCESS-SECRET-123/);
  assert.doesNotMatch(output, /V1-ACCESS/);
  assert.doesNotMatch(output, /riri@example\.com/);
  assert.doesNotMatch(output, /owner@example\.com/);
  assert.doesNotMatch(output, /"Riri"|"Owner"/);
  assert.doesNotMatch(output, /Anna Smith|425 555 0100|bk_1|cus_1/);
});

test('runProbe queries slots for each staff id over two windows with duration 60', async () => {
  const seen = [];
  const routes = okRoutes('ACCESS-SECRET-123');
  routes[`${V2}/slots`] = (url, init) => {
    seen.push({ auth: init.headers?.Authorization, ...Object.fromEntries(url.searchParams) });
    return { body: { data: { days: {} } } };
  };
  const { fetch } = fakeFetch(routes);
  const report = await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'R' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.equal(seen.length, 4);
  assert.deepEqual(seen.map((q) => `${q.provider_id} ${q.start_at} ${q.end_at}`), [
    'staff_owner 2026-11-23T00:00:00-08:00 2026-11-30T00:00:00-08:00',
    'staff_owner 2026-11-30T00:00:00-08:00 2026-12-07T00:00:00-08:00',
    'staff_riri 2026-11-23T00:00:00-08:00 2026-11-30T00:00:00-08:00',
    'staff_riri 2026-11-30T00:00:00-08:00 2026-12-07T00:00:00-08:00'
  ]);
  for (const q of seen) {
    assert.equal(q.auth, 'Bearer ACCESS-SECRET-123');
    assert.equal(q.duration, '60');
    assert.equal(q.timezone, 'America/Los_Angeles');
    assert.equal(q.account_id, 'usr_1');
  }
  assert.equal(report.v2.slots_by_staff.length, 2);
  assert.equal(report.v2.account_id_source, 'token.user_id');
});

test('runProbe reports slot counts and a redacted sample of the first non-empty day', async () => {
  const { fetch } = fakeFetch(okRoutes());
  const report = await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'R' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  const window = report.v2.slots_by_staff[1].windows[0];
  assert.equal(window.status, 200);
  assert.equal(window.day_count, 1);
  assert.equal(window.slot_count, 1);
  assert.deepEqual(window.first_non_empty_day, { date: '2026-11-23', sample: ['2026-11-23T10:00:00-08:00'], element_schema: 'string' });
});

test('runProbe summarizes provider ids and visibility values of services', async () => {
  const { fetch } = fakeFetch(okRoutes());
  const report = await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'R' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.deepEqual(report.v2.services.summary, {
    count: 2,
    services_per_provider: { staff_riri: 2 },
    visibility_counts: { PUBLIC: 1, PRIVATE: 1 }
  });
  assert.deepEqual(report.v2.categories.summary, { count: 1, visibility_counts: { PUBLIC: 1 } });
});

test('runProbe reports bookings by staff as status, count and schema only', async () => {
  const seen = [];
  const routes = okRoutes();
  routes[`${V2}/bookings/staffs/staff_riri`] = (url) => {
    seen.push(Object.fromEntries(url.searchParams));
    return { body: { data: [{ id: 'bk_1', title: 'Anna Smith' }], cursor: 'more' } };
  };
  const { fetch } = fakeFetch(routes);
  const report = await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'R' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.deepEqual(seen[0], { start_at: '2026-11-23T00:00:00-08:00', end_at: '2026-11-30T00:00:00-08:00', limit: '5' });
  const entry = report.v2.bookings_by_staff.find((item) => item.provider_id === 'staff_riri');
  assert.deepEqual(entry, {
    provider_id: 'staff_riri', url: `${V2}/bookings/staffs/staff_riri`, status: 200, ok: true,
    count: 1, has_cursor: true, schema: { data: [{ id: 'string', title: 'string' }], cursor: 'string' }
  });
  assert.equal('sample' in entry, false);
});

test('runProbe reports v2_ok when v2 token and reads succeed', async () => {
  const { fetch } = fakeFetch(okRoutes());
  const report = await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'R' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.equal(report.conclusion, 'v2_ok');
  assert.equal(report.v2.token.status, 200);
  assert.equal(report.v2.slots_by_staff[0].windows[0].status, 200);
  assert.equal(report.v2.services.sample.data[0].title, 'Lash Lift');
  assert.equal(report.v2.services.sample.cursor, true);
  assert.equal(report.v1.token.status, 200);
  assert.doesNotMatch(report.v2.token.url, /\?/);
});

test('runProbe reports v1_only when v2 token fails and v1 succeeds', async () => {
  const routes = okRoutes();
  routes[`${V2}/o/oauth2/token`] = { status: 401, body: { errors: [{ code: 'unauthorized' }] } };
  const { fetch, calls } = fakeFetch(routes);
  const report = await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'R' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.equal(report.conclusion, 'v1_only');
  assert.equal(report.v2.token.status, 401);
  assert.ok(!calls.some((call) => call.path.endsWith('/staff')));
});

test('runProbe reports neither when both token exchanges fail', async () => {
  const routes = okRoutes();
  routes[`${V2}/o/oauth2/token`] = { status: 401, body: {} };
  routes[V1_TOKEN] = { status: 401, body: {} };
  const { fetch } = fakeFetch(routes);
  const report = await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'R' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.equal(report.conclusion, 'neither');
});

test('runProbe records a network failure without throwing', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  const report = await runProbe({ env: { SETMORE_REFRESH_TOKEN: 'R' }, fetch, now: () => new Date('2026-11-22T20:00:00Z'), log: silent });
  assert.equal(report.conclusion, 'neither');
  assert.equal(report.v2.token.status, null);
  assert.equal(report.v2.token.error, 'TypeError');
});
