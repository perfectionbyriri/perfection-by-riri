// Reconciliation cron for idempotency records (ARCHITECTURE §8.4).
//
// An authorization is cancelled only when the record proves the Setmore
// booking request was never sent (state `payment_authorized`). A booking
// that exists is never cancelled: its capture is retried up to 3 times.
// A request with an unknown outcome goes to `needs_review` for the salon.

import { FINAL_STATES, IDEMPOTENCY_TTL_SECONDS } from './appointments.js';
import { addDays, formatRfc3339Local, instantToZonedParts } from './time.js';

const MAX_COMPLETE_ATTEMPTS = 3;

async function listKeys(kv, prefix) {
  const names = [];
  let cursor;
  for (;;) {
    const page = await kv.list({ prefix, cursor });
    names.push(...page.keys.map((key) => key.name));
    if (page.list_complete || !page.cursor) return names;
    cursor = page.cursor;
  }
}

export async function reconcileStaleAuthorizations({ kv, payments, client, alerts, config, now = () => new Date(), olderThanMs = 600000, log = () => {} }) {
  const summary = { cancelled: 0, completed: 0, reviewed: 0, alerted: 0 };
  const tz = config.studioTimezone;

  for (const key of await listKeys(kv, 'idem:')) {
    let record = await kv.get(key, 'json');
    if (!record || FINAL_STATES.has(record.state)) continue;
    if (now().getTime() - Date.parse(record.updated_at) < olderThanMs) continue;

    const save = async (changes) => {
      record = { ...record, ...changes, updated_at: now().toISOString() };
      await kv.put(key, JSON.stringify(record), { expirationTtl: IDEMPOTENCY_TTL_SECONDS });
    };
    const alertOnce = async (type, bookingId = record.booking_id) => {
      if ((record.alerted ?? []).includes(type)) return;
      await alerts.notify(type, { bookingId, paymentId: record.payment_id });
      summary.alerted += 1;
      await save({ alerted: [...(record.alerted ?? []), type] });
    };

    if (record.state === 'started') {
      await save({ state: 'failed' });
      continue;
    }

    if (record.state === 'payment_authorized') {
      if (!record.payment_id) {
        await save({ state: 'failed' });
        continue;
      }
      try {
        await payments.cancel(record.payment_id);
      } catch {
        await alertOnce('payment_cancel_failed');
        continue;
      }
      await save({ state: 'failed' });
      summary.cancelled += 1;
      log('orphan_authorization_cancelled', { payment_id: record.payment_id });
      await alertOnce('orphan_authorization_cancelled');
      continue;
    }

    if (record.state === 'booking_requested') {
      let found = null;
      try {
        const instant = Date.parse(record.start_at);
        const date = instantToZonedParts(new Date(instant), tz).date;
        const sameDay = await client.listBookingsByStaff({
          staffId: config.setmoreProviderId,
          startAt: formatRfc3339Local(date, '00:00', tz),
          endAt: formatRfc3339Local(addDays(date, 1), '00:00', tz)
        });
        found = sameDay.find((item) => item?.service_id === record.service_id
          && Date.parse(item.start_at) === instant
          && Array.isArray(item.consumer_ids) && item.consumer_ids.includes(record.customer_id)
          && item.status !== 'CANCELLED') ?? null;
      } catch {
        found = null;
      }
      if (!found) {
        await save({ state: 'needs_review' });
        summary.reviewed += 1;
        await alertOnce('booking_outcome_unknown');
        continue;
      }
      await save({ state: 'booking_created', booking_id: found.id });
    }

    if (record.state === 'booking_created' || record.state === 'capture_pending') {
      if (!record.payment_id) {
        await save({ state: 'done' });
        continue;
      }
      if ((record.complete_attempts ?? 0) >= MAX_COMPLETE_ATTEMPTS) continue;
      try {
        await payments.complete(record.payment_id);
      } catch {
        await save({ state: 'capture_pending', complete_attempts: (record.complete_attempts ?? 0) + 1 });
        await alertOnce('capture_failed_booking_kept');
        continue;
      }
      const result = record.result ? { ...record.result, deposit: { ...record.result.deposit, status: 'captured' } } : null;
      await save({ state: 'done', result });
      summary.completed += 1;
    }
  }
  return summary;
}
