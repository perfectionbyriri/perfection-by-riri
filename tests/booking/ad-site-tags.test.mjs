import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'New Perfection');
const read = (relative) => fs.readFileSync(path.join(SITE, relative), 'utf8');

function htmlPages(dir = SITE) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlPages(full);
    return entry.name === 'index.html' ? [path.relative(SITE, full)] : [];
  });
}

const trackedPages = htmlPages().filter((page) => read(page).includes('js/analytics.js'));

test('every page that loads analytics.js also loads meta-pixel.js, after it', () => {
  assert.equal(trackedPages.length, 9, trackedPages.join(', '));
  for (const page of trackedPages) {
    const html = read(page);
    const pixel = html.search(/<script src="[./]*js\/meta-pixel\.js" defer><\/script>/);
    assert.ok(pixel > -1, `${page} loads meta-pixel.js with defer`);
    assert.ok(pixel > html.indexOf('js/analytics.js'), `${page} loads meta-pixel.js after analytics.js`);
    assert.equal(html.match(/meta-pixel\.js/g).length, 1, `${page} loads meta-pixel.js once`);
  }
});

test('meta-pixel.js inits dataset 1864195751687018 and tracks PageView once', () => {
  const source = read('js/meta-pixel.js');
  assert.match(source, /'init', '1864195751687018'/);
  assert.equal(source.match(/'track', 'PageView'/g)?.length, 1);
  assert.match(source, /https:\/\/connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.doesNotMatch(source, /Schedule|Purchase/);
});

test('analytics.js configures AW-16731910684 guarded by typeof window.gtag', () => {
  const source = read('js/analytics.js');
  assert.match(source, /typeof window\.gtag === 'function'\) window\.gtag\('config', 'AW-16731910684'\)/);
});

test('book/confirmed/ never calls fireConfirmation', () => {
  for (const file of ['js/booking/confirmed.js', 'book/confirmed/index.html']) {
    const source = read(file);
    assert.doesNotMatch(source, /fireConfirmation|'conversion'|Schedule/, file);
  }
});

test('the inline Google tag in book/index.html is unchanged', () => {
  const inline = [...read('book/index.html').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const googleTag = inline.filter((body) => body.includes("gtag('config', 'G-9T26E3J0XS')"));
  assert.equal(googleTag.length, 1, 'one inline Google tag');
  for (const body of inline) assert.doesNotMatch(body, /AW-|fbq/);
});

// Review fix: preview hosts and `wrangler dev` must not send events to the live
// dataset or Ads account. Same rule as the inline GA4 tag in book/index.html.
function runScript(file, hostname) {
  const gtagCalls = [];
  const head = { appendChild() {} };
  const document = { head, getElementsByTagName: () => [], createElement: () => ({}), addEventListener() {} };
  const window = { location: { hostname }, gtag: (...args) => gtagCalls.push(args) };
  const context = vm.createContext({ window, document, location: window.location });
  vm.runInContext(read(file), context);
  return { window, gtagCalls };
}

test('meta-pixel.js runs only on perfectionbyriri.com', () => {
  for (const host of ['localhost', 'perfection-by-riri-preview.example.workers.dev', 'perfectionbyriri.beauty']) {
    assert.equal(runScript('js/meta-pixel.js', host).window.fbq, undefined, host);
  }
  const live = runScript('js/meta-pixel.js', 'perfectionbyriri.com').window;
  assert.equal(JSON.stringify(live.fbq.queue.map((args) => Array.from(args))), JSON.stringify([['init', '1864195751687018'], ['track', 'PageView']]));
});

test('analytics.js configures the Ads tag only on perfectionbyriri.com', () => {
  assert.equal(runScript('js/analytics.js', 'localhost').gtagCalls.length, 0);
  assert.equal(JSON.stringify(runScript('js/analytics.js', 'perfectionbyriri.com').gtagCalls), JSON.stringify([['config', 'AW-16731910684']]));
});
