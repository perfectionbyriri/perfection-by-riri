import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'New Perfection');
const read = (file) => fs.readFileSync(path.join(SITE, file), 'utf8');

const html = read('book/index.html');

function headersFor(route) {
  // Cloudflare _headers: a URL pattern line, then indented "Name: value" lines.
  const blocks = read('_headers').split(/\n(?=\S)/);
  const block = blocks.find((item) => item.split('\n')[0].trim() === route);
  if (!block) return null;
  return Object.fromEntries(block.split('\n').slice(1).filter((line) => /^\s+\S/.test(line)).map((line) => {
    const index = line.indexOf(':');
    return [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
  }));
}

function cspDirectives(value) {
  return Object.fromEntries(value.split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [name, ...sources] = item.split(/\s+/);
    return [name, sources];
  }));
}

test('the page has exactly one h1', () => {
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
});

test('css/booking.css loads after css/type-case.css', () => {
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  const typeCase = sheets.indexOf('../css/type-case.css');
  const booking = sheets.indexOf('../css/booking.css');
  assert.ok(typeCase >= 0 && booking > typeCase, sheets.join(', '));
  assert.ok(sheets.indexOf('../css/styles.css') < typeCase);
});

test('the progress is an ordered list of 4 steps with the first marked current', () => {
  const list = /<ol class="bk-progress"[^>]*>([\s\S]*?)<\/ol>/.exec(html);
  assert.ok(list, 'progress list');
  const items = [...list[1].matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)];
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((item) => item[2].replace(/<[^>]+>/g, '').trim()), ['Service', 'Date & time', 'Your details', 'Deposit & confirm'].map((label) => label.replace('&', '&amp;')));
  assert.match(items[0][1], /aria-current="step"/);
  assert.ok(items.slice(1).every((item) => !/aria-current/.test(item[1])));
});

