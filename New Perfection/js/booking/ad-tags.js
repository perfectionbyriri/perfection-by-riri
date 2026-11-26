// Ad conversions for a paid booking (docs/superpowers/specs/2026-11-26-ads-tracking-design.md).
//
// fireConfirmation (confirm.js) calls sendAdConversions once per confirmed,
// paid booking. Google Ads gets the existing "Setmore - Confirmed Paid Booking"
// conversion with enhanced-conversion user data (the Google tag hashes it);
// Meta gets Schedule, the event the studio's Meta ads optimize for. Email and
// phone go to the Google tag only. Each call is isolated: an ad blocker or a
// failing tag never stops the others or the confirmation view.

export const ADS_SEND_TO = 'AW-16731910684/qZuaCNy3164dEJzksqo-';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function toE164(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function userData({ email, phone } = {}) {
  const data = {};
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  if (EMAIL_PATTERN.test(cleanEmail)) data.email = cleanEmail;
  const phoneNumber = toE164(phone);
  if (phoneNumber) data.phone_number = phoneNumber;
  return Object.keys(data).length ? data : null;
}

export function sendAdConversions(detail, { gtag, fbq, contact } = {}) {
  if (typeof gtag === 'function') {
    const data = userData(contact);
    if (data) {
      try { gtag('set', 'user_data', data); } catch { /* the conversion still counts without it */ }
    }
    try {
      gtag('event', 'conversion', {
        send_to: ADS_SEND_TO, value: detail.value, currency: detail.currency, transaction_id: detail.booking_id
      });
    } catch { /* analytics must never break the confirmation */ }
  }
  if (typeof fbq === 'function') {
    try {
      fbq('track', 'Schedule', { value: detail.value, currency: detail.currency, content_ids: [detail.service_id] }, { eventID: detail.booking_id });
    } catch { /* same */ }
  }
}
