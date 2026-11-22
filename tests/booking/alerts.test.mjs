import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlerts } from '../../worker/src/alerts.js';

function setup({ sendEmail } = {}) {
  const sent = [];
  const events = [];
  const alerts = createAlerts({
    sendEmail: sendEmail ?? (async (message) => { sent.push(message); }),
    from: 'booking-alerts@perfectionbyriri.com',
    to: 'salon@example.com',
    log: (event, fields) => events.push({ event, ...fields })
  });
  return { alerts, sent, events };
}

test('alert e-mail goes from the alert sender to the salon with the type in the subject', async () => {
  const { alerts, sent } = setup();
  await alerts.notify('capture_failed_booking_kept', { bookingId: 'bkg_1', paymentId: 'pay_1' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, 'booking-alerts@perfectionbyriri.com');
  assert.equal(sent[0].to, 'salon@example.com');
  assert.match(sent[0].subject, /capture_failed_booking_kept/);
  assert.match(sent[0].text, /Booking id: bkg_1/);
  assert.match(sent[0].text, /Square payment id: pay_1/);
  assert.match(sent[0].text, /Square Dashboard/, 'tells the salon what to do');
});

test('alert body has ids only (no email, phone or name)', async () => {
  const { alerts, sent } = setup();
  await alerts.notify('double_booking_detected', {
    bookingId: 'bkg_1', paymentId: 'pay_1',
    extra: { other_booking_ids: ['bkg_2'], email: 'anna@example.com', phone: '+14258450045', name: 'Anna Smith' }
  });
  assert.match(sent[0].text, /bkg_2/);
  for (const pii of ['anna@example.com', '4258450045', 'Anna']) assert.ok(!JSON.stringify(sent[0]).includes(pii), pii);
});

test('missing ids are shown as none', async () => {
  const { alerts, sent } = setup();
  await alerts.notify('payment_cancel_failed', { bookingId: null, paymentId: 'pay_9' });
  assert.match(sent[0].text, /Booking id: none/);
});

test('sendEmail rejection is swallowed and logged', async () => {
  const { alerts, events } = setup({ sendEmail: async () => { throw new Error('smtp secret detail'); } });
  await assert.doesNotReject(alerts.notify('upstream_auth_failed', { bookingId: null, paymentId: null }));
  assert.deepEqual(events, [{ event: 'alert_send_failed', type: 'upstream_auth_failed' }]);
});

test('an unknown alert type is logged and not sent', async () => {
  const { alerts, sent, events } = setup();
  await alerts.notify('something_else', { bookingId: 'bkg_1', paymentId: null });
  assert.equal(sent.length, 0);
  assert.deepEqual(events, [{ event: 'alert_type_unknown', type: 'something_else' }]);
});

test('without a destination address the alert is logged, not sent', async () => {
  const sent = [];
  const events = [];
  const alerts = createAlerts({ sendEmail: async (m) => sent.push(m), from: 'a@b.co', to: '', log: (event, fields) => events.push({ event, ...fields }) });
  await alerts.notify('payment_cancel_failed', { bookingId: null, paymentId: 'pay_1' });
  assert.equal(sent.length, 0);
  assert.deepEqual(events, [{ event: 'alert_not_configured', type: 'payment_cancel_failed' }]);
});
