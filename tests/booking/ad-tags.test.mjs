import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADS_SEND_TO, sendAdConversions, toE164, userData } from '../../New Perfection/js/booking/ad-tags.js';

const DETAIL = {
  booking_id: 'bk_123', payment_id: 'sq_pay_456', deposit_cents: 5000, value: 50, currency: 'USD',
  service_id: 'svc_lash_lift', service_name: 'Lash lift'
};
const CONTACT = { email: 'a@b.co', phone: '4258450045' };

function recorders() {
  const gtagCalls = [];
  const fbqCalls = [];
  return { gtagCalls, fbqCalls, gtag: (...args) => gtagCalls.push(args), fbq: (...args) => fbqCalls.push(args) };
}

test('send_to is the existing Setmore - Confirmed Paid Booking conversion', () => {
  assert.equal(ADS_SEND_TO, 'AW-16731910684/qZuaCNy3164dEJzksqo-');
});

test('toE164 normalizes US numbers and rejects others', () => {
  assert.equal(toE164('(425) 845-0045'), '+14258450045');
  assert.equal(toE164('425.845.0045'), '+14258450045');
  assert.equal(toE164('4258450045'), '+14258450045');
  assert.equal(toE164('+1 425 845 0045'), '+14258450045');
  assert.equal(toE164('845-0045'), null);
  assert.equal(toE164('24258450045'), null);
  assert.equal(toE164(''), null);
  assert.equal(toE164(undefined), null);
});

test('userData trims and lowercases email, drops invalid fields, null when empty', () => {
  assert.deepEqual(userData({ email: '  Riri@Example.COM ', phone: '4258450045' }), { email: 'riri@example.com', phone_number: '+14258450045' });
  assert.deepEqual(userData({ email: 'not-an-email', phone: '4258450045' }), { phone_number: '+14258450045' });
  assert.deepEqual(userData({ email: 'a@b.co', phone: '123' }), { email: 'a@b.co' });
  assert.equal(userData({ email: '', phone: '123' }), null);
  assert.equal(userData(undefined), null);
});

test('sendAdConversions sets user_data, then sends the Ads conversion, then Meta Schedule', () => {
  const r = recorders();
  sendAdConversions(DETAIL, { gtag: r.gtag, fbq: r.fbq, contact: CONTACT });
  assert.deepEqual(r.gtagCalls, [
    ['set', 'user_data', { email: 'a@b.co', phone_number: '+14258450045' }],
    ['event', 'conversion', { send_to: ADS_SEND_TO, value: 50, currency: 'USD', transaction_id: 'bk_123' }]
  ]);
  assert.deepEqual(r.fbqCalls, [
    ['track', 'Schedule', { value: 50, currency: 'USD', content_ids: ['svc_lash_lift'] }, { eventID: 'bk_123' }]
  ]);
});

test('no user_data call when contact is missing or invalid', () => {
  for (const contact of [undefined, { email: 'x', phone: '1' }]) {
    const r = recorders();
    sendAdConversions(DETAIL, { gtag: r.gtag, fbq: r.fbq, contact });
    assert.equal(r.gtagCalls.length, 1);
    assert.equal(r.gtagCalls[0][1], 'conversion');
  }
});

test('a throwing gtag does not stop Meta, and a missing fbq does not stop Google', () => {
  const r = recorders();
  assert.doesNotThrow(() => sendAdConversions(DETAIL, { gtag: () => { throw new Error('blocked'); }, fbq: r.fbq, contact: CONTACT }));
  assert.equal(r.fbqCalls.length, 1);

  const g = recorders();
  assert.doesNotThrow(() => sendAdConversions(DETAIL, { gtag: g.gtag, fbq: undefined, contact: CONTACT }));
  assert.equal(g.gtagCalls.filter((call) => call[1] === 'conversion').length, 1);
});

test('a user_data failure still sends the conversion', () => {
  const calls = [];
  const gtag = (...args) => { if (args[0] === 'set') throw new Error('bad'); calls.push(args); };
  sendAdConversions(DETAIL, { gtag, fbq: undefined, contact: CONTACT });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'conversion');
});

test('Meta receives no email or phone', () => {
  const r = recorders();
  sendAdConversions(DETAIL, { gtag: r.gtag, fbq: r.fbq, contact: CONTACT });
  const sent = JSON.stringify(r.fbqCalls);
  assert.doesNotMatch(sent, /a@b\.co/);
  assert.doesNotMatch(sent, /4258450045/);
});
