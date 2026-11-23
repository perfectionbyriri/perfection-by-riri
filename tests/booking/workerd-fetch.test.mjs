import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenManager } from '../../worker/src/setmore/token-manager.js';
import { createSetmoreClient } from '../../worker/src/setmore/client.js';
import { createSquarePayments } from '../../worker/src/payments/square.js';
import { SetmoreUnavailable } from '../../worker/src/errors.js';

// Cloudflare Workers (workerd) rejects `redirect: 'error'` with a TypeError before
// sending anything; Node accepts it. Preview deploy e3572e8 failed this way on
// every Setmore call (log: request_failed / SetmoreUnavailable, 2026-11-23).
function workerdFetch(handler) {
  const calls = [];
  async function fetch(input, init = {}) {
    if (init.redirect !== undefined && !['follow', 'manual'].includes(init.redirect)) {
      throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
    }
    calls.push({ url: new URL(String(input)), init });
    return handler(new URL(String(input)), init);
  }
  return { fetch, calls };
}

const API = 'https://developer.setmore.com/api/v2';
const tokenBody = { data: { token: { access_token: 'access', expires_in: 3600 } } };

test('Setmore token refresh and requests use a redirect mode workerd accepts', async () => {
  const { fetch, calls } = workerdFetch((url) => (url.pathname.endsWith('/o/oauth2/token')
    ? Response.json(tokenBody)
    : Response.json({ data: [{ id: 's1' }] })));
  const tokenManager = createTokenManager({ refreshToken: 'refresh', apiBase: API, fetch });
  const client = createSetmoreClient({ apiBase: API, tokenManager, fetch, sleep: async () => {} });
  const services = await client.listServices();
  assert.deepEqual(services, [{ id: 's1' }]);
  assert.ok(calls.every((call) => call.init.redirect === 'manual'));
});

test('a Setmore redirect is treated as unavailable, not followed', async () => {
  const { fetch } = workerdFetch((url) => (url.pathname.endsWith('/o/oauth2/token')
    ? Response.json(tokenBody)
    : new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/' } })));
  const tokenManager = createTokenManager({ refreshToken: 'refresh', apiBase: API, fetch });
  const client = createSetmoreClient({ apiBase: API, tokenManager, fetch, sleep: async () => {} });
  await assert.rejects(client.listServices(), SetmoreUnavailable);
});

test('Square requests use a redirect mode workerd accepts', async () => {
  const { fetch, calls } = workerdFetch(() => Response.json({ payment: { id: 'p1', status: 'APPROVED' } }));
  const square = createSquarePayments({
    accessToken: 'sq', environment: 'sandbox', locationId: 'L1', version: '2026-11-18', delayDuration: 'PT48H', fetch
  });
  await square.authorize({ idempotencyKey: 'k', sourceId: 'cnon:card-nonce-ok', amountCents: 5000, buyerEmail: 'a@example.com', note: 'n', referenceId: 'r' });
  assert.ok(calls.length > 0 && calls.every((call) => call.init.redirect === 'manual'));
});
