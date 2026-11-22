import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenManager } from '../../worker/src/setmore/token-manager.js';
import { SetmoreUnavailable } from '../../worker/src/errors.js';
import { createClock, createMemoryCache, createFetchRecorder } from './helpers/fakes.mjs';

const API = 'https://developer.setmore.com/api/v2';
const TOKEN_PATH = '/api/v2/o/oauth2/token';

function tokenRoute(expiresIn = 7199) {
  let issued = 0;
  return () => {
    issued += 1;
    return { body: { response: true, data: { token: { access_token: `access-${issued}`, token_type: 'BEARER', expires_in: expiresIn } } } };
  };
}

function setup({ route = tokenRoute(), cache, clock = createClock() } = {}) {
  const recorder = createFetchRecorder({ [`GET ${TOKEN_PATH}`]: route });
  const manager = createTokenManager({
    refreshToken: 'REFRESH-SECRET', apiBase: API, fetch: recorder.fetch, now: clock.now,
    cache: cache ?? createMemoryCache(clock)
  });
  return { manager, recorder, clock };
}

test('returns the cached token while more than 60 s remain', async () => {
  const { manager, recorder, clock } = setup({ route: tokenRoute(3600) });
  assert.equal(await manager.getToken(), 'access-1');
  clock.advance(3539 * 1000);
  assert.equal(await manager.getToken(), 'access-1');
  assert.equal(recorder.calls.length, 1);
});

test('refreshes when 60 s or less remain', async () => {
  const { manager, recorder, clock } = setup({ route: tokenRoute(3600) });
  await manager.getToken();
  clock.advance(3541 * 1000);
  assert.equal(await manager.getToken(), 'access-2');
  assert.equal(recorder.calls.length, 2);
});

test('works with the observed two-hour lifetime', async () => {
  const { manager, recorder, clock } = setup({ route: tokenRoute(7199) });
  await manager.getToken();
  clock.advance(7138 * 1000);
  await manager.getToken();
  assert.equal(recorder.calls.length, 1);
  clock.advance(2 * 1000);
  await manager.getToken();
  assert.equal(recorder.calls.length, 2);
});

test('sends the refresh token as the refreshToken query parameter with GET', async () => {
  const { manager, recorder } = setup();
  await manager.getToken();
  assert.equal(recorder.calls[0].method, 'GET');
  assert.equal(recorder.calls[0].url.searchParams.get('refreshToken'), 'REFRESH-SECRET');
});

test('shares one refresh between concurrent callers', async () => {
  const { manager, recorder } = setup();
  const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => manager.getToken()));
  assert.deepEqual(new Set(tokens), new Set(['access-1']));
  assert.equal(recorder.calls.length, 1);
});

test('invalidate forces a new refresh', async () => {
  const { manager, recorder } = setup();
  await manager.getToken();
  await manager.invalidate();
  assert.equal(await manager.getToken(), 'access-2');
  assert.equal(recorder.calls.length, 2);
});

test('failed refresh throws SetmoreUnavailable without the refresh token in the message', async () => {
  const { manager } = setup({ route: { status: 500, body: { errors: [{ code: 'server_error', message: 'refreshToken=REFRESH-SECRET' }] } } });
  await assert.rejects(manager.getToken(), (err) => {
    assert.ok(err instanceof SetmoreUnavailable);
    assert.doesNotMatch(`${err.message} ${String(err)} ${err.stack}`, /REFRESH-SECRET/);
    return true;
  });
});

test('malformed token body throws SetmoreUnavailable', async () => {
  const { manager } = setup({ route: { body: { response: true, data: {} } } });
  await assert.rejects(manager.getToken(), SetmoreUnavailable);
});

test('network failure throws SetmoreUnavailable', async () => {
  const { manager } = setup({ route: () => new TypeError('fetch failed') });
  await assert.rejects(manager.getToken(), SetmoreUnavailable);
});

test('a failed refresh does not poison later attempts', async () => {
  let attempt = 0;
  const { manager } = setup({ route: () => (++attempt === 1 ? { status: 503, body: {} } : tokenRoute()()) });
  await assert.rejects(manager.getToken(), SetmoreUnavailable);
  assert.equal(await manager.getToken(), 'access-1');
});

test('reuses a token from the shared cache in a new isolate', async () => {
  const clock = createClock();
  const cache = createMemoryCache(clock);
  const first = setup({ cache, clock });
  await first.manager.getToken();
  const second = setup({ cache, clock });
  assert.equal(await second.manager.getToken(), 'access-1');
  assert.equal(second.recorder.calls.length, 0);
});

test('invalidate also clears the shared cache', async () => {
  const clock = createClock();
  const cache = createMemoryCache(clock);
  const first = setup({ cache, clock });
  await first.manager.getToken();
  await first.manager.invalidate();
  const second = setup({ cache, clock });
  await second.manager.getToken();
  assert.equal(second.recorder.calls.length, 1);
});
