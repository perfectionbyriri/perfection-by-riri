// Step 3 · your details (docs/booking/DESIGN_SPEC.md §4, step 3).
//
// Pure markup. Every error <p> is always present (hidden when empty) so the
// DOM glue in main.js can show or clear one field's message on blur without
// re-rendering the form and losing focus.

import { escapeHtml } from './html.js';
import { FIELD_ORDER } from './validate.js';

// Verbatim from the studio's Setmore page (ARCHITECTURE §11). The catalog's
// checkout.policy_text, when present, replaces it.
export const POLICY_TEXT = 'Cancellations made on the same day as your appointment will result in the forfeiture of your $50 deposit. The deposit is non-refundable for same-day cancellations.';

export function consentLabel(policyText = POLICY_TEXT) {
  return `I agree to the booking policy: ${policyText || POLICY_TEXT}`;
}

const FIELDS = {
  first_name: { label: 'First name', type: 'text', attrs: 'autocomplete="given-name" maxlength="60"' },
  last_name: { label: 'Last name', type: 'text', attrs: 'autocomplete="family-name" maxlength="60"' },
  email: { label: 'Email', type: 'email', attrs: 'autocomplete="email" maxlength="254" spellcheck="false"' },
  phone: { label: 'Mobile phone', type: 'tel', attrs: 'autocomplete="tel-national" inputmode="tel" maxlength="20"' }
};

const errorAttrs = (name, error) => (error ? ` aria-invalid="true" aria-describedby="bk-${name}-error"` : '');

const errorText = (name, error) => (error
  ? `<p class="bk-field-error" id="bk-${name}-error">${escapeHtml(error)}</p>`
  : `<p class="bk-field-error" id="bk-${name}-error" hidden></p>`);

function textField(name, values, errors) {
  const { label, type, attrs } = FIELDS[name];
  return `<div class="bk-field" data-field="${name}">`
    + `<label class="bk-field-label" for="bk-${name}">${label}</label>`
    + `<input class="bk-input" id="bk-${name}" name="${name}" type="${type}" ${attrs} required value="${escapeHtml(values[name] ?? '')}"${errorAttrs(name, errors[name])}>`
    + `${errorText(name, errors[name])}</div>`;
}

export function renderDetails({ values = {}, errors = {}, policyText = POLICY_TEXT } = {}) {
  const notes = `<div class="bk-field bk-field-wide" data-field="notes">`
    + '<label class="bk-field-label" for="bk-notes">Notes for Riri (optional)</label>'
    + `<textarea class="bk-input bk-textarea" id="bk-notes" name="notes" rows="3" maxlength="500"${errorAttrs('notes', errors.notes)}>${escapeHtml(values.notes ?? '')}</textarea>`
    + `${errorText('notes', errors.notes)}</div>`;
  const consent = `<div class="bk-field bk-field-wide bk-consent" data-field="policy_accepted">`
    + `<input class="bk-checkbox" id="bk-policy_accepted" name="policy_accepted" type="checkbox" required${values.policy_accepted === true ? ' checked' : ''}${errorAttrs('policy_accepted', errors.policy_accepted)}>`
    + `<label class="bk-consent-label" for="bk-policy_accepted">${escapeHtml(consentLabel(policyText))}</label>`
    + `${errorText('policy_accepted', errors.policy_accepted)}</div>`;
  return '<form class="bk-form" id="bk-details" novalidate>'
    + '<div class="bk-error-slot"></div>'
    + `<div class="bk-fields">${['first_name', 'last_name', 'email', 'phone'].map((name) => textField(name, values, errors)).join('')}${notes}${consent}</div>`
    + '<p class="bk-fine bk-privacy">We use these details only to manage your appointment. '
    + '<button type="button" class="bk-text-button" data-privacy>Privacy Policy</button></p>'
    + '</form>';
}

export function renderErrorSummary(errors = {}) {
  const items = FIELD_ORDER.filter((name) => errors[name])
    .map((name) => `<li><a href="#bk-${name}">${escapeHtml(errors[name])}</a></li>`);
  if (!items.length) return '';
  return '<div class="bk-error-summary" id="bk-error-summary" tabindex="-1">'
    + `<p class="bk-error-summary-title">Please check ${items.length === 1 ? 'this detail' : 'these details'}:</p>`
    + `<ul>${items.join('')}</ul></div>`;
}
