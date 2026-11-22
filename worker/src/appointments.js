// Appointment orchestration for POST /api/booking/appointments
// (ARCHITECTURE §8.1–§8.3).
//
// Order: fresh slot check → Square authorization (delayed capture) →
// customer → second fresh slot check → KV `booking_requested` → Setmore
// POST /bookings → Square complete → overlap post-check → stored result.
//
// Cancel rule (owner decision 2026-11-22): the authorization is cancelled
// only when the Setmore booking was certainly not created. A timeout,
// network error or 5xx on POST /bookings leaves the record in
// `booking_requested` for the reconciliation cron.
//
// The idempotency record holds ids and states only, never contact details.

import {
  BookingError, SetmoreAuthError, SetmoreBusy, SetmoreConflict, SetmoreNotFound, SetmoreRejected
} from './errors.js';
import { normalizeEmail, normalizePhoneUS } from './customers.js';
import { parseInstant } from './slots.js';
import { addDays, formatRfc3339Local, formatSlotLabel, instantToZonedParts } from './time.js';

export const IDEMPOTENCY_TTL_SECONDS = 259200;
export const FINAL_STATES = new Set(['done', 'failed', 'needs_review']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateAppointmentInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BookingError('VALIDATION_FAILED', { fields: { body: 'Send a JSON object.' } });
  }
  const fields = {};
  const customer = raw.customer && typeof raw.customer === 'object' ? raw.customer : {};

  const idempotencyKey = trimmed(raw.idempotency_key);
  if (!UUID_RE.test(idempotencyKey)) fields.idempotency_key = 'Refresh the page and try again.';
  const serviceId = trimmed(raw.service_id);
  if (!serviceId || serviceId.length > 100) fields.service_id = 'Choose a service.';
  const startAt = trimmed(raw.start_at);
  if (!parseInstant(startAt)) fields.start_at = 'Choose a time from the list.';

  const firstName = trimmed(customer.first_name);
  if (firstName.length < 1 || firstName.length > 60) fields['customer.first_name'] = 'Please enter your first name.';
  const lastName = trimmed(customer.last_name);
  if (lastName.length < 1 || lastName.length > 60) fields['customer.last_name'] = 'Please enter your last name.';
  const email = normalizeEmail(customer.email);
  if (!EMAIL_RE.test(email) || email.length > 254) fields['customer.email'] = 'Please enter a valid email address.';
  const phone = normalizePhoneUS(customer.phone);
  if (!phone) fields['customer.phone'] = 'Please enter a 10-digit US mobile number.';

  let notes = '';
  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== 'string' || raw.notes.trim().length > 500) fields.notes = 'Notes must be 500 characters or fewer.';
    else notes = raw.notes.trim();
  }
  if (raw.policy_accepted !== true) fields.policy_accepted = 'Please accept the booking policy.';

  let payment = null;
  if (raw.payment !== undefined && raw.payment !== null) {
    const sourceId = trimmed(raw.payment.source_id);
    const verificationToken = trimmed(raw.payment.verification_token);
    if (!sourceId || sourceId.length > 500) fields['payment.source_id'] = 'Please enter your card details again.';
    if (verificationToken.length > 4000) fields['payment.verification_token'] = 'Please enter your card details again.';
    payment = { sourceId, verificationToken: verificationToken || null };
  }

  if (Object.keys(fields).length) throw new BookingError('VALIDATION_FAILED', { fields });
  return { idempotencyKey, serviceId, startAt, customer: { firstName, lastName, email, phone }, notes, payment };
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

function bookingNotes(clientNotes, deposit, paymentId) {
  const system = deposit.required
    ? `Deposit paid online via Square: ${dollars(deposit.deposit_cents)}.`
      + (deposit.fee_cents > 0 ? ` Card processing fee: ${dollars(deposit.fee_cents)}.` : '')
      + ` Square payment ${paymentId}. Booked on perfectionbyriri.com.`
    : 'Booked on perfectionbyriri.com.';
  return clientNotes ? `${clientNotes}\n\n${system}` : system;
}

