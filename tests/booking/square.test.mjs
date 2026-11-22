import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSquarePayments } from '../../worker/src/payments/square.js';
import { createMockSquare } from '../../worker/src/payments/mock.js';
import { PaymentDeclined, PaymentUnavailable } from '../../worker/src/errors.js';
import { createFetchRecorder } from './helpers/fakes.mjs';

const TOKEN = 'EAAA-SQUARE-SECRET-TOKEN';
const APPROVED = { body: { payment: { id: 'pay_1', status: 'APPROVED', receipt_url: 'https://squareup.com/receipt/preview/pay_1' } } };
const AUTH = {
  idempotencyKey: 'idem-123', sourceId: 'cnon:card-nonce-ok', verificationToken: 'verf-1', amountCents: 5000,
  buyerEmail: 'anna@example.com', note: 'Deposit for Lash Lift', referenceId: 'bkg-ref-1'
};

function sequence(...responses) {
  let i = 0;
  return () => responses[Math.min(i++, responses.length - 1)];
}

function setup(routes, overrides = {}) {
  const recorder = createFetchRecorder(routes);
  const payments = createSquarePayments({
    accessToken: TOKEN, environment: 'production', locationId: 'LOC1', version: '2026-11-18', delayDuration: 'PT48H',
    fetch: recorder.fetch, ...overrides
  });
  return { payments, recorder };
}

const decline = (code, status = 400) => ({ status, body: { errors: [{ category: 'PAYMENT_METHOD_ERROR', code, detail: 'Card declined.' }] } });

test('authorize sends a delayed-capture request with the server amount', async () => {
  const { payments, recorder } = setup({ 'POST /v2/payments': APPROVED });
  const result = await payments.authorize(AUTH);
  assert.deepEqual(result, { paymentId: 'pay_1', receiptUrl: 'https://squareup.com/receipt/preview/pay_1' });
  const [call] = recorder.calls;
  assert.equal(call.url.origin, 'https://connect.squareup.com');
  assert.deepEqual(call.body, {
    idempotency_key: 'idem-123',
    source_id: 'cnon:card-nonce-ok',
    verification_token: 'verf-1',
    amount_money: { amount: 5000, currency: 'USD' },
    autocomplete: false,
    delay_duration: 'PT48H',
    delay_action: 'CANCEL',
    location_id: 'LOC1',
    buyer_email_address: 'anna@example.com',
    note: 'Deposit for Lash Lift',
    reference_id: 'bkg-ref-1'
  });
  assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(call.init.headers['Square-Version'], '2026-11-18');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
});

test('authorize omits an absent verification token and trims note and reference_id to Square limits', async () => {
  const { payments, recorder } = setup({ 'POST /v2/payments': APPROVED });
  await payments.authorize({ ...AUTH, verificationToken: undefined, note: 'n'.repeat(600), referenceId: 'r'.repeat(50) });
  const { body } = recorder.calls[0];
  assert.ok(!('verification_token' in body));
  assert.equal(body.note.length, 500);
  assert.equal(body.reference_id.length, 40);
});

test('the sandbox host is used when environment is sandbox', async () => {
  const { payments, recorder } = setup({ 'POST /v2/payments': APPROVED }, { environment: 'sandbox' });
  await payments.authorize(AUTH);
  assert.equal(recorder.calls[0].url.origin, 'https://connect.squareupsandbox.com');
});

test('a decline maps to PaymentDeclined with its category', async () => {
  for (const [code, status] of [['CARD_DECLINED', 402], ['CVV_FAILURE', 400], ['ADDRESS_VERIFICATION_FAILURE', 400], ['INSUFFICIENT_FUNDS', 400], ['GENERIC_DECLINE', 400]]) {
    const { payments, recorder } = setup({ 'POST /v2/payments': decline(code, status) });
    await assert.rejects(payments.authorize(AUTH), (err) => err instanceof PaymentDeclined && err.category === code, code);
    assert.equal(recorder.calls.length, 1, 'a decline is never retried');
  }
});

test('other payment-method errors become GENERIC_DECLINE', async () => {
  const { payments } = setup({ 'POST /v2/payments': decline('CARD_EXPIRED') });
  await assert.rejects(payments.authorize(AUTH), (err) => err instanceof PaymentDeclined && err.category === 'GENERIC_DECLINE');
});

test('a non-approved payment status is a decline', async () => {
  const { payments } = setup({ 'POST /v2/payments': { body: { payment: { id: 'pay_1', status: 'FAILED' } } } });
  await assert.rejects(payments.authorize(AUTH), (err) => err instanceof PaymentDeclined && err.category === 'GENERIC_DECLINE');
});

test('authorize 500 twice → PaymentUnavailable; one retry with the same idempotency key', async () => {
  const { payments, recorder } = setup({ 'POST /v2/payments': { status: 500, body: { errors: [{ category: 'API_ERROR', code: 'INTERNAL_SERVER_ERROR' }] } } });
  await assert.rejects(payments.authorize(AUTH), PaymentUnavailable);
  assert.equal(recorder.calls.length, 2);
  assert.ok(recorder.calls.every((call) => call.body.idempotency_key === 'idem-123'));
});

