import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = ['main', 'faq', 'contact', 'service-page'];
const POLICY = 'Cancellations made on the same day as your appointment will result in the forfeiture of your $50 deposit. The deposit is non-refundable for same-day cancellations.';

// Each page script keeps its own heading id; the text must otherwise match.
function extract(file, key) {
  const source = fs.readFileSync(path.join(ROOT, 'New Perfection/js', `${file}.js`), 'utf8');
  const match = source.match(new RegExp(`^\\s*${key}: '(.*)',?\\s*$`, 'm'));
  assert.ok(match, `${file}.js has a ${key} string`);
  return match[1].replace(/id="[a-z]*-?dialog-title"/, 'id="dialog-title"');
}

const privacy = Object.fromEntries(FILES.map((file) => [file, extract(file, 'privacy')]));
const terms = Object.fromEntries(FILES.map((file) => [file, extract(file, 'terms')]));

test('privacy and terms strings are identical in all four page scripts', () => {
  for (const file of FILES.slice(1)) {
    assert.equal(privacy[file], privacy.main, `${file}.js privacy`);
    assert.equal(terms[file], terms.main, `${file}.js terms`);
  }
});

test('the old "no forms" sentence is gone', () => {
  for (const file of FILES) {
    assert.doesNotMatch(privacy[file], /does not collect personal information/);
    assert.doesNotMatch(terms[file], /does not collect personal information/);
  }
});

test('privacy names Setmore, Square, Turnstile and Google Analytics', () => {
  for (const name of ['Setmore', 'Square', 'Turnstile', 'Google Analytics']) assert.match(privacy.main, new RegExp(name));
});

test('privacy lists the booking form fields and says card numbers are not stored', () => {
  assert.match(privacy.main, /first and last name, email address, phone number/);
  assert.match(privacy.main, /notes/);
  assert.match(privacy.main, /does not store card numbers/);
});

test('privacy tells people how to ask for access or deletion', () => {
  assert.match(privacy.main, /access/);
  assert.match(privacy.main, /deleted/);
  assert.match(privacy.main, /\(425\) 845 0045/);
});

test('terms mention Setmore and Square and carry the deposit policy verbatim', () => {
  assert.match(terms.main, /Setmore/);
  assert.match(terms.main, /Square/);
  assert.ok(terms.main.includes(POLICY), 'verbatim deposit policy');
});

test('the policy strings stay valid inside single-quoted JavaScript', () => {
  for (const file of FILES) assert.doesNotMatch(`${privacy[file]}${terms[file]}`, /(^|[^\\])'/);
});

test('privacy names Google Ads conversion tracking and the Meta Pixel', () => {
  assert.match(privacy.main, /Google Ads/);
  assert.match(privacy.main, /Meta Pixel/);
  assert.match(privacy.main, /hashed/);
});

test('the booking paragraph no longer says the details are used only for Setmore', () => {
  assert.doesNotMatch(privacy.main, /only to create and manage your appointment/);
});
