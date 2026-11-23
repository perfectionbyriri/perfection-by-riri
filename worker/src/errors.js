// Error contract for /api/booking/* (ARCHITECTURE §12.2).
//
// Client-facing messages are fixed English strings. Upstream error text is
// never copied into a response, because it can echo request details.

export const STUDIO_PHONE = '+14258450045';

const CODES = {
  VALIDATION_FAILED: { status: 400, message: 'Please check the highlighted details and try again.' },
  OUT_OF_RANGE: { status: 400, message: 'That week is outside the booking window.' },
  TURNSTILE_FAILED: { status: 403, message: 'We could not verify this request. Please refresh the page and try again.' },
  FORBIDDEN_ORIGIN: { status: 403, message: 'This request is not allowed.' },
  NOT_FOUND: { status: 404, message: 'Not found.' },
  PAYMENT_DECLINED: { status: 402, message: 'Your card was declined. Please try another card.' },
  SLOT_TAKEN: { status: 409, message: 'That time was just booked by someone else. Please choose another time.' },
  IN_PROGRESS: { status: 409, message: 'Your booking is already being processed. Please wait a moment.' },
  ATTEMPT_ENDED: { status: 409, message: 'This booking attempt has ended and your card was not charged. Please try again.' },
  RATE_LIMITED: { status: 429, message: 'Too many attempts. Please wait a few minutes and try again.' },
  UPSTREAM_UNAVAILABLE: { status: 502, message: 'Online booking is taking a short break. Please call (425) 845 0045 and we will book you in.' },
  UPSTREAM_AUTH: { status: 502, message: 'Online booking is taking a short break. Please call (425) 845 0045 and we will book you in.' },
  UPSTREAM_INVALID: { status: 502, message: 'Online booking is taking a short break. Please call (425) 845 0045 and we will book you in.' },
  UPSTREAM_BUSY: { status: 503, message: 'Our booking calendar is busy right now. Please try again in a minute, or call (425) 845 0045.' },
  BOOKING_PENDING_CONFIRMATION: {
    status: 503,
    message: "We couldn't confirm your booking yet. Your card has not been charged. The studio will confirm with you shortly, or call (425) 845 0045."
  },
  MISCONFIGURED: { status: 500, message: 'Online booking is not available right now. Please call (425) 845 0045.' }
};

export class BookingError extends Error {
  constructor(code, { message, retryAfterSeconds = null, fields, extra, declineReason } = {}) {
    const known = CODES[code] ?? CODES.UPSTREAM_UNAVAILABLE;
    super(message ?? known.message);
    this.name = 'BookingError';
    this.code = CODES[code] ? code : 'UPSTREAM_UNAVAILABLE';
    this.status = known.status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.fields = fields;
    this.extra = extra;
    this.declineReason = declineReason;
  }
}

class UpstreamError extends Error {
  constructor(name, message) {
    super(message);
    this.name = name;
  }
}

export class SetmoreBusy extends UpstreamError {
  constructor(retryAfterSeconds = null) {
    super('SetmoreBusy', 'Setmore rate limited the request');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class SetmoreUnavailable extends UpstreamError {
  constructor() {
    super('SetmoreUnavailable', 'Setmore could not be reached');
  }
}

export class SetmoreAuthError extends UpstreamError {
  constructor() {
    super('SetmoreAuthError', 'Setmore rejected the access token');
  }
}

export class SetmoreConflict extends UpstreamError {
  constructor() {
    super('SetmoreConflict', 'Setmore reported a conflict');
  }
}

export class SetmoreNotFound extends UpstreamError {
  constructor() {
    super('SetmoreNotFound', 'Setmore resource not found');
  }
}

// A definite 4xx rejection with a Setmore error body: the request was not processed.
export class SetmoreRejected extends UpstreamError {
  constructor(upstreamCode = 'unknown') {
    super('SetmoreRejected', 'Setmore rejected the request');
    this.upstreamCode = upstreamCode;
  }
}

export class SetmoreInvalidResponse extends UpstreamError {
  constructor() {
    super('SetmoreInvalidResponse', 'Setmore returned an unexpected response');
  }
}

export class PaymentDeclined extends UpstreamError {
  constructor(category = 'GENERIC_DECLINE') {
    super('PaymentDeclined', 'The card was declined');
    this.category = category;
  }
}

export class PaymentUnavailable extends UpstreamError {
  constructor() {
    super('PaymentUnavailable', 'The payment provider could not be reached');
  }
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}

export function toBookingError(err) {
  if (err instanceof BookingError) return err;
  if (err instanceof SetmoreBusy) return new BookingError('UPSTREAM_BUSY', { retryAfterSeconds: err.retryAfterSeconds });
  if (err instanceof SetmoreAuthError) return new BookingError('UPSTREAM_AUTH');
  if (err instanceof SetmoreConflict) return new BookingError('SLOT_TAKEN');
  if (err instanceof SetmoreInvalidResponse) return new BookingError('UPSTREAM_INVALID');
  if (err instanceof PaymentDeclined) return new BookingError('PAYMENT_DECLINED', { declineReason: err.category });
  return new BookingError('UPSTREAM_UNAVAILABLE');
}

export function errorResponse(err) {
  const error = toBookingError(err);
  const body = {
    error: {
      code: error.code,
      message: error.message,
      retry_after_seconds: error.retryAfterSeconds ?? null,
      fallback_phone: STUDIO_PHONE
    }
  };
  if (error.fields) body.error.fields = error.fields;
  if (error.declineReason) body.error.decline_reason = error.declineReason;
  if (error.extra) Object.assign(body, error.extra);
  const headers = error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {};
  return json(body, error.status, headers);
}
