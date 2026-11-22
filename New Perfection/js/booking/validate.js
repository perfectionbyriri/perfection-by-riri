// Step 3 details validation (docs/booking/DESIGN_SPEC.md §4, step 3).
//
// Mirrors the server rules in worker/src/appointments.js so the client shows
// the same messages before a request is sent. The server stays the authority.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const FIELD_ORDER = ['first_name', 'last_name', 'email', 'phone', 'notes', 'policy_accepted'];

export const MESSAGES = {
  first_name: 'Please enter your first name.',
  last_name: 'Please enter your last name.',
  email: 'Please enter a valid email address.',
  phone: 'Please enter a 10-digit US mobile number.',
  notes: 'Notes must be 500 characters or fewer.',
  policy_accepted: 'Please accept the booking policy.'
};

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// Ten US digits, or 11 starting with the country code 1; otherwise null.
export function phoneDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

export function formatPhone(value) {
  const digits = phoneDigits(value);
  if (!digits) return String(value ?? '');
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

export function validateDetails(values = {}) {
  const errors = {};
  const firstName = trimmed(values.first_name);
  if (firstName.length < 1 || firstName.length > 60) errors.first_name = MESSAGES.first_name;
  const lastName = trimmed(values.last_name);
  if (lastName.length < 1 || lastName.length > 60) errors.last_name = MESSAGES.last_name;
  const email = trimmed(values.email);
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = MESSAGES.email;
  if (!phoneDigits(values.phone)) errors.phone = MESSAGES.phone;
  if (values.notes !== undefined && values.notes !== null && trimmed(String(values.notes)).length > 500) errors.notes = MESSAGES.notes;
  if (values.policy_accepted !== true) errors.policy_accepted = MESSAGES.policy_accepted;
  return { valid: Object.keys(errors).length === 0, errors };
}
