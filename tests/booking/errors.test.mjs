import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BookingError, SetmoreBusy, SetmoreAuthError, SetmoreConflict, SetmoreRejected,
  SetmoreUnavailable, PaymentDeclined, errorResponse, json
} from '../../worker/src/errors.js';

test('json sets content type and nosniff', async () => {
  const response = json({ ok: true }, 201, { 'Cache-Control': 'no-store' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true });
});

test('BookingError takes its status from the code', () => {
  assert.equal(new BookingError('SLOT_TAKEN').status, 409);
  assert.equal(new BookingError('VALIDATION_FAILED').status, 400);
  assert.equal(new BookingError('BOOKING_PENDING_CONFIRMATION').status, 503);
  assert.equal(new BookingError('MISCONFIGURED').status, 500);
});

test('SetmoreBusy maps to 503 UPSTREAM_BUSY with retry_after_seconds and Retry-After', async () => {
  const response = errorResponse(new SetmoreBusy(3));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '3');
  const body = await response.json();
  assert.equal(body.error.code, 'UPSTREAM_BUSY');
  assert.equal(body.error.retry_after_seconds, 3);
  assert.equal(body.error.fallback_phone, '+14258450045');
});

test('upstream classes map to the error contract', async () => {
  assert.equal((await errorResponse(new SetmoreAuthError()).json()).error.code, 'UPSTREAM_AUTH');
  assert.equal((await errorResponse(new SetmoreConflict()).json()).error.code, 'SLOT_TAKEN');
  assert.equal((await errorResponse(new SetmoreUnavailable()).json()).error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal((await errorResponse(new SetmoreRejected('parameter_invalid')).json()).error.code, 'UPSTREAM_UNAVAILABLE');
  const declined = await errorResponse(new PaymentDeclined('CARD_DECLINED')).json();
  assert.equal(declined.error.code, 'PAYMENT_DECLINED');
  assert.equal(declined.error.decline_reason, 'CARD_DECLINED');
});

test('BookingError extra fields and field errors reach the body', async () => {
  const response = errorResponse(new BookingError('VALIDATION_FAILED', { fields: { email: 'invalid' }, extra: { refreshed_week: { days: [] } } }));
  const body = await response.json();
  assert.deepEqual(body.error.fields, { email: 'invalid' });
  assert.deepEqual(body.refreshed_week, { days: [] });
});

test('unknown errors become 502 without leaking their message', async () => {
  const response = errorResponse(new Error('secret upstream text'));
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.doesNotMatch(text, /secret upstream text/);
  assert.match(text, /UPSTREAM_UNAVAILABLE/);
});
