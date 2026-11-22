// Booking BFF application: routing, guards and service wiring
// (ARCHITECTURE §4, §8.5, §13, §14). The Worker entry is index.js.
//
// Only /api/* reaches this Worker (`assets.run_worker_first: ["/api/*"]`);
// every other path is served by static assets. Routes:
//   GET  /api/booking/catalog
//   GET  /api/booking/slots?service_id=&week_start=
//   POST /api/booking/appointments
// Any other /api/* path is a JSON 404.

import meta from '../config/services-meta.json' with { type: 'json' };
import { createAlerts } from './alerts.js';
import { createAppointmentService } from './appointments.js';
import { createCatalogService } from './catalog.js';
import { loadConfig } from './config.js';
import { createCustomerResolver } from './customers.js';
import { BookingError, errorResponse, json } from './errors.js';
import { createMockSquare } from './payments/mock.js';
import { createSquarePayments } from './payments/square.js';
import { reconcileStaleAuthorizations } from './reconcile.js';
import { createSetmoreClient } from './setmore/client.js';
import { MOCK_ACCOUNT_ID, MOCK_PROVIDER_ID } from './setmore/fixtures.js';
import { createMockSetmoreFetch, createMockState, MOCK_SCENARIOS } from './setmore/mock.js';
import { createTokenManager } from './setmore/token-manager.js';
import { createSlotsService } from './slots.js';

// Verbatim from the studio's Setmore booking page, read 2026-11-22 (ARCHITECTURE §11).
const POLICY_TEXT = 'Cancellations made on the same day as your appointment will result in the forfeiture of your $50 deposit. The deposit is non-refundable for same-day cancellations.';

const MAX_BODY_BYTES = 8192;
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

function defaultRateLimiter(env) {
  return async (kind, ip) => {
    const binding = kind === 'post' ? env.RATE_LIMITER_POST : env.RATE_LIMITER_GET;
    if (!binding) return true;
    const { success } = await binding.limit({ key: `${kind}:${ip}` });
    return success;
  };
}

