import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as entry from '../../worker/src/index.js';
import { buildApp } from '../../worker/src/app.js';
import { loadConfig } from '../../worker/src/config.js';
import { createMockSetmoreFetch } from '../../worker/src/setmore/mock.js';
import { createClock, createMemoryCache, createMemoryKV } from './helpers/fakes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'https://perfectionbyriri.com';
const MOCK_ENV = { ENVIRONMENT: 'development', SETMORE_MOCK_MODE: 'true', PAYMENTS_MOCK_MODE: 'true', ALLOWED_ORIGINS: ORIGIN };

// Allows `limit` hits per key inside `windowMs` of the injected clock.
function windowLimiter(clock, limits = { get: 60, post: 5 }, windowMs = { get: 60000, post: 600000 }) {
  const hits = new Map();
  return async (kind, ip) => {
    const key = `${kind}:${ip}`;
    const recent = (hits.get(key) ?? []).filter((at) => clock.now().getTime() - at < windowMs[kind]);
    recent.push(clock.now().getTime());
    hits.set(key, recent);
    return recent.length <= limits[kind];
  };
}

function setup({ env = MOCK_ENV, fetch, turnstile = async (token) => token === 'turnstile-ok' } = {}) {
  const clock = createClock('2026-11-22T20:00:00Z');
  const kv = createMemoryKV();
  const turnstileCalls = [];
  const app = buildApp(env, {
    kv,
    cache: createMemoryCache(clock),
    now: clock.now,
    fetch: fetch ?? (async () => { throw new Error('no network in tests'); }),
    sendEmail: async () => {},
    sleep: async () => {},
    rateLimiter: windowLimiter(clock),
    turnstileVerify: async (token, ip) => { turnstileCalls.push({ token, ip }); return turnstile(token, ip); }
  });
  return { app, kv, clock, turnstileCalls };
}

const get = (pathAndQuery, headers = {}) => new Request(`${ORIGIN}${pathAndQuery}`, { headers: { 'CF-Connecting-IP': '203.0.113.7', ...headers } });

const BODY = {
  idempotency_key: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  service_id: 'svc_lash_lift',
  start_at: '2026-11-23T13:00:00-08:00',
  customer: { first_name: 'Anna', last_name: 'Smith', email: 'anna@example.com', phone: '4258450045' },
  policy_accepted: true,
  turnstile_token: 'turnstile-ok',
  payment: { source_id: 'cnon:card-nonce-ok' }
};

