// Manual browser check for the ad conversions (plan 2026-11-26-ads-tracking, Task 5).
// Not part of `node --test` (the glob is tests/booking/*.test.mjs).
//
// Usage: cp .env.example .dev.vars && npx wrangler dev --port 8787
//        node tests/booking/helpers/ad-tags-browser-check.mjs [base-url] [screenshot-dir]
// Delete .dev.vars afterwards. Google and Meta scripts are stubbed; the page's
// real gtag/fbq calls are recorded.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const SHOTS = process.argv[3] ?? null;
const SERVICE = 'svc_eyebrow_lamination_tinting_shaping';
const SEND_TO = 'AW-16731910684/qZuaCNy3164dEJzksqo-';

// The real page code runs: the inline Google tag pushes gtag calls to
// window.dataLayer, and js/meta-pixel.js queues fbq calls in fbq.queue while
// fbevents.js (stubbed empty) never loads. Both are read back as arrays.
const RECORDER = `
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
`;
const READ_CALLS = () => {
  const plain = (args) => JSON.parse(JSON.stringify(Array.from(args), (key, value) => (value instanceof Date ? 'date' : value)));
  return {
    gtag: (window.dataLayer || []).filter((entry) => entry && typeof entry.length === 'number' && !Array.isArray(entry)).map(plain),
    fbq: (window.fbq?.queue || []).map(plain),
    csp: window.__csp
  };
};

const ok = (label) => console.log(`ok - ${label}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await context.route(/googletagmanager\.com|connect\.facebook\.net/, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
await context.addInitScript(RECORDER);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

try {
  await page.goto(`${BASE}/book/?service=${SERVICE}`, { waitUntil: 'networkidle' });
  await shot('1-service');
  // On a phone the in-step primary button is mirrored by the fixed bar, so press the in-step one directly.
  const press = (selector) => page.locator(selector).first().evaluate((button) => button.click());
  if (await page.locator('[data-start-at]').count() === 0) await press('#bk-step [data-action="continue"]');
  await page.locator('[data-start-at]').first().waitFor({ timeout: 15000 });
  await page.locator('[data-start-at]').first().click();
  await shot('2-slot');
  await press('#bk-step [data-action="continue"]');
  await page.locator('#bk-first_name').waitFor({ timeout: 15000 });
  await page.fill('#bk-first_name', 'Test');
  await page.fill('#bk-last_name', 'Client');
  await page.fill('#bk-email', '  Test.Client@Example.COM ');
  await page.fill('#bk-phone', '(425) 845-0045');
  await page.check('#bk-policy_accepted');
  await shot('3-details');
  await press('#bk-step button[form="bk-details"]');
  await page.locator('#bk-step .bk-pay').first().waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => { const b = document.querySelector('.bk-pay'); return b && !b.disabled; }, null, { timeout: 30000 });
  await shot('4-pay');
  await press('#bk-step .bk-pay');
  await page.locator('.bk-confirm').waitFor({ timeout: 30000 });
  await shot('5-confirm');

  const { gtag, fbq, csp } = await page.evaluate(READ_CALLS);
  const bookingId = new URL(page.url()).searchParams.get('ref');
  assert.ok(bookingId, 'URL has ?ref=');

  assert.ok(gtag.some((c) => c[0] === 'config' && c[1] === 'AW-16731910684'), 'AW config');
  ok('gtag config AW-16731910684');
  const conversions = gtag.filter((c) => c[0] === 'event' && c[1] === 'conversion');
  assert.equal(conversions.length, 1, 'one conversion');
  assert.deepEqual(conversions[0][2], { send_to: SEND_TO, value: 50, currency: 'USD', transaction_id: bookingId });
  ok(`one conversion, send_to ${SEND_TO}, value 50, transaction_id ${bookingId}`);
  const userDataIndex = gtag.findIndex((c) => c[0] === 'set' && c[1] === 'user_data');
  assert.ok(userDataIndex > -1 && userDataIndex < gtag.indexOf(conversions[0]), 'user_data before conversion');
  assert.deepEqual(gtag[userDataIndex][2], { email: 'test.client@example.com', phone_number: '+14258450045' });
  ok('user_data set before the conversion, normalized');
  assert.equal(gtag.filter((c) => c[1] === 'purchase').length, 1, 'one GA4 purchase');
  ok('one GA4 purchase');

  assert.equal(fbq.filter((c) => c[0] === 'init' && c[1] === '1864195751687018').length, 1);
  assert.equal(fbq.filter((c) => c[1] === 'PageView').length, 1);
  ok('pixel init 1864195751687018 and one PageView');
  const schedules = fbq.filter((c) => c[0] === 'track' && c[1] === 'Schedule');
  assert.equal(schedules.length, 1, 'one Schedule');
  assert.deepEqual(schedules[0][3], { eventID: bookingId });
  assert.equal(schedules[0][2].value, 50);
  assert.doesNotMatch(JSON.stringify(fbq), /example\.com|4258450045/);
  ok('one Schedule with eventID = booking id, no contact data to Meta');

  assert.deepEqual(csp, [], 'no CSP violations');
  ok('no CSP violations');

  await page.reload({ waitUntil: 'networkidle' });
  const after = await page.evaluate(READ_CALLS);
  assert.equal(after.gtag.filter((c) => c[1] === 'conversion').length, 0, 'no conversion on reload');
  assert.equal(after.fbq.filter((c) => c[1] === 'Schedule').length, 0, 'no Schedule on reload');
  await shot('6-reload');
  ok('reload of /book/confirmed/ sends no conversion and no Schedule');

  assert.deepEqual(errors, [], 'no console errors');
  ok('no console errors');
} catch (error) {
  await shot('failure');
  console.error('FAIL', error.message, '\nconsole errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