function defaultTurnstile(fetchImpl, secret) {
  return async (token, ip) => {
    if (!token || !secret) return false;
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    try {
      const response = await fetchImpl(TURNSTILE_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      return body?.success === true;
    } catch {
      return false;
    }
  };
}

export function buildApp(env = {}, deps = {}) {
  let config = null;
  let configError = null;
  try {
    const loaded = loadConfig(env);
    config = loaded.setmoreMockMode
      ? { ...loaded, setmoreAccountId: MOCK_ACCOUNT_ID, setmoreProviderId: MOCK_PROVIDER_ID }
      : loaded;
  } catch (err) {
    configError = err;
  }

  const fetchImpl = deps.fetch ?? ((...args) => fetch(...args));
  const now = deps.now ?? (() => new Date());
  const kv = deps.kv ?? env.BOOKING_KV;
  const cache = deps.cache ?? (typeof caches !== 'undefined' ? caches.default : null);
  const sendEmail = deps.sendEmail ?? ((message) => env.ALERT_EMAIL.send(message));
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter(env);
  const turnstileVerify = deps.turnstileVerify ?? defaultTurnstile(fetchImpl, config?.turnstileSecretKey);

  const mockState = createMockState();
  const stacks = new Map();
  let payments = null;

  function paymentsAdapter() {
    payments ??= config.paymentsMockMode
      ? createMockSquare({ scenario: config.paymentsMockScenario })
      : createSquarePayments({
        accessToken: config.squareAccessToken,
        environment: config.squareEnvironment,
        locationId: config.squareLocationId,
        version: config.squareVersion,
        delayDuration: config.squareDelayDuration,
        fetch: fetchImpl
      });
    return payments;
  }

  // One service stack per mock scenario (one in live mode), so the Setmore
  // client's cooldown and the catalog memory survive across requests.
  function stack(scenario) {
    const key = config.setmoreMockMode ? scenario : 'live';
    if (stacks.has(key)) return stacks.get(key);
    const setmoreFetch = config.setmoreMockMode
      ? createMockSetmoreFetch({ scenario, now, rateLimitCount: config.setmoreMock429Count, state: mockState })
      : fetchImpl;
    const refreshToken = config.setmoreMockMode ? 'mock-refresh-token' : config.setmoreRefreshToken;
    const tokenManager = createTokenManager({
      refreshToken, apiBase: config.setmoreApiBase, fetch: setmoreFetch, now,
      cache: config.setmoreMockMode ? null : cache, marginSeconds: config.tokenRefreshMarginSeconds
    });
    const client = createSetmoreClient({
      apiBase: config.setmoreApiBase, tokenManager, fetch: setmoreFetch, now, cooldownSeconds: config.setmoreCooldownSeconds,
      ...(deps.sleep ? { sleep: deps.sleep } : {})
    });
    const catalog = createCatalogService({ client, meta, config, cache: config.setmoreMockMode ? null : cache, now, log });
    const slots = createSlotsService({ client, catalog, config, cache: config.setmoreMockMode ? null : cache, now });
    const customers = createCustomerResolver({ client, kv, secret: config.customerHashSecret, maxPages: config.customerScanMaxPages, log });
    const alerts = createAlerts({ sendEmail, from: config.alertFromEmail, to: config.salonAlertEmail, log });
    const appointments = createAppointmentService({
      client, catalog, slots, customers, payments: paymentsAdapter(), kv, alerts, config, now, log
    });
    const built = { client, catalog, slots, appointments, alerts };
    stacks.set(key, built);
    return built;
  }

  function scenarioFor(request) {
    if (!config.setmoreMockMode) return null;
    const requested = request.headers.get('X-Mock-Scenario');
    return MOCK_SCENARIOS.includes(requested) ? requested : config.setmoreMockScenario;
  }

  async function readJsonBody(request) {
    const type = request.headers.get('Content-Type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(type)) {
      throw new BookingError('VALIDATION_FAILED', { fields: { body: 'Send JSON.' } });
    }
    const declared = Number(request.headers.get('Content-Length'));
    if (declared > MAX_BODY_BYTES) throw new BookingError('VALIDATION_FAILED', { fields: { body: 'The request is too large.' } });
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) throw new BookingError('VALIDATION_FAILED', { fields: { body: 'The request is too large.' } });
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new BookingError('VALIDATION_FAILED', { fields: { body: 'Send valid JSON.' } });
    }
  }

  async function handleApi(request, url) {
    if (configError) throw configError;
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /api/booking/catalog' || route === 'GET /api/booking/slots') {
      if (!(await rateLimiter('get', ip))) throw new BookingError('RATE_LIMITED', { retryAfterSeconds: 60 });
      const services = stack(scenarioFor(request));
      if (route === 'GET /api/booking/catalog') {
        const { groups, stale } = await services.catalog.getCatalog();
        return json({
          timezone: config.studioTimezone,
          stale,
          groups,
          checkout: {
            square: { application_id: config.squareApplicationId, location_id: config.squareLocationId, environment: config.squareEnvironment },
            turnstile_site_key: config.turnstileSiteKey,
            policy_text: POLICY_TEXT,
            phone: config.studioPhone
          }
        }, 200, { 'Cache-Control': 'public, max-age=60' });
      }
      const serviceId = url.searchParams.get('service_id');
      if (!serviceId) throw new BookingError('VALIDATION_FAILED', { fields: { service_id: 'Choose a service.' } });
      const week = await services.slots.getWeek({ serviceId, weekStart: url.searchParams.get('week_start') ?? undefined });
      return json(week, 200, { 'Cache-Control': 'no-store' });
    }

    if (route === 'POST /api/booking/appointments') {
      if (!config.allowedOrigins.includes(request.headers.get('Origin') ?? '')) throw new BookingError('FORBIDDEN_ORIGIN');
      if (!(await rateLimiter('post', ip))) throw new BookingError('RATE_LIMITED', { retryAfterSeconds: 600 });
      const body = await readJsonBody(request);
      if (!(await turnstileVerify(typeof body?.turnstile_token === 'string' ? body.turnstile_token : '', ip))) {
        throw new BookingError('TURNSTILE_FAILED');
      }
      const { status, body: result } = await stack(scenarioFor(request)).appointments.create(body);
      return json(result, status, { 'Cache-Control': 'no-store' });
    }

    throw new BookingError('NOT_FOUND');
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) {
        return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
      }
      try {
        return await handleApi(request, url);
      } catch (err) {
        if (!(err instanceof BookingError)) log('request_failed', { route: url.pathname, error: err?.name ?? 'Error' });
        return errorResponse(err);
      }
    },

    async scheduled() {
      if (configError) {
        log('reconcile_skipped_misconfigured');
        return;
      }
      const { client, alerts } = stack(config.setmoreMockMode ? config.setmoreMockScenario : null);
      const summary = await reconcileStaleAuthorizations({ kv, payments: paymentsAdapter(), client, alerts, config, now, log });
      log('reconcile_finished', summary);
    }
  };
}
