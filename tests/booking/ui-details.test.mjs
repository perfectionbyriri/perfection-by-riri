import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_TEXT, consentLabel, renderDetails, renderErrorSummary } from '../../New Perfection/js/booking/render-details.js';

const field = (html, name) => html.match(new RegExp(`<div class="bk-field[^"]*" data-field="${name}">[\\s\\S]*?</div>`))?.[0] ?? '';
const control = (html, name) => field(html, name).match(/<(input|textarea)\b[^>]*>/)?.[0] ?? '';

test('the form has every D§4 field with its autocomplete and input type', () => {
  const html = renderDetails({ values: {}, errors: {} });
  assert.match(control(html, 'first_name'), /type="text"[^>]*autocomplete="given-name"/);
  assert.match(control(html, 'last_name'), /type="text"[^>]*autocomplete="family-name"/);
  assert.match(control(html, 'email'), /type="email"[^>]*autocomplete="email"/);
  assert.match(control(html, 'phone'), /type="tel"[^>]*autocomplete="tel-national"[^>]*inputmode="tel"/);
  assert.match(control(html, 'notes'), /<textarea\b[^>]*rows="3"/);
  assert.match(control(html, 'policy_accepted'), /type="checkbox"/);
  assert.match(field(html, 'first_name'), /<label class="bk-field-label" for="bk-first_name">First name<\/label>/);
  assert.match(field(html, 'notes'), /Notes for Riri \(optional\)/);
  assert.doesNotMatch(control(html, 'notes'), /required/);
  assert.match(control(html, 'first_name'), /required/);
});

test('entered values are rendered back, escaped, so nothing typed is lost', () => {
  const html = renderDetails({ values: { first_name: 'Anna "A" <b>', notes: 'First <visit>', policy_accepted: true }, errors: {} });
  assert.match(control(html, 'first_name'), /value="Anna &quot;A&quot; &lt;b&gt;"/);
  assert.match(field(html, 'notes'), />First &lt;visit&gt;<\/textarea>/);
  assert.match(control(html, 'policy_accepted'), /checked/);
});

test('an error is linked with aria-describedby and aria-invalid', () => {
  const html = renderDetails({ values: {}, errors: { first_name: 'Please enter your first name.' } });
  assert.match(control(html, 'first_name'), /aria-invalid="true"[^>]*aria-describedby="bk-first_name-error"/);
  assert.match(field(html, 'first_name'), /<p class="bk-field-error" id="bk-first_name-error">Please enter your first name\.<\/p>/);
  assert.doesNotMatch(control(html, 'last_name'), /aria-invalid|aria-describedby/);
  assert.match(field(html, 'last_name'), /<p class="bk-field-error" id="bk-last_name-error" hidden><\/p>/);
});

test('the consent label quotes the booking policy verbatim', () => {
  assert.equal(consentLabel(), 'I agree to the booking policy: Cancellations made on the same day as your appointment will result in the forfeiture of your $50 deposit. The deposit is non-refundable for same-day cancellations.');
  assert.equal(consentLabel(POLICY_TEXT), consentLabel());
  const html = renderDetails({ values: {}, errors: {} });
  assert.match(field(html, 'policy_accepted'), /I agree to the booking policy: Cancellations made on the same day/);
});

test('the privacy line opens the Privacy Policy dialog', () => {
  const html = renderDetails({ values: {}, errors: {} });
  assert.match(html, /We use these details only to manage your appointment\./);
  assert.match(html, /<button type="button" class="bk-text-button" data-privacy>Privacy Policy<\/button>/);
});

test('the error summary links each problem to its field, in form order', () => {
  const html = renderErrorSummary({ phone: 'Please enter a 10-digit US mobile number.', first_name: 'Please enter your first name.' });
  assert.match(html, /class="bk-error-summary"/);
  const links = [...html.matchAll(/<a href="#(bk-[a-z_]+)">([^<]+)<\/a>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(links, [['bk-first_name', 'Please enter your first name.'], ['bk-phone', 'Please enter a 10-digit US mobile number.']]);
  assert.equal(renderErrorSummary({}), '');
});
