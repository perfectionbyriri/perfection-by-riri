import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'New Perfection');
const read = (file) => fs.readFileSync(path.join(SITE, file), 'utf8');
const css = read('css/booking.css');

function tokens(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const page = tokens(css.match(/\.book-page\s*\{([^}]*)\}/)[1]);
const islandMatch = css.match(/([^{}]*\.bk-dark-island[^{}]*)\{([^}]*)\}/);
const island = islandMatch ? tokens(islandMatch[2]) : {};

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the page background and surfaces are light', () => {
  for (const name of ['--bk-bg', '--bk-bg-deep', '--bk-surface']) {
    assert.ok(luminance(page[name]) > 0.8, `${name} ${page[name]} must be light`);
  }
  assert.ok(luminance(page['--bk-ink']) < 0.1, 'ink must be dark');
});

test('body and muted text pass AA on the background and the surface', () => {
  for (const bg of ['--bk-bg', '--bk-surface']) {
    assert.ok(contrast(page['--bk-ink'], page[bg]) >= 7, `ink on ${bg}`);
    assert.ok(contrast(page['--bk-muted'], page[bg]) >= 4.5, `muted on ${bg}`);
    assert.ok(contrast(page['--bk-subtle'], page[bg]) >= 4.5, `subtle on ${bg}`);
  }
});

test('gold text and error text pass AA on light', () => {
  for (const bg of ['--bk-bg', '--bk-surface']) {
    assert.ok(contrast(page['--bk-gold-text'], page[bg]) >= 4.5, `gold text on ${bg}`);
  }
  assert.ok(contrast(page['--bk-error'], page['--bk-surface']) >= 4.5, 'error on surface');
});

test('dark button text stays readable on the gold fills', () => {
  for (const fill of ['--bk-gold', '--bk-gold-fill']) {
    assert.ok(contrast('#0b0b0a', page[fill]) >= 7, `button text on ${fill}`);
  }
});

test('decorative gold stays the site gold', () => {
  assert.equal(page['--bk-gold'].toLowerCase(), '#b99a6d');
});

test('the dark island keeps light text on the dark photo overlay', () => {
  assert.ok(islandMatch, 'a .bk-dark-island block exists');
  assert.ok(/\.bk-monolith\b/.test(islandMatch[1]) && /\.bk-cinema-hero\b/.test(islandMatch[1]), 'island lists the photo banners');
  assert.ok(luminance(island['--bk-ink']) > 0.8, 'island ink is light');
  assert.ok(contrast(island['--bk-ink'], '#0c0c0b') >= 7, 'island ink on the dark overlay');
  assert.ok(contrast(island['--bk-muted'], '#0c0c0b') >= 4.5, 'island muted on the dark overlay');
  assert.ok(contrast(island['--bk-gold-text'], '#0c0c0b') >= 4.5, 'island gold on the dark overlay');
});

test('no obsidian colors remain outside the dark island and the photo overlays', () => {
  const cleaned = css
    .replace(/([^{}]*\.bk-dark-island[^{}]*)\{[^}]*\}/, '')
    .replace(/linear-gradient\([^;]*rgba\(12, 12, 11[^;]*;/g, '');
  const leftovers = cleaned.match(/#0c0c0b|#080807|#141312|#10100f|#1b1917|#221e19|rgba\(12, 12, 11/gi) ?? [];
  assert.deepEqual(leftovers, []);
});

test('theme-color is the light background', () => {
  assert.match(read('book/index.html'), /<meta name="theme-color" content="#f5f2ef">/);
});

test('the phone menu is light: open header, links and footer links use the light tokens', () => {
  assert.match(css, /\.book-page \.header-shell:has\(\.main-navigation\.is-open\)\s*\{[^}]*background:\s*var\(--bk-bg-deep\)/);
  assert.match(css, /\.enhanced \.book-page #main-navigation > a,[\s\S]*?\{[^}]*color:\s*var\(--bk-ink\)/);
  assert.match(css, /\.enhanced \.book-page #main-navigation \.nav-extras-row a\s*\{[^}]*color:\s*var\(--bk-muted\)/);
});

test('the Services dropdown is light on /book/: labels, descriptions and the open desktop header', () => {
  assert.match(css, /\.book-page \.nav-services \.nav-dropdown-item\s*\{[^}]*color:\s*var\(--bk-ink\)/);
  assert.match(css, /\.book-page \.nav-dropdown-label\s*\{[^}]*color:\s*var\(--bk-ink\)/);
  assert.match(css, /\.book-page \.nav-dropdown-desc\s*\{[^}]*color:\s*var\(--bk-muted\)/);
  assert.match(css, /\.book-page \.header-shell\.services-open\s*\{[^}]*background:\s*var\(--bk-bg-deep\)/);
});

test('the site header is always black on /book/, desktop and phone, open or closed', () => {
  assert.ok(islandMatch && /\.book-page \.header-shell/.test(islandMatch[1]), 'header-shell is part of the dark island');
  assert.ok(luminance(island['--bk-bg-deep']) < 0.05, 'island --bk-bg-deep is black');
  assert.doesNotMatch(css, /rgba\(38, 38, 32, \.32\)/, 'menu toggle border must not be dark ink');
});

test('the footer is black on /book/ like the header', () => {
  assert.ok(islandMatch && /\.book-page \.site-footer/.test(islandMatch[1]), 'site-footer is part of the dark island');
});

test('the Step 1-4 hero is full-bleed: flush under the header, edge to edge, no ivory gaps', () => {
  assert.match(css, /\.book-page \.bk\s*\{[^}]*padding-block:\s*0 84px/);
  assert.doesNotMatch(css, /\.book-page \.bk \{ padding-block: (26|20)px/, 'phone breakpoints keep the hero flush too');
  const hero = css.match(/\n\.bk-monolith\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(hero, /margin-inline:\s*calc\(-1 \* var\(--bk-gutter\)\)/);
  assert.match(hero, /padding:\s*44px var\(--bk-gutter\) 0/);
  assert.match(hero, /border:\s*0/);
  assert.match(css, /\.book-page \.header-shell\s*\{[^}]*border-bottom:\s*0/);
});

test('booking panels use exactly the service-page panel color (--card #efebe7)', () => {
  assert.equal(page['--bk-surface'].toLowerCase(), '#efebe7');
  assert.equal(page['--bk-surface-inset'].toLowerCase(), '#efebe7');
});
