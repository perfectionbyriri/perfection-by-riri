import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_ORDER, formatPhone, validateDetails } from '../../New Perfection/js/booking/validate.js';

const good = () => ({
  first_name: 'Anna',
  last_name: 'Smith',
  email: 'anna@example.com',
  phone: '(425) 845 0045',
  notes: '',
  policy_accepted: true
});

test('valid details pass with no errors', () => {
  assert.deepEqual(validateDetails(good()), { valid: true, errors: {} });
});

test('first name is required and limited to 60 characters', () => {
  assert.equal(validateDetails({ ...good(), first_name: '   ' }).errors.first_name, 'Please enter your first name.');
  assert.equal(validateDetails({ ...good(), first_name: 'a'.repeat(61) }).errors.first_name, 'Please enter your first name.');
  assert.equal(validateDetails({ ...good(), first_name: 'a'.repeat(60) }).valid, true);
});

test('last name is required and limited to 60 characters', () => {
  assert.equal(validateDetails({ ...good(), last_name: '' }).errors.last_name, 'Please enter your last name.');
  assert.equal(validateDetails({ ...good(), last_name: 'b'.repeat(61) }).errors.last_name, 'Please enter your last name.');
});

test('email must look valid and stay within 254 characters', () => {
  assert.equal(validateDetails({ ...good(), email: 'anna@example' }).errors.email, 'Please enter a valid email address.');
  assert.equal(validateDetails({ ...good(), email: 'anna example.com' }).errors.email, 'Please enter a valid email address.');
  assert.equal(validateDetails({ ...good(), email: `${'a'.repeat(245)}@example.com` }).errors.email, 'Please enter a valid email address.');
  assert.equal(validateDetails({ ...good(), email: ' Anna@Example.COM ' }).valid, true);
});

test('phone accepts US formats and rejects anything but 10 digits (or 1 + 10)', () => {
  for (const phone of ['(425) 845 0045', '425.845.0045', '+1 (425) 845-0045', '14258450045']) {
    assert.equal(validateDetails({ ...good(), phone }).valid, true, phone);
  }
  for (const phone of ['', '845 0045', '24258450045', '425845004512']) {
    assert.equal(validateDetails({ ...good(), phone }).errors.phone, 'Please enter a 10-digit US mobile number.', phone);
  }
});

test('notes are optional and limited to 500 characters', () => {
  assert.equal(validateDetails({ ...good(), notes: undefined }).valid, true);
  assert.equal(validateDetails({ ...good(), notes: 'n'.repeat(500) }).valid, true);
  assert.equal(validateDetails({ ...good(), notes: 'n'.repeat(501) }).errors.notes, 'Notes must be 500 characters or fewer.');
});

test('policy consent is required', () => {
  assert.equal(validateDetails({ ...good(), policy_accepted: false }).errors.policy_accepted, 'Please accept the booking policy.');
  assert.equal(validateDetails({ ...good(), policy_accepted: 'on' }).valid, false);
});

test('errors follow form order so focus can move to the first invalid field', () => {
  const { valid, errors } = validateDetails({ ...good(), first_name: '', phone: '1', policy_accepted: false });
  assert.equal(valid, false);
  assert.deepEqual(Object.keys(errors), ['first_name', 'phone', 'policy_accepted']);
  assert.deepEqual(FIELD_ORDER, ['first_name', 'last_name', 'email', 'phone', 'notes', 'policy_accepted']);
});

test('formatPhone shows a valid number as (425) 845 0045 and leaves other input alone', () => {
  assert.equal(formatPhone('4258450045'), '(425) 845 0045');
  assert.equal(formatPhone('+1 425-845-0045'), '(425) 845 0045');
  assert.equal(formatPhone('845 00'), '845 00');
});
