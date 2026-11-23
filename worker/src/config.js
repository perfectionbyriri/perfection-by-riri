// Environment parsing for the booking BFF (ARCHITECTURE §15).
//
// Fails closed: any invalid value, a mock flag in production, or a missing
// live credential throws MISCONFIGURED. Messages name the variable only,
// never its value.

import { BookingError, STUDIO_PHONE } from './errors.js';


function misconfigured(name) {
  return new BookingError('MISCONFIGURED', { message: `Invalid or missing configuration: ${name}` });
}

function text(env, name, fallback = '') {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function bool(env, name, fallback) {
  const value = text(env, name);
  if (!value) return fallback;
  if (['true', '1'].includes(value.toLowerCase())) return true;
  if (['false', '0'].includes(value.toLowerCase())) return false;
  throw misconfigured(name);
}

function int(env, name, fallback) {
  const value = text(env, name);
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw misconfigured(name);
  return Number(value);
}

function list(env, name, fallback) {
  const value = text(env, name);
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function delayDuration(env) {
  const value = text(env, 'SQUARE_DELAY_DURATION', 'PT48H');
  const match = /^PT(\d+)H$/.exec(value);
  if (!match || Number(match[1]) < 24 || Number(match[1]) > 48) throw misconfigured('SQUARE_DELAY_DURATION');
  return value;
}

export function loadConfig(env = {}) {
  const config = {
    environment: text(env, 'ENVIRONMENT', 'development'),
    allowedOrigins: list(env, 'ALLOWED_ORIGINS', ['https://perfectionbyriri.com']),
    studioTimezone: text(env, 'STUDIO_TIMEZONE', 'America/Los_Angeles'),
    studioPhone: STUDIO_PHONE,

    setmoreMockMode: bool(env, 'SETMORE_MOCK_MODE', true),
    setmoreMockScenario: text(env, 'SETMORE_MOCK_SCENARIO', 'normal'),
    setmoreMock429Count: int(env, 'SETMORE_MOCK_429_COUNT', 3),
    setmoreApiBase: text(env, 'SETMORE_API_BASE', 'https://developer.setmore.com/api/v2'),
    setmoreRefreshToken: text(env, 'SETMORE_REFRESH_TOKEN'),
    setmoreAccountId: text(env, 'SETMORE_ACCOUNT_ID', '1a47bbdd-c70e-402d-9bcb-1c739d6752ae'),
    setmoreProviderId: text(env, 'SETMORE_PROVIDER_ID', 'b0bfa3b4-b043-4cec-b841-017a716974fd'),

    tokenRefreshMarginSeconds: int(env, 'TOKEN_REFRESH_MARGIN_SECONDS', 60),
    catalogTtlSeconds: int(env, 'CATALOG_TTL_SECONDS', 600),
    slotsTtlSeconds: int(env, 'SLOTS_TTL_SECONDS', 30),
    setmoreCooldownSeconds: int(env, 'SETMORE_COOLDOWN_SECONDS', 10),
    bookingHorizonDays: int(env, 'BOOKING_HORIZON_DAYS', 56),
    minLeadMinutes: int(env, 'MIN_LEAD_MINUTES', 120),
    customerScanMaxPages: int(env, 'CUSTOMER_SCAN_MAX_PAGES', 3),
    customerSyncPagesPerRun: int(env, 'CUSTOMER_SYNC_PAGES_PER_RUN', 10),
    customerHashSecret: text(env, 'CUSTOMER_HASH_SECRET'),

    paymentsMockMode: bool(env, 'PAYMENTS_MOCK_MODE', true),
    paymentsMockScenario: text(env, 'PAYMENTS_MOCK_SCENARIO', 'approve'),
    squareEnvironment: text(env, 'SQUARE_ENVIRONMENT', 'sandbox'),
    squareApplicationId: text(env, 'SQUARE_APPLICATION_ID'),
    squareLocationId: text(env, 'SQUARE_LOCATION_ID'),
    squareAccessToken: text(env, 'SQUARE_ACCESS_TOKEN'),
    // Square-Version confirmed in the Square API reference on 2026-11-22.
    squareVersion: text(env, 'SQUARE_VERSION', '2026-11-18'),
    squareDelayDuration: delayDuration(env),
    depositAmountCents: int(env, 'DEPOSIT_AMOUNT_CENTS', 5000),
    cardFeeBasisPoints: int(env, 'CARD_FEE_BASIS_POINTS', 0),

    turnstileSiteKey: text(env, 'TURNSTILE_SITE_KEY'),
    turnstileSecretKey: text(env, 'TURNSTILE_SECRET_KEY'),
    salonAlertEmail: text(env, 'SALON_ALERT_EMAIL'),
    alertFromEmail: text(env, 'ALERT_FROM_EMAIL', 'booking-alerts@perfectionbyriri.com')
  };

  if (!['sandbox', 'production'].includes(config.squareEnvironment)) throw misconfigured('SQUARE_ENVIRONMENT');

  const production = config.environment === 'production';
  if (production && config.setmoreMockMode) throw misconfigured('SETMORE_MOCK_MODE');
  if (production && config.paymentsMockMode) throw misconfigured('PAYMENTS_MOCK_MODE');

  if (!config.setmoreMockMode) {
    for (const [name, value] of [
      ['SETMORE_REFRESH_TOKEN', config.setmoreRefreshToken],
      ['SETMORE_ACCOUNT_ID', config.setmoreAccountId],
      ['SETMORE_PROVIDER_ID', config.setmoreProviderId]
    ]) {
      if (!value) throw misconfigured(name);
    }
  }
  if (!config.paymentsMockMode) {
    for (const [name, value] of [
      ['SQUARE_ACCESS_TOKEN', config.squareAccessToken],
      ['SQUARE_APPLICATION_ID', config.squareApplicationId],
      ['SQUARE_LOCATION_ID', config.squareLocationId],
      ['SQUARE_VERSION', config.squareVersion]
    ]) {
      if (!value) throw misconfigured(name);
    }
  }
  if (production) {
    for (const [name, value] of [
      ['CUSTOMER_HASH_SECRET', config.customerHashSecret],
      ['TURNSTILE_SECRET_KEY', config.turnstileSecretKey],
      ['TURNSTILE_SITE_KEY', config.turnstileSiteKey]
    ]) {
      if (!value) throw misconfigured(name);
    }
  }
  // Development fallback so mock runs work without secrets. Never used in production (checked above).
  if (!config.customerHashSecret) config.customerHashSecret = 'development-only-customer-hash-secret';
  return Object.freeze(config);
}
