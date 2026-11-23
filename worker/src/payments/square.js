// Square Payments adapter with delayed capture (ARCHITECTURE §8, §11).
//
// Facts checked in the Square API reference on 2026-11-22 (Square-Version
// 2026-11-18): POST /v2/payments with autocomplete=false holds the card;
// delay_duration is valid for card-not-present payments below P7D;
// delay_action is CANCEL or COMPLETE; POST /v2/payments/{id}/complete and
// /cancel act on APPROVED payments; most declines are HTTP 400 with
// category PAYMENT_METHOD_ERROR, a few are 402.
//
// Complete and cancel are not documented as idempotent, so a 4xx is
// followed by GET /v2/payments/{id}: if the payment already has the target
// status, the call counts as done. Errors carry fixed messages only; the
// access token and provider text never leave this module.

import { PaymentDeclined, PaymentUnavailable } from '../errors.js';

const HOSTS = { production: 'https://connect.squareup.com', sandbox: 'https://connect.squareupsandbox.com' };
const DECLINE_CATEGORIES = new Set(['CARD_DECLINED', 'CVV_FAILURE', 'ADDRESS_VERIFICATION_FAILURE', 'INSUFFICIENT_FUNDS', 'GENERIC_DECLINE']);
const NOTE_MAX = 500;
const REFERENCE_MAX = 40;

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createSquarePayments({ accessToken, environment, locationId, version, delayDuration, fetch, timeoutMs = 10000 }) {
  const host = HOSTS[environment];
  if (!host) throw new PaymentUnavailable();

  // Returns { response, body } or null on a network error or timeout.
  async function send(method, path, body) {
    try {
      const response = await fetch(new URL(path, host), {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Square-Version': version,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      });
      return { response, body: await readJson(response) };
    } catch {
      return null;
    }
  }

  const retryable = (result) => result === null || result.response.status >= 500;

  // One retry on a network error or 5xx. Safe for authorize because Square
  // deduplicates by idempotency_key, and for complete/cancel because a repeat
  // either succeeds or is resolved by the status check below.
  async function sendWithRetry(method, path, body) {
    let result = await send(method, path, body);
    if (retryable(result)) result = await send(method, path, body);
    return result;
  }

  async function authorize({ idempotencyKey, sourceId, verificationToken, amountCents, buyerEmail, note, referenceId }) {
    const body = {
      idempotency_key: idempotencyKey,
      source_id: sourceId,
      ...(verificationToken ? { verification_token: verificationToken } : {}),
      amount_money: { amount: amountCents, currency: 'USD' },
      autocomplete: false,
      delay_duration: delayDuration,
      delay_action: 'CANCEL',
      location_id: locationId,
      ...(buyerEmail ? { buyer_email_address: buyerEmail } : {}),
      ...(note ? { note: String(note).slice(0, NOTE_MAX) } : {}),
      ...(referenceId ? { reference_id: String(referenceId).slice(0, REFERENCE_MAX) } : {})
    };
    const result = await sendWithRetry('POST', '/v2/payments', body);
    if (retryable(result)) throw new PaymentUnavailable();
    const { response, body: reply } = result;
    if (!response.ok) {
      const error = Array.isArray(reply?.errors) ? reply.errors.find((item) => item?.category === 'PAYMENT_METHOD_ERROR') : null;
      if (error) throw new PaymentDeclined(DECLINE_CATEGORIES.has(error.code) ? error.code : 'GENERIC_DECLINE');
      throw new PaymentUnavailable();
    }
    const payment = reply?.payment;
    if (typeof payment?.id !== 'string' || !payment.id) throw new PaymentUnavailable();
    if (payment.status !== 'APPROVED') throw new PaymentDeclined('GENERIC_DECLINE');
    return { paymentId: payment.id, receiptUrl: typeof payment.receipt_url === 'string' ? payment.receipt_url : null };
  }

  async function transition(paymentId, action, targetStatus) {
    const id = encodeURIComponent(paymentId);
    const result = await sendWithRetry('POST', `/v2/payments/${id}/${action}`, {});
    if (retryable(result)) throw new PaymentUnavailable();
    if (result.response.ok) return;
    const check = await send('GET', `/v2/payments/${id}`);
    if (check?.response.ok && check.body?.payment?.status === targetStatus) return;
    throw new PaymentUnavailable();
  }

  return {
    authorize,
    complete: (paymentId) => transition(paymentId, 'complete', 'COMPLETED'),
    cancel: (paymentId) => transition(paymentId, 'cancel', 'CANCELED')
  };
}