test('authorize succeeds after one 503', async () => {
  const { payments } = setup({ 'POST /v2/payments': sequence({ status: 503, body: {} }, APPROVED) });
  assert.equal((await payments.authorize(AUTH)).paymentId, 'pay_1');
});

test('an authentication or request error is PaymentUnavailable, not a decline', async () => {
  const { payments } = setup({ 'POST /v2/payments': { status: 401, body: { errors: [{ category: 'AUTHENTICATION_ERROR', code: 'UNAUTHORIZED' }] } } });
  await assert.rejects(payments.authorize(AUTH), PaymentUnavailable);
});

test('a network error is PaymentUnavailable', async () => {
  const { payments } = setup({ 'POST /v2/payments': new TypeError('fetch failed') });
  await assert.rejects(payments.authorize(AUTH), PaymentUnavailable);
});

test('complete and cancel post to the payment id', async () => {
  const { payments, recorder } = setup({
    'POST /v2/payments/pay_1/complete': { body: { payment: { id: 'pay_1', status: 'COMPLETED' } } },
    'POST /v2/payments/pay_1/cancel': { body: { payment: { id: 'pay_1', status: 'CANCELED' } } }
  });
  await payments.complete('pay_1');
  await payments.cancel('pay_1');
  assert.deepEqual(recorder.calls.map((call) => `${call.method} ${call.path}`), ['POST /v2/payments/pay_1/complete', 'POST /v2/payments/pay_1/cancel']);
});

test('cancel retries once on 503, then succeeds', async () => {
  const { payments, recorder } = setup({
    'POST /v2/payments/pay_1/cancel': sequence({ status: 503, body: {} }, { body: { payment: { id: 'pay_1', status: 'CANCELED' } } })
  });
  await payments.cancel('pay_1');
  assert.equal(recorder.calls.length, 2);
});

test('cancel fails with PaymentUnavailable after two 503s', async () => {
  const { payments, recorder } = setup({ 'POST /v2/payments/pay_1/cancel': { status: 503, body: {} } });
  await assert.rejects(payments.cancel('pay_1'), PaymentUnavailable);
  assert.equal(recorder.calls.length, 2);
});

test('complete on an already completed payment is treated as done after a status check', async () => {
  const { payments, recorder } = setup({
    'POST /v2/payments/pay_1/complete': { status: 400, body: { errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'BAD_REQUEST' }] } },
    'GET /v2/payments/pay_1': { body: { payment: { id: 'pay_1', status: 'COMPLETED' } } }
  });
  await payments.complete('pay_1');
  assert.equal(recorder.calls.length, 2);
});

test('cancel rejected for a completed payment is PaymentUnavailable', async () => {
  const { payments } = setup({
    'POST /v2/payments/pay_1/cancel': { status: 400, body: { errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'BAD_REQUEST' }] } },
    'GET /v2/payments/pay_1': { body: { payment: { id: 'pay_1', status: 'COMPLETED' } } }
  });
  await assert.rejects(payments.cancel('pay_1'), PaymentUnavailable);
});

test('the access token never appears in thrown errors', async () => {
  const echo = { status: 500, body: { errors: [{ category: 'API_ERROR', code: 'INTERNAL', detail: `token ${TOKEN}` }] } };
  const { payments } = setup({ 'POST /v2/payments': echo, 'POST /v2/payments/pay_1/cancel': echo, 'GET /v2/payments/pay_1': echo });
  for (const action of [() => payments.authorize(AUTH), () => payments.cancel('pay_1')]) {
    await assert.rejects(action(), (err) => !String(err).includes(TOKEN) && !String(err.stack).includes(TOKEN) && !JSON.stringify(err).includes(TOKEN));
  }
});

test('mock approve authorizes, completes and cancels; the same key returns the same payment', async () => {
  const square = createMockSquare({ scenario: 'approve' });
  const first = await square.authorize(AUTH);
  const again = await square.authorize(AUTH);
  assert.equal(again.paymentId, first.paymentId);
  assert.equal(square.payments.get(first.paymentId).status, 'APPROVED');
  assert.equal(square.payments.get(first.paymentId).amountCents, 5000);
  await square.complete(first.paymentId);
  assert.equal(square.payments.get(first.paymentId).status, 'COMPLETED');
  const second = await square.authorize({ ...AUTH, idempotencyKey: 'idem-456' });
  await square.cancel(second.paymentId);
  assert.equal(square.payments.get(second.paymentId).status, 'CANCELED');
  assert.deepEqual(square.calls.map((call) => call.method), ['authorize', 'authorize', 'complete', 'authorize', 'cancel']);
});

test('mock decline throws PaymentDeclined(CARD_DECLINED) and records no payment', async () => {
  const square = createMockSquare({ scenario: 'decline' });
  await assert.rejects(square.authorize(AUTH), (err) => err instanceof PaymentDeclined && err.category === 'CARD_DECLINED');
  assert.equal(square.payments.size, 0);
});

test('mock complete_fails authorizes but complete throws PaymentUnavailable', async () => {
  const square = createMockSquare({ scenario: 'complete_fails' });
  const { paymentId } = await square.authorize(AUTH);
  await assert.rejects(square.complete(paymentId), PaymentUnavailable);
  assert.equal(square.payments.get(paymentId).status, 'APPROVED');
  await square.cancel(paymentId);
  assert.equal(square.payments.get(paymentId).status, 'CANCELED');
});
