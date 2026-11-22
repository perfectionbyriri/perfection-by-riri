import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../worker/src/config.js';

function misconfigured(fn) {
  assert.throws(fn, (err) => err.code === 'MISCONFIGURED');
}

test('defaults follow the approved architecture', () => {
  const config = loadConfig({});
  assert.equal(config.environment, 'development');
  assert.equal(config.studioTimezone, 'America/Los_Angeles');
  assert.equal(config.setmoreMockMode, true);
  assert.equal(config.paymentsMockMode, true);
  assert.equal(config.setmoreApiBase, 'https://developer.setmore.com/api/v2');
  assert.equal(config.setmoreAccountId, '1a47bbdd-c70e-402d-9bcb-1c739d6752ae');
  assert.equal(config.setmoreProviderId, 'b0bfa3b4-b043-4cec-b841-017a716974fd');
  assert.equal(config.cardFeeBasisPoints, 0);
  assert.equal(config.depositAmountCents, 5000);
  assert.equal(config.squareDelayDuration, 'PT48H');
  assert.equal(config.minLeadMinutes, 120);
  assert.equal(config.bookingHorizonDays, 56);
  assert.equal(config.slotStepMinutes, 15);
  assert.equal(config.tokenRefreshMarginSeconds, 60);
  assert.equal(config.catalogTtlSeconds, 600);
  assert.equal(config.slotsTtlSeconds, 30);
  assert.equal(config.setmoreCooldownSeconds, 10);
  assert.equal(config.customerScanMaxPages, 20);
  assert.deepEqual(config.allowedOrigins, ['https://perfectionbyriri.com']);
  assert.equal(config.studioPhone, '+14258450045');
});

test('numbers and lists are parsed from strings', () => {
  const config = loadConfig({ SLOT_STEP_MINUTES: '30', ALLOWED_ORIGINS: 'https://a.example, http://localhost:8787' });
  assert.equal(config.slotStepMinutes, 30);
  assert.deepEqual(config.allowedOrigins, ['https://a.example', 'http://localhost:8787']);
});

test('production with Setmore mock mode on is misconfigured', () => {
  misconfigured(() => loadConfig({ ENVIRONMENT: 'production', PAYMENTS_MOCK_MODE: 'false' }));
});

test('production with payments mock mode on is misconfigured', () => {
  misconfigured(() => loadConfig({ ENVIRONMENT: 'production', SETMORE_MOCK_MODE: 'false', SETMORE_REFRESH_TOKEN: 'r' }));
});

test('a delay duration outside PT24H–PT48H is misconfigured', () => {
  misconfigured(() => loadConfig({ SQUARE_DELAY_DURATION: 'PT72H' }));
  misconfigured(() => loadConfig({ SQUARE_DELAY_DURATION: 'PT15M' }));
  assert.equal(loadConfig({ SQUARE_DELAY_DURATION: 'PT24H' }).squareDelayDuration, 'PT24H');
});

test('mock off without a refresh token is misconfigured', () => {
  misconfigured(() => loadConfig({ SETMORE_MOCK_MODE: 'false' }));
});

test('payments mock off without Square credentials is misconfigured', () => {
  misconfigured(() => loadConfig({ PAYMENTS_MOCK_MODE: 'false' }));
});

test('invalid numbers and booleans are misconfigured', () => {
  misconfigured(() => loadConfig({ MIN_LEAD_MINUTES: '-5' }));
  misconfigured(() => loadConfig({ SLOTS_TTL_SECONDS: 'soon' }));
  misconfigured(() => loadConfig({ SETMORE_MOCK_MODE: 'maybe' }));
  misconfigured(() => loadConfig({ SLOT_STEP_MINUTES: '7' }));
});

test('production requires the customer hash and Turnstile secrets', () => {
  const live = {
    ENVIRONMENT: 'production', SETMORE_MOCK_MODE: 'false', PAYMENTS_MOCK_MODE: 'false',
    SETMORE_REFRESH_TOKEN: 'r', SQUARE_ACCESS_TOKEN: 's', SQUARE_APPLICATION_ID: 'a',
    SQUARE_LOCATION_ID: 'l', SQUARE_VERSION: '2026-01-01', SALON_ALERT_EMAIL: 'alerts@example.com'
  };
  misconfigured(() => loadConfig(live));
  const config = loadConfig({ ...live, CUSTOMER_HASH_SECRET: 'h', TURNSTILE_SECRET_KEY: 't', TURNSTILE_SITE_KEY: 'k' });
  assert.equal(config.setmoreMockMode, false);
  assert.equal(config.squareEnvironment, 'sandbox');
});

test('the misconfiguration message never echoes a secret value', () => {
  try {
    loadConfig({ SETMORE_MOCK_MODE: 'false', SQUARE_DELAY_DURATION: 'SECRET-LOOKING-VALUE' });
    assert.fail('expected throw');
  } catch (err) {
    assert.doesNotMatch(String(err.message), /SECRET-LOOKING-VALUE/);
  }
});

test('Square-Version is pinned to the version verified at implementation, and an override wins', () => {
  assert.equal(loadConfig({}).squareVersion, '2026-11-18');
  assert.equal(loadConfig({ SQUARE_VERSION: '2027-01-15' }).squareVersion, '2027-01-15');
});
