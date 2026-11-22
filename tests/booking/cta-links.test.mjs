import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'New Perfection');
const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'worker/config/services-meta.json'), 'utf8'));
const GROUP_KEYS = new Set(META.groups.map((group) => group.key));

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

const PAGES = htmlFiles(SITE).map((file) => ({ file, rel: path.relative(SITE, file), html: fs.readFileSync(file, 'utf8') }));
const withoutNoscript = (html) => html.replace(/<noscript[\s\S]*?<\/noscript>/g, '');
const SERVICE_PAGES = {
  'services/lash-extensions/index.html': 'lash-extensions',
  'services/lash-lift/index.html': 'lash-lift',
  'services/brow-lamination-tint/index.html': 'brows',
  'services/permanent-makeup/index.html': 'permanent-makeup'
};

test('no page links to the Setmore page outside noscript', () => {
  for (const page of PAGES) {
    assert.doesNotMatch(withoutNoscript(page.html), /perfectionbyriri1\.setmore\.com/, page.rel);
  }
});

test('every data-booking-url link points at /book/ and opens in the same tab', () => {
  let count = 0;
  for (const page of PAGES) {
    for (const [tag] of withoutNoscript(page.html).matchAll(/<a\b[^>]*data-booking-url[^>]*>/g)) {
      count += 1;
      const href = tag.match(/\shref="([^"]*)"/)?.[1];
      assert.ok(href?.startsWith('/book/'), `${page.rel}: ${tag}`);
      assert.doesNotMatch(tag, /target="_blank"/, `${page.rel}: ${tag}`);
    }
  }
  assert.ok(count >= 25, `expected the booking CTAs to be found, got ${count}`);
});

test('service page CTAs carry a known ?group= key and other pages use plain /book/', () => {
  for (const page of PAGES) {
    const hrefs = [...withoutNoscript(page.html).matchAll(/<a\b[^>]*data-booking-url[^>]*>/g)].map((match) => match[0].match(/\shref="([^"]*)"/)?.[1]);
    const expected = SERVICE_PAGES[page.rel.split(path.sep).join('/')];
    for (const href of hrefs) {
      if (expected) assert.equal(href, `/book/?group=${expected}`, page.rel);
      else assert.equal(href, '/book/', page.rel);
      const group = new URL(href, 'https://x.test').searchParams.get('group');
      if (group) assert.ok(GROUP_KEYS.has(group), `${page.rel}: unknown group ${group}`);
    }
  }
});

test('the unused Setmore preconnect is gone', () => {
  for (const page of PAGES) assert.doesNotMatch(page.html, /preconnect"? href="https:\/\/assets\.setmore\.com|href="https:\/\/assets\.setmore\.com"[^>]*preconnect/, page.rel);
});
