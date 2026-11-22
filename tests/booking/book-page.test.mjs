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
  const labels = /\/\* Labels \*\/([\s\S]*?)\{\s*text-transform:\s*uppercase/.exec(read('css/type-case.css'))[1];
  for (const name of ['.bk-eyebrow', '.bk-step-count', '.bk-field-label', '.bk-day-name', '.bk-summary-label']) {
    assert.ok(labels.split(/[\s,]+/).includes(name), name);
  }
});

test('booking.css adds the error token and keeps square corners without shadows', () => {
  const css = read('css/booking.css');
  assert.match(css, /--error:\s*#8c2f23/);
  assert.ok(!/box-shadow\s*:(?!\s*none)/.test(css), 'no shadows');
  for (const match of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) assert.equal(match[1].trim(), '0', 'square corners');
});

test('the page canonical, title and description point at /book/', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/perfectionbyriri\.com\/book\/">/);
  assert.match(html, /<title>[^<]*Book[^<]*<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
});