test('a noscript block offers the phone number and the Setmore page', () => {
  const blocks = [...html.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map((match) => match[1]).join('\n');
  assert.match(blocks, /href="tel:\+14258450045"/);
  assert.match(blocks, /href="https:\/\/perfectionbyriri1\.setmore\.com"/);
});

test('the booking app loads as a module and has polite and assertive live regions', () => {
  assert.match(html, /<script type="module" src="\.\.\/js\/booking\/main\.js"><\/script>/);
  assert.match(html, /role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
  assert.match(html, /role="alert"/);
});

test('_headers sets a Content-Security-Policy for /book/* with the Square, Turnstile and Google hosts', () => {
  const headers = headersFor('/book/*');
  assert.ok(headers, '/book/* block');
  const csp = cspDirectives(headers['content-security-policy']);
  for (const host of ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com', 'https://challenges.cloudflare.com', 'https://www.googletagmanager.com']) {
    assert.ok(csp['script-src'].includes(host), `script-src ${host}`);
  }
  for (const host of ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com', 'https://challenges.cloudflare.com']) {
    assert.ok(csp['frame-src'].includes(host), `frame-src ${host}`);
  }
  assert.ok(csp['connect-src'].some((source) => source.includes('google-analytics.com')));
  assert.ok(!csp['script-src'].includes("'unsafe-inline'"), 'no unsafe-inline scripts');
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
});

// Hosts from Square's Web Payments CSP page (sandbox and production, both
// the SDK block and the PCI vendor-script block) and Cloudflare's Turnstile
// CSP page, checked 2026-11-22:
// https://developer.squareup.com/docs/web-payments/content-security-policy
// https://developers.cloudflare.com/turnstile/reference/content-security-policy/
test('the CSP covers every host Square Web Payments (sandbox + prod) and Turnstile document', () => {
  const csp = cspDirectives(headersFor('/book/*')['content-security-policy']);
  const required = {
    'script-src': ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com', 'https://challenges.cloudflare.com'],
    'frame-src': ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com', 'https://challenges.cloudflare.com'],
    'style-src': ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com'],
    'font-src': ['https://square-fonts-production-f.squarecdn.com', 'https://d1g145x70srn7h.cloudfront.net'],
    'connect-src': [
      'https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com',
      'https://pci-connect.squareup.com', 'https://pci-connect.squareupsandbox.com',
      'https://o160250.ingest.sentry.io'
    ]
  };
  for (const [directive, hosts] of Object.entries(required)) {
    for (const host of hosts) assert.ok(csp[directive]?.includes(host), `${directive} ${host}`);
  }
  assert.ok(!Object.values(csp).flat().some((source) => source.includes('*.squarecdn.com')), 'no Square wildcard');
});

test('the CSP lets the existing Google Analytics and Google Ads tags send their hits', () => {
  // Hosts the live tags contacted in a wrangler dev run on 2026-11-22 (all were blocked before).
  const csp = cspDirectives(headersFor('/book/*')['content-security-policy']);
  const allows = (directive, host) => csp[directive].some((source) => source === `https://${host}`
    || (source.startsWith('https://*.') && host.endsWith(source.slice('https://*'.length))));
  for (const host of ['www.google.com', 'analytics.google.com', 'region1.analytics.google.com', 'www.google-analytics.com', 'ad.doubleclick.net', 'www.googleadservices.com']) {
    assert.ok(allows('connect-src', host), `connect-src ${host}`);
  }
  for (const host of ['www.google.com', 'googleads.g.doubleclick.net', 'ad.doubleclick.net', 'www.googleadservices.com']) {
    assert.ok(allows('img-src', host), `img-src ${host}`);
  }
  assert.ok(allows('script-src', 'googleads.g.doubleclick.net'), 'script-src googleads.g.doubleclick.net (Ads view-through)');
});

test('every inline script on the page is allowed by a CSP hash', () => {
  const csp = cspDirectives(headersFor('/book/*')['content-security-policy']);
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(inline.length >= 1, 'the Google tag snippet is inline');
  for (const body of inline) {
    const hash = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
    assert.ok(csp['script-src'].includes(hash), `missing ${hash}`);
  }
});

test('the sitemap lists /book/', () => {
  assert.match(read('sitemap.xml'), /<loc>https:\/\/perfectionbyriri\.com\/book\/<\/loc>/);
});

test('the booking label classes are uppercase labels in type-case.css', () => {
  const typeCase = read('css/type-case.css');
  const labels = /\/\* Labels \*\/([\s\S]*?)\{\s*text-transform:\s*uppercase/.exec(typeCase)[1];
  for (const name of [
    '.bk-eyebrow', '.bk-step-count', '.bk-field-label', '.bk-day-name', '.bk-summary-label',
    '.bk-cinema-kicker', '.bk-cinema-caption', '.bk-cinema-col-label', '.bk-cinema-edit', '.bk-cinema-sub', '.bk-cinema-address'
  ]) {
    assert.ok(labels.split(/[\s,]+/).includes(name), name);
  }
  const serifs = /\/\* Serif display headings \*\/([\s\S]*?)\{\s*text-transform:\s*uppercase/.exec(typeCase)[1];
  for (const name of ['.bk-cinema-title', '.bk-cinema-col-title', '.bk-confirm-service']) {
    assert.ok(serifs.split(/[\s,]+/).includes(name), name);
  }
});

test('booking.css adds the error token, Cinematic Hero Scene rules, and keeps square corners without shadows', () => {
  const css = read('css/booking.css');
  assert.match(css, /--error:\s*#8c2f23/);
  assert.match(css, /\.bk-cinema-hero\b/);
  assert.match(css, /\.bk-cinema-grid\b/);
  assert.match(css, /\.bk-shell\[data-step="5"\]\s+\.bk-head/);
  // Step 5 keeps the page h1 in the accessibility tree: the head is visually hidden, never display:none.
  const step5Head = css.match(/\.bk-shell\[data-step="5"\]\s+\.bk-head\s*\{([^}]*)\}/);
  assert.ok(step5Head, 'step 5 head rule');
  assert.doesNotMatch(step5Head[1], /display\s*:\s*none/);
  assert.match(step5Head[1], /clip\s*:\s*rect\(0,\s*0,\s*0,\s*0\)/);
  // The only box-shadow allowed is the inset page-colour fill that hides the browser's autofill tint.
  const autofillBlocks = /[^{}]*:-?(?:webkit-)?autofill[^{}]*\{[^}]*\}/g;
  for (const block of css.match(autofillBlocks) ?? []) {
    for (const shadow of block.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) assert.match(shadow[1], /^0 0 0 1000px var\(--bk-bg\) inset$/, 'autofill fill');
  }
  assert.ok(!/box-shadow\s*:(?!\s*none)/.test(css.replace(autofillBlocks, '')), 'no shadows');
  for (const match of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) assert.equal(match[1].trim(), '0', 'square corners');
});

test('the page canonical, title and description point at /book/', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/perfectionbyriri\.com\/book\/">/);
  assert.match(html, /<title>[^<]*Book[^<]*<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
});

test('main.js findService carries the group key that picks the Step 4/5 hero photo', () => {
  const main = read('js/booking/main.js');
  const body = main.match(/const findService = \(id\) => \{([\s\S]*?)\n  \};/);
  assert.ok(body, 'findService');
  assert.match(body[1], /return \{ \.\.\.service, group: group\.key \}/);
});

test('Variant C: the head is a monolith hero with the studio photo, one h1 and the progress inside', () => {
  const head = /<header class="bk-head bk-monolith"[^>]*>([\s\S]*?)<\/header>/.exec(html);
  assert.ok(head, 'monolith head');
  assert.match(head[1], /<img class="bk-monolith-photo" src="\.\.\/images\/booking\/lash-tools\.jpg" width="1536" height="1024" alt="Precision lash tweezers resting in an organizer tray of extensions"/);
  assert.match(head[1], /<h1 class="bk-title" id="bk-title">Book your<br><em>appointment\.<\/em><\/h1>/);
  assert.match(head[1], /<p class="bk-monolith-display" aria-hidden="true" hidden><\/p>/);
  assert.match(head[1], /<p class="bk-monolith-kicker" hidden><\/p>/);
  assert.match(head[1], /Personal by design\.<br>Perfection in the details\./);
  assert.match(head[1], /<ol class="bk-progress"/);
});

test('Variant C: the live selection ribbon replaces the sidebar and keeps Edit outside the copied list', () => {
  const ribbon = /<section class="bk-ribbon"[^>]*>([\s\S]*?)<\/section>/.exec(html);
  assert.ok(ribbon, 'ribbon');
  for (const label of ['01 &middot; Treatment', '02 &middot; Date &amp; time', '03 &middot; Due today']) assert.ok(ribbon[1].includes(label), label);
  const list = /<dl class="bk-summary-list" id="bk-summary-list">([\s\S]*?)<\/dl>/.exec(ribbon[1]);
  assert.ok(list, 'summary list inside the ribbon');
  for (const key of ['service', 'time', 'deposit']) {
    assert.match(list[1], new RegExp(`<dd data-summary="${key}"><span class="bk-ribbon-title">[^<]+</span><span class="bk-ribbon-sub"></span></dd>`), key);
  }
  assert.doesNotMatch(list[1], /bk-cinema-edit/);
  assert.equal((ribbon[1].match(/class="bk-cinema-edit"/g) ?? []).length, 2);
  assert.match(ribbon[1], /data-goto-step="1"/);
  assert.match(ribbon[1], /data-goto-step="2"/);
  assert.doesNotMatch(html, /bk-summary-cta|bk-summary-action|class="bk-summary"/);
});

test('Variant C: main.js wires the ribbon, the hero and the shared action bar', () => {
  const main = read('js/booking/main.js');
  assert.match(main, /ribbonValues\(/);
  for (const step of [1, 2, 3]) assert.match(main, new RegExp(`renderActionBar\\(\\{\\s*step: ${step}\\b`), `step ${step}`);
  for (const label of ['Continue to date &amp; time', 'Continue to details', 'Review &amp; confirm']) assert.ok(main.includes(label), label);
  assert.doesNotMatch(main, /summaryCta|summaryAction/);
  assert.match(main, /function setHero\(step\)/);
  assert.match(main, /ribbon\?\.addEventListener\('click'[\s\S]{0,200}navigateFromProgress/);
});

test('Variant C: type-case registers the new labels and serif display lines', () => {
  const typeCase = read('css/type-case.css');
  const labels = /\/\* Labels \*\/([\s\S]*?)\{\s*text-transform:\s*uppercase/.exec(typeCase)[1].split(/[\s,]+/);
  for (const name of ['.bk-ribbon-sub', '.bk-cinema-step', '.bk-monolith-kicker']) assert.ok(labels.includes(name), name);
  const serifs = /\/\* Serif display headings \*\/([\s\S]*?)\{\s*text-transform:\s*uppercase/.exec(typeCase)[1].split(/[\s,]+/);
  for (const name of ['.bk-monolith-display', '.bk-ribbon-title']) assert.ok(serifs.includes(name), name);
});

test('Variant C: booking.css lays out the monolith, full-width steps, 2-column services and a mobile bar that keeps Back', () => {
  const css = read('css/booking.css');
  assert.match(css, /\.bk-monolith\s*\{[^}]*min-height:\s*276px/);
  assert.match(css, /\.bk-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(css, /--bk-summary-width\)/, 'no sidebar column left');
  assert.match(css, /\.bk-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  const mobile = [...css.matchAll(/@media \(max-width: 800px\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
  assert.match(mobile, /\.bk-ribbon\s*\{[^}]*display:\s*none/);
  assert.match(mobile, /\.bk-cinema-bar \.bk-cinema-address\s*\{[^}]*display:\s*none/);
  assert.match(mobile, /\.bk-shell\[data-step="1"\] \.bk-cinema-bar\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(mobile, /(^|[,\s])\.bk-actions\.bk-cinema-bar\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(mobile, /\[data-action="back"\][^{]*\{[^}]*display:\s*none/);
});

test('the header stack sits above every booking layer so the phone menu is not overlapped', () => {
  // .header-shell is a stacking context and the fixed phone menu lives inside it,
  // so its z-index must beat the highest booking layer (.bk-bar, z-index 40).
  const css = read('css/booking.css');
  const shell = css.match(/\.book-page \.header-shell\s*\{[^}]*\}/)?.[0] ?? '';
  const shellZ = Number(shell.match(/z-index:\s*(\d+)/)?.[1] ?? 1);
  const layers = [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
  const bookingTop = Math.max(...layers.filter((z) => z !== shellZ));
  assert.ok(shellZ > bookingTop, `header z-index ${shellZ} must exceed ${bookingTop}`);
});

test('motion: steps swap through a named view transition, no blur keyframes, full reduced-motion rule', () => {
  const css = read('css/booking.css');
  const js = read('js/booking/main.js');
  assert.match(css, /\.bk-step\s*\{\s*view-transition-name:\s*bk-step/);
  assert.match(css, /::view-transition-old\(bk-step\)/);
  assert.match(css, /::view-transition-new\(bk-step\)/);
  const focusIn = css.match(/@keyframes bk-focus-in\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(focusIn && !/blur\(/.test(focusIn), 'bk-focus-in must not animate blur');
  const reduce = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(reduce, /\.book-page[\s\S]*transition-duration/);
  assert.match(js, /startViewTransition/);
  assert.doesNotMatch(js, /scheduleAutoAdvance|advanceTimer/, 'choosing a service never moves on by itself; only Continue does');
  assert.match(js, /morphHeight\(weekBox/);
});

test('faq has the lip-blushing-cold-sores anchor on the existing subsection, with room under the sticky header', () => {
  const faq = read('faq/index.html');
  assert.match(faq, /<div class="faq-subsection" id="lip-blushing-cold-sores">\s*<h3 class="faq-subsection-title">Lip Blushing &amp; Cold Sores<\/h3>/);
  assert.match(read('css/faq.css'), /#lip-blushing-cold-sores\s*\{[^}]*scroll-margin-top:\s*\d+px/);
});

test('faq.js opens the collapsed service section that holds the URL hash target, on load and on hashchange', () => {
  const js = read('js/faq.js');
  assert.match(js, /location\.hash/);
  assert.match(js, /addEventListener\('hashchange'/);
  assert.match(js, /closest\('\[data-faq-service\]'\)/);
  assert.match(js, /setService\(service, true\)/);
});

// Full /book/ audit, 2026-11-23: axe, keyboard and phone findings.
const luminance = (hex) => {
  const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('the selected day keeps text contrast of at least 4.5:1 on its background', () => {
  const css = read('css/booking.css');
  const token = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))[1];
  const bg = token('--bk-surface-active');
  const name = css.match(/\.bk-day\[aria-pressed="true"\] \.bk-day-name,\s*\.bk-day\[aria-pressed="true"\] \.bk-day-date\s*\{\s*color:\s*(#[0-9a-f]{6})/i)?.[1];
  const count = css.match(/\.bk-day\[aria-pressed="true"\] \.bk-day-count\s*\{\s*color:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(name && count, 'selected day colours are set as hex');
  assert.ok(contrast(name, bg) >= 4.5, `name/date ${contrast(name, bg).toFixed(2)}`);
  assert.ok(contrast(count, bg) >= 4.5, `count ${contrast(count, bg).toFixed(2)}`);
});

test('while the phone bar shows, focused controls scroll clear of it', () => {
  const css = read('css/booking.css');
  assert.match(css, /html\.bk-has-bar\s*\{[^}]*scroll-padding-bottom:\s*calc\(var\(--bk-bar-h, \d+px\) \+ \d+px\)/);
  assert.match(read('js/booking/main.js'), /setProperty\('--bk-bar-h'/);
  // Chromium does not scroll a partly visible focused control out from under a fixed bar; main.js nudges it.
  assert.match(read('js/booking/main.js'), /addEventListener\('focusin'[\s\S]{0,400}:focus-visible[\s\S]{0,400}scrollBy/);
});

test('the disabled bar button stays readable (no opacity fade) and banner buttons are not underlined', () => {
  const css = read('css/booking.css');
  const rule = css.match(/\.book-page \.bk-bar \.bk-bar-action:disabled[^{]*\{([^}]*)\}/)?.[1] ?? '';
  const bg = rule.match(/background:\s*(#[0-9a-f]{6})/i)?.[1];
  const fg = rule.match(/(?:^|[;\s])color:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(bg && fg, 'explicit disabled colours');
  assert.match(rule, /opacity:\s*1/);
  assert.ok(contrast(fg, bg) >= 4.5, `disabled bar ${contrast(fg, bg).toFixed(2)}`);
  assert.match(css, /\.bk-banner a\.button\s*\{[^}]*text-decoration:\s*none/);
});

test('done steps in the progress row are at least 24px tall to tap', () => {
  assert.match(read('css/booking.css'), /\.bk-progress-item\[data-goto-step\] \.bk-progress-label\s*\{[^}]*min-height:\s*24px/);
});

test('the announcement sits in a labelled landmark, keeps "Lynnwood, WA" together, and main has no nested aside', () => {
  const html = read('book/index.html');
  assert.match(html, /<aside class="announcement" aria-label="Studio announcement">[\s\S]*?LYNNWOOD,&nbsp;WA<\/aside>/);
  const main = html.match(/<main[\s\S]*?<\/main>/)[0];
  assert.doesNotMatch(main, /<aside\b/);
});
