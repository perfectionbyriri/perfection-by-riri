// Salon alert e-mails (ARCHITECTURE §18).
//
// Each alert carries booking and payment ids only, never client contact
// details. `sendEmail({ from, to, subject, text })` is injected (the Worker
// wires it to the `send_email` binding). notify() never throws.

const ACTIONS = {
  double_booking_detected: 'Two bookings overlap in Setmore. Check the calendar and contact one client to move the time.',
  capture_failed_booking_kept: 'The booking exists, but the deposit was not captured. Capture it by hand in the Square Dashboard within 48 hours.',
  booking_outcome_unknown: 'The booking request did not get a clear answer. Check the Setmore calendar, then capture or cancel the deposit in the Square Dashboard.',
  payment_cancel_failed: 'A deposit hold could not be cancelled. Cancel it by hand in the Square Dashboard.',
  upstream_auth_failed: 'Setmore rejected the booking system\'s credentials. Online booking needs a new Setmore token.',
  orphan_authorization_cancelled: 'A deposit hold without a booking request was cancelled automatically. No action is needed.'
};

const ID_RE = /^[A-Za-z0-9_\-:.]{1,200}$/;

function idList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.every((item) => typeof item === 'string' && ID_RE.test(item)) ? values.join(', ') : null;
}

export function createAlerts({ sendEmail, from, to, log = () => {} }) {
  async function notify(type, { bookingId = null, paymentId = null, extra = {} } = {}) {
    const action = ACTIONS[type];
    if (!action) {
      log('alert_type_unknown', { type });
      return;
    }
    if (!to) {
      log('alert_not_configured', { type });
      return;
    }
    const lines = [
      action,
      '',
      `Alert: ${type}`,
      `Booking id: ${bookingId ?? 'none'}`,
      `Square payment id: ${paymentId ?? 'none'}`
    ];
    // Only id fields (`*_id` or `*_ids`) with id-shaped values are copied.
    for (const [key, value] of Object.entries(extra ?? {})) {
      const ids = /_ids?$/.test(key) ? idList(value) : null;
      if (ids) lines.push(`${key}: ${ids}`);
    }
    try {
      await sendEmail({ from, to, subject: `[Booking alert] ${type}`, text: `${lines.join('\n')}\n` });
    } catch {
      log('alert_send_failed', { type });
    }
  }

  return { notify };
}
