// MockSquare for PAYMENTS_MOCK_MODE=true (ARCHITECTURE §13).
//
// Scenarios: approve (default), decline, complete_fails. Payments live in
// memory; the same idempotency key returns the same payment, as in Square.

import { PaymentDeclined, PaymentUnavailable } from '../errors.js';

export const MOCK_PAYMENT_SCENARIOS = ['approve', 'decline', 'complete_fails'];

export function createMockSquare({ scenario = 'approve' } = {}) {
  const payments = new Map();
  const byKey = new Map();
  const calls = [];
  let sequence = 0;

  function find(paymentId) {
    const payment = payments.get(paymentId);
    if (!payment) throw new PaymentUnavailable();
    return payment;
  }

  return {
    payments,
    calls,

    async authorize({ idempotencyKey, amountCents, referenceId }) {
      calls.push({ method: 'authorize', idempotencyKey, amountCents });
      if (byKey.has(idempotencyKey)) return { paymentId: byKey.get(idempotencyKey), receiptUrl: null };
      if (scenario === 'decline') throw new PaymentDeclined('CARD_DECLINED');
      sequence += 1;
      const paymentId = `mock_pay_${String(sequence).padStart(6, '0')}`;
      payments.set(paymentId, { id: paymentId, status: 'APPROVED', amountCents, referenceId: referenceId ?? null });
      byKey.set(idempotencyKey, paymentId);
      return { paymentId, receiptUrl: null };
    },

    async complete(paymentId) {
      calls.push({ method: 'complete', paymentId });
      const payment = find(paymentId);
      if (scenario === 'complete_fails') throw new PaymentUnavailable();
      if (payment.status === 'COMPLETED') return;
      if (payment.status !== 'APPROVED') throw new PaymentUnavailable();
      payment.status = 'COMPLETED';
    },

    async cancel(paymentId) {
      calls.push({ method: 'cancel', paymentId });
      const payment = find(paymentId);
      if (payment.status === 'CANCELED') return;
      if (payment.status !== 'APPROVED') throw new PaymentUnavailable();
      payment.status = 'CANCELED';
    }
  };
}
