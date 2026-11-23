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

test('Bodoni at small and medium sizes is sturdier: weight 550, opsz 9; open/selected titles stay ink', () => {
  const block = css.match(/\/\* Bodoni legibility[\s\S]*?\n\}\n/)?.[0] ?? '';
  for (const sel of ['.bk-card-name', '.bk-cat-title', '.bk-ribbon-title', '.bk-day-date', '.bk-step-title', '.bk-cinema-col-title', '.bk-review-service', '.bk-confirm-service']) {
    assert.ok(block.includes(sel), `${sel} is in the legibility block`);
  }
  assert.match(block, /font-weight:\s*550/);
  assert.match(block, /font-variation-settings:\s*"opsz" 9/);
  assert.doesNotMatch(block, /\.bk-monolith|\.bk-cinema-title|\.bk-title\b/, 'display headings keep their size-tuned style');
  assert.match(css, /\.bk-group\.is-open \.bk-cat-title\s*\{\s*color:\s*var\(--bk-ink\)/);
  assert.match(css, /\.bk-card\[aria-pressed="true"\] \.bk-card-name\s*\{\s*color:\s*var\(--bk-ink\)/);
});

test('primary buttons are black with light text and fill gold on hover with dark text', () => {
  const base = css.match(/\.book-page \.bk \.button-gold,\s*\.book-page \.bk-bar \.button-gold\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(base, /background:\s*#0b0b0a/);
  assert.match(base, /color:\s*#f5f2ef/);
  assert.match(base, /border-color:\s*#0b0b0a/);
  const sweep = css.match(/\.book-page \.bk \.button-gold::before,[\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
  assert.match(sweep, /background:\s*var\(--bk-gold\)/);
  const hover = css.match(/\.book-page \.bk \.button-gold:hover,[\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
  assert.match(hover, /background:\s*var\(--bk-gold\)/);
  assert.match(hover, /color:\s*var\(--bk-ink\)/);
  assert.ok(contrast('#f5f2ef', '#0b0b0a') >= 7, 'light text on the black button');
  assert.ok(contrast('#262620', '#b99a6d') >= 4.5, 'ink on the gold hover fill');
});

test('sub-tabs wrap only on phones (max-width 540px); wider screens keep their layout', () => {
  const at800 = (css.match(/@media \(max-width: 800px\) \{[\s\S]*?\n\}\n/g) ?? []).join('\n');
  const at540 = (css.match(/@media \(max-width: 540px\) \{[\s\S]*?\n\}\n/g) ?? []).join('\n');
  const r800 = at800.match(/\n  \.bk-subtabs \{([^}]*)\}/)?.[1] ?? '';
  assert.match(r800, /flex-wrap:\s*nowrap/);
  assert.match(r800, /overflow-x:\s*auto/);
  const r540 = at540.match(/\n  \.bk-subtabs \{([^}]*)\}/)?.[1] ?? '';
  assert.match(r540, /flex-wrap:\s*wrap/);
  assert.match(r540, /overflow(-x)?:\s*visible/);
});

test('Jost Light is used only for standalone numbers and prices, never for digits next to letters', () => {
  assert.doesNotMatch(css, /Bk Digits|--bk-serif|font-synthesis-weight/, 'no global digit face');
  const day = css.match(/\n\.bk-day-date\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(day, /font-family:\s*var\(--price-font\)/);
  assert.match(day, /font-weight:\s*var\(--price-weight\)/);
  const price = css.match(/\.bk-ribbon-title\.is-numeric\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(price, /font-family:\s*var\(--price-font\)/);
  assert.match(price, /font-weight:\s*var\(--price-weight\)/);
  const js = read('js/booking/main.js');
  assert.match(js, /classList\.toggle\('is-numeric', \/\^\[\$\\d\.,\\s\]\+\$\/\.test\(title\)\)/);
});

test('the FAQ notice is a full-row panel built from theme tokens only', () => {
  const rules = [...css.matchAll(/\n\.bk-notice[\w-]*[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
  assert.ok(rules.length > 0, '.bk-notice rules exist');
  assert.match(css, /\.bk-notice\s*\{[^}]*grid-column:\s*1 \/ -1/);
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no hardcoded colors');
  assert.match(css, /\.bk-notice\[hidden\]\s*\{\s*display:\s*none/);
});

test('the FAQ notice stands out: warm panel, 2px gold frame, big text, button-style link, large checkbox', () => {
  const faqBlock = read('css/faq.css').match(/\.faq-subsection\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(faqBlock, 'FAQ block color found');
  assert.equal(page['--bk-notice-bg'].toLowerCase(), faqBlock.toLowerCase(), 'the notice uses the FAQ block color');
  assert.ok(luminance(page['--bk-notice-bg']) > 0.7, 'notice panel is a light warm tint');
  assert.ok(contrast(page['--bk-ink'], page['--bk-notice-bg']) >= 7, 'ink on the notice panel');
  assert.ok(contrast(page['--bk-gold-text'], page['--bk-notice-bg']) >= 4.5, 'gold text on the notice panel');
  const rule = (sel) => css.match(new RegExp(`\\n${sel.replace(/[.\\[\\]]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  const box = rule('.bk-notice');
  assert.match(box, /background:\s*var\(--bk-notice-bg\)/);
  assert.match(box, /border:\s*2px solid var\(--bk-gold-text\)/);
  assert.match(box, /border-left-width:\s*6px/);
  assert.ok(Number(rule('.bk-notice-text').match(/font-size:\s*(\d+)px/)?.[1]) >= 17, 'text is at least 17px');
  const link = rule('.bk-notice-link');
  assert.ok(Number(link.match(/min-height:\s*(\d+)px/)?.[1]) >= 44, 'link is a 44px tap target');
  assert.match(link, /border:\s*1px solid var\(--bk-ink\)/);
  assert.ok(Number(rule('.bk-notice-check').match(/width:\s*(\d+)px/)?.[1]) >= 24, 'checkbox is at least 24px');
  const motion = css.match(/@media \(prefers-reduced-motion: no-preference\) \{[^@]*\.bk-notice:not\(\[hidden\]\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(motion, 'attention animation only without reduced motion');
  assert.match(css, /@keyframes bk-notice-attn\b/);
});