// Setmore answered and did not process the request: safe to cancel the hold.
function definiteRejection(err) {
  return err instanceof SetmoreConflict || err instanceof SetmoreRejected || err instanceof SetmoreNotFound
    || err instanceof SetmoreBusy || err instanceof SetmoreAuthError;
}

export function createAppointmentService({ client, catalog, slots, customers, payments, kv, alerts, config, now = () => new Date(), log = () => {} }) {
  const tz = config.studioTimezone;

  async function create(raw) {
    const input = validateAppointmentInput(raw);
    const idemKey = `idem:${await sha256Hex(input.idempotencyKey)}`;

    const existing = await kv.get(idemKey, 'json');
    if (existing?.result) return { status: 200, body: existing.result };
    if (existing && existing.state !== 'failed') throw new BookingError('IN_PROGRESS');

    const service = await catalog.getService(input.serviceId);
    if (!service) throw new BookingError('NOT_FOUND', { message: 'That service is not available for online booking.' });
    const deposit = service.deposit;
    if (deposit.required && !input.payment) {
      throw new BookingError('VALIDATION_FAILED', { fields: { payment: 'Please enter your card details.' } });
    }

    const createdAt = now().toISOString();
    let record = {
      state: 'started', payment_id: null, booking_id: null, customer_id: null, service_id: service.service_id,
      start_at: null, result: null, created_at: createdAt, updated_at: createdAt, complete_attempts: 0, alerted: []
    };
    async function save(changes) {
      record = { ...record, ...changes, updated_at: now().toISOString() };
      await kv.put(idemKey, JSON.stringify(record), { expirationTtl: IDEMPOTENCY_TTL_SECONDS });
    }
    async function notify(type, data) {
      await alerts.notify(type, data);
      if (!record.alerted.includes(type)) await save({ alerted: [...record.alerted, type] });
    }
    async function cancelHold() {
      if (!record.payment_id) return;
      try {
        await payments.cancel(record.payment_id);
      } catch {
        log('payment_cancel_failed', { payment_id: record.payment_id });
        await notify('payment_cancel_failed', { bookingId: null, paymentId: record.payment_id });
      }
    }
    async function fail(err) {
      await cancelHold();
      await save({ state: 'failed' });
      throw err;
    }
    const slotTaken = (refreshedWeek) => new BookingError('SLOT_TAKEN', { extra: { refreshed_week: refreshedWeek ?? null } });

    await save({});

    // Step 1: fresh slot check (no charge yet).
    let check;
    try {
      check = await slots.isSlotAvailable({ serviceId: service.service_id, startAt: input.startAt });
    } catch (err) {
      return fail(err);
    }
    if (!check.available) return fail(slotTaken(check.refreshedWeek));

    const instant = parseInstant(input.startAt);
    const startParts = instantToZonedParts(instant, tz);
    const endParts = instantToZonedParts(new Date(instant.getTime() + service.duration_minutes * 60000), tz);
    const startAt = formatRfc3339Local(startParts.date, startParts.time, tz);
    const endAt = formatRfc3339Local(endParts.date, endParts.time, tz);
    await save({ start_at: startAt });

    // Step 2: authorize the deposit (amount from the server quote only).
    let receiptUrl = null;
    if (deposit.required) {
      try {
        const authorization = await payments.authorize({
          idempotencyKey: input.idempotencyKey,
          sourceId: input.payment.sourceId,
          verificationToken: input.payment.verificationToken,
          amountCents: deposit.total_cents,
          buyerEmail: input.customer.email,
          note: `Deposit: ${service.name}, ${startParts.date} ${formatSlotLabel(instant, tz)} Pacific`,
          referenceId: input.idempotencyKey.slice(0, 40)
        });
        receiptUrl = authorization.receiptUrl;
        await save({ state: 'payment_authorized', payment_id: authorization.paymentId });
      } catch (err) {
        return fail(err);
      }
    }

    // Step 3: find or create the Setmore customer (after authorization, so declined cards create no contacts).
    let customerId;
    try {
      ({ customerId } = await customers.resolve(input.customer));
      await save({ customer_id: customerId });
    } catch (err) {
      return fail(err);
    }

    // Step 4: second fresh slot check.
    try {
      check = await slots.isSlotAvailable({ serviceId: service.service_id, startAt: input.startAt });
    } catch (err) {
      return fail(err);
    }
    if (!check.available) return fail(slotTaken(check.refreshedWeek));

    // Step 5: record the request before sending it; the cron relies on this order.
    await save({ state: 'booking_requested' });
    let booking;
    try {
      booking = await client.createBooking({
        type: 'APPOINTMENT',
        account_id: config.setmoreAccountId,
        provider_id: config.setmoreProviderId,
        consumer_ids: [customerId],
        service_id: service.service_id,
        start_at: startAt,
        end_at: endAt,
        cost: service.price_cents / 100,
        notes: bookingNotes(input.notes, deposit, record.payment_id)
      });
      if (typeof booking?.id !== 'string' || !booking.id) throw new Error('booking id missing');
    } catch (err) {
      if (definiteRejection(err)) {
        if (err instanceof SetmoreAuthError) await notify('upstream_auth_failed', { bookingId: null, paymentId: record.payment_id });
        if (err instanceof SetmoreConflict) {
          let refreshed = null;
          try {
            refreshed = (await slots.isSlotAvailable({ serviceId: service.service_id, startAt: input.startAt })).refreshedWeek;
          } catch {
            // The 409 still stands without a refreshed week.
          }
          return fail(slotTaken(refreshed));
        }
        return fail(err);
      }
      log('booking_outcome_unknown', { payment_id: record.payment_id });
      throw new BookingError('BOOKING_PENDING_CONFIRMATION');
    }
    await save({ state: 'booking_created', booking_id: booking.id });

    // Step 6: capture. A failure keeps the booking and alerts the salon.
    let depositStatus = 'none';
    let state = 'done';
    if (record.payment_id) {
      try {
        await payments.complete(record.payment_id);
        depositStatus = 'captured';
      } catch {
        depositStatus = 'pending_capture';
        state = 'capture_pending';
        await save({ complete_attempts: 1 });
        await notify('capture_failed_booking_kept', { bookingId: booking.id, paymentId: record.payment_id });
      }
    }

    // Step 7: overlap post-check. Never cancels; alerts the salon.
    try {
      const dayStart = formatRfc3339Local(startParts.date, '00:00', tz);
      const dayEnd = formatRfc3339Local(addDays(startParts.date, 1), '00:00', tz);
      const sameDay = await client.listBookingsByStaff({ staffId: config.setmoreProviderId, startAt: dayStart, endAt: dayEnd });
      const start = instant.getTime();
      const end = start + service.duration_minutes * 60000;
      const others = sameDay.filter((item) => item?.id !== booking.id && item?.status !== 'CANCELLED'
        && Date.parse(item.start_at) < end && start < Date.parse(item.end_at));
      if (others.length) {
        await notify('double_booking_detected', {
          bookingId: booking.id, paymentId: record.payment_id, extra: { other_booking_ids: others.map((item) => item.id) }
        });
      }
    } catch {
      log('post_check_failed', { booking_id: booking.id });
    }

    // Step 8: store the result and purge cached weeks that contain this day.
    const body = {
      booking: { id: booking.id, status: booking.status ?? 'CONFIRMED', service_name: service.name, start_at: startAt, end_at: endAt },
      deposit: {
        status: depositStatus,
        payment_id: record.payment_id,
        total_cents: deposit.required ? deposit.total_cents : 0,
        receipt_url: receiptUrl
      }
    };
    await save({ state, result: body });
    for (let i = 0; i < 7; i += 1) await slots.purgeWeek(service.service_id, addDays(startParts.date, -i));
    return { status: 201, body };
  }

  return { create };
}