function post(body = BODY, headers = {}) {
  return new Request(`${ORIGIN}/api/booking/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function readError(response) {
  const body = await response.json();
  return body.error;
}

test('catalog 200 with Cache-Control: public, max-age=60 and the checkout block', async () => {
  const { app } = setup();
  const response = await app.fetch(get('/api/booking/catalog'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const body = await response.json();
  assert.equal(body.timezone, 'America/Los_Angeles');
  assert.equal(body.stale, false);
  assert.equal(body.groups.length, 6);
  assert.equal(body.checkout.phone, '+14258450045');
  assert.equal(body.checkout.square.environment, 'sandbox');
  assert.equal(body.checkout.square.mock, true);
  assert.match(body.checkout.policy_text, /^Cancellations made on the same day as your appointment will result in the forfeiture of your \$50 deposit\./);
});

test('slots 400 without service_id', async () => {
  const { app } = setup();
  const response = await app.fetch(get('/api/booking/slots'));
  assert.equal(response.status, 400);
  assert.equal((await readError(response)).code, 'VALIDATION_FAILED');
});

test('slots 200 for a mock week', async () => {
  const { app } = setup();
  const response = await app.fetch(get('/api/booking/slots?service_id=svc_lash_lift&week_start=2026-11-23'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.days.length, 7);
  assert.equal(body.days[0].slots[0].start_at, '2026-11-23T10:00:00-08:00');
});

test('POST with a wrong Origin → 403', async () => {
  const { app } = setup();
  const response = await app.fetch(post(BODY, { Origin: 'https://evil.example' }));
  assert.equal(response.status, 403);
  assert.equal((await readError(response)).code, 'FORBIDDEN_ORIGIN');
});

test('POST without an Origin → 403', async () => {
  const { app } = setup();
  const request = post();
  request.headers.delete('Origin');
  assert.equal((await app.fetch(request)).status, 403);
});

test('non-JSON content type → 400', async () => {
  const { app } = setup();
  const response = await app.fetch(post('a=1', { 'Content-Type': 'application/x-www-form-urlencoded' }));
  assert.equal(response.status, 400);
});

test('malformed JSON → 400', async () => {
  const { app } = setup();
  assert.equal((await app.fetch(post('{"oops":'))).status, 400);
});

test('9 KB body → 400', async () => {
  const { app, turnstileCalls } = setup();
  const response = await app.fetch(post({ ...BODY, notes: 'x'.repeat(9 * 1024) }));
  assert.equal(response.status, 400);
  assert.equal(turnstileCalls.length, 0);
});

test('Turnstile failure → 403 TURNSTILE_FAILED, with the client IP passed on', async () => {
  const { app, turnstileCalls } = setup({ turnstile: async () => false });
  const response = await app.fetch(post());
  assert.equal(response.status, 403);
  assert.equal((await readError(response)).code, 'TURNSTILE_FAILED');
  assert.deepEqual(turnstileCalls, [{ token: 'turnstile-ok', ip: '203.0.113.7' }]);
});

test('POST books through mock Setmore and mock Square → 201', async () => {
  const { app } = setup();
  const response = await app.fetch(post());
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.deposit.status, 'captured');
  assert.equal(body.booking.start_at, '2026-11-23T13:00:00-08:00');
  const repeat = await app.fetch(post());
  assert.equal(repeat.status, 200, 'the same idempotency key returns the stored result');
});

test('6th POST in 10 min → 429 RATE_LIMITED', async () => {
  const { app, clock } = setup({ turnstile: async () => false });
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await app.fetch(post())).status, 403);
    clock.advance(60000);
  }
  const response = await app.fetch(post());
  assert.equal(response.status, 429);
  assert.equal((await readError(response)).code, 'RATE_LIMITED');
  clock.advance(10 * 60000);
  assert.equal((await app.fetch(post())).status, 403, 'allowed again after the window');
});

test('61st GET in a minute → 429', async () => {
  const { app } = setup();
  for (let i = 0; i < 60; i += 1) await app.fetch(get('/api/booking/slots'));
  assert.equal((await app.fetch(get('/api/booking/slots'))).status, 429);
});

test('/api/other → 404 JSON', async () => {
  const { app } = setup();
  const response = await app.fetch(get('/api/other'));
  assert.equal(response.status, 404);
  assert.equal((await readError(response)).code, 'NOT_FOUND');
});

test('production + mock → 500 MISCONFIGURED', async () => {
  const { app } = setup({ env: { ...MOCK_ENV, ENVIRONMENT: 'production' } });
  for (const request of [get('/api/booking/catalog'), get('/api/booking/slots?service_id=svc_lash_lift'), post()]) {
    const response = await app.fetch(request);
    assert.equal(response.status, 500);
    assert.equal((await readError(response)).code, 'MISCONFIGURED');
  }
});

test('X-Mock-Scenario: rate_limited on slots → 503 UPSTREAM_BUSY', async () => {
  const { app } = setup();
  const response = await app.fetch(get('/api/booking/slots?service_id=svc_lash_lift&week_start=2026-11-23', { 'X-Mock-Scenario': 'rate_limited' }));
  assert.equal(response.status, 503);
  assert.equal((await readError(response)).code, 'UPSTREAM_BUSY');
});

test('the X-Mock-Scenario header is ignored when mock is off', async () => {
  const clock = createClock('2026-11-22T20:00:00Z');
  const upstream = createMockSetmoreFetch({ now: clock.now });
  const env = {
    ENVIRONMENT: 'development', SETMORE_MOCK_MODE: 'false', PAYMENTS_MOCK_MODE: 'true', ALLOWED_ORIGINS: ORIGIN,
    SETMORE_REFRESH_TOKEN: 'refresh', SETMORE_ACCOUNT_ID: 'acc_mock', SETMORE_PROVIDER_ID: 'staff_riri'
  };
  const seen = [];
  const { app } = setup({ env, fetch: (input, init = {}) => { seen.push(new Headers(init.headers).get('X-Mock-Scenario')); return upstream(input, init); } });
  const response = await app.fetch(get('/api/booking/slots?service_id=svc_lash_lift&week_start=2026-11-23', { 'X-Mock-Scenario': 'rate_limited' }));
  assert.equal(response.status, 200);
  assert.ok(seen.length > 0 && seen.every((value) => value === null), 'the header is never forwarded upstream');
});

test('scheduled calls reconcile', async () => {
  const { app, kv } = setup();
  await kv.put('idem:stale', JSON.stringify({ state: 'started', payment_id: null, updated_at: '2026-11-22T19:00:00.000Z', alerted: [] }));
  await app.scheduled({ cron: '*/15 * * * *' });
  assert.equal((await kv.get('idem:stale', 'json')).state, 'failed');
});

test('the entry module exports only the default handler (workerd rejects other value exports)', () => {
  assert.deepEqual(Object.keys(entry), ['default']);
  assert.equal(typeof entry.default.fetch, 'function');
  assert.equal(typeof entry.default.scheduled, 'function');
});

test('.env.example contains every key loadConfig reads, with safe dev defaults', () => {
  const read = new Set();
  loadConfig(new Proxy({}, { get(target, key) { if (typeof key === 'string') read.add(key); return undefined; } }));
  const text = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const keys = new Map(text.split('\n').filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => line.split(/=(.*)/s).slice(0, 2)));
  for (const key of read) assert.ok(keys.has(key), `missing ${key}`);
  assert.equal(keys.get('SETMORE_MOCK_MODE'), 'true');
  assert.equal(keys.get('PAYMENTS_MOCK_MODE'), 'true');
  assert.equal(keys.get('ENVIRONMENT'), 'development');
  for (const secret of ['SETMORE_REFRESH_TOKEN', 'SQUARE_ACCESS_TOKEN', 'CUSTOMER_HASH_SECRET']) assert.equal(keys.get(secret), '', secret);
  assert.doesNotThrow(() => loadConfig(Object.fromEntries(keys)), 'the example loads as a valid dev config');
});

test('.gitignore ignores .dev.vars and .env', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((line) => line.trim());
  assert.ok(lines.includes('.dev.vars'));
  assert.ok(lines.includes('.env'));
});

test('wrangler.jsonc routes /api/* to the Worker and binds KV, limits, e-mail and the cron', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.main, 'worker/src/index.js');
  assert.deepEqual(config.assets.run_worker_first, ['/api/*']);
  assert.equal(config.assets.directory, './New Perfection');
  assert.deepEqual(config.kv_namespaces.map((item) => item.binding), ['BOOKING_KV']);
  assert.deepEqual(config.ratelimits.map((item) => [item.name, item.simple.limit, item.simple.period]), [['RATE_LIMITER_GET', 60, 60], ['RATE_LIMITER_POST', 5, 60]]);
  assert.deepEqual(config.send_email.map((item) => item.name), ['ALERT_EMAIL']);
  assert.deepEqual(config.triggers.crons, ['*/15 * * * *']);
  assert.equal(config.vars.ENVIRONMENT, 'production');
  assert.equal(config.vars.SETMORE_MOCK_MODE, 'false');
  assert.equal(config.vars.PAYMENTS_MOCK_MODE, 'false');
  for (const secret of ['SETMORE_REFRESH_TOKEN', 'SQUARE_ACCESS_TOKEN', 'CUSTOMER_HASH_SECRET', 'TURNSTILE_SECRET_KEY']) {
    assert.ok(!(secret in config.vars), `${secret} must be a secret, not a var`);
  }
});
