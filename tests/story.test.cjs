'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = readFileSync('New Perfection/js/story.js', 'utf8');

function load({ reduced = false } = {}) {
  const listeners = {};
  const classes = new Set();
  const window = {
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    addEventListener(name, handler, options) { listeners[name] = { handler, options }; },
    innerHeight: 800
  };
  const document = {
    documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } },
    querySelectorAll: () => [],
    readyState: 'complete',
    addEventListener() {}
  };
  runInNewContext(source, {
    window, document, requestAnimationFrame() {},
    IntersectionObserver: class { observe() {} }
  });
  return { api: window.PerfectionStory, listeners, classes };
}

test('progress is 0 while the section top is still at or below the viewport top', () => {
  const { api } = load();
  assert.equal(api.progress(0, 2000, 800), 0);
  assert.equal(api.progress(300, 2000, 800), 0);
});

test('progress grows linearly across the scrollable distance of a pinned section', () => {
  const { api } = load();
  assert.equal(api.progress(-600, 2000, 800), 0.5);
  assert.equal(api.progress(-1200, 2000, 800), 1);
});

test('progress is clamped to 1 after the section has scrolled past', () => {
  const { api } = load();
  assert.equal(api.progress(-5000, 2000, 800), 1);
});

test('a section no taller than the viewport jumps from 0 to 1 as its top passes', () => {
  const { api } = load();
  assert.equal(api.progress(10, 600, 800), 0);
  assert.equal(api.progress(-10, 600, 800), 1);
});

test('motion allowed: story-on is set and one passive scroll listener is registered', () => {
  const { classes, listeners } = load();
  assert.ok(classes.has('story-on'));
  assert.equal(listeners.scroll?.options?.passive, true);
});

test('reduced motion: no story-on class and no scroll listener', () => {
  const { classes, listeners } = load({ reduced: true });
  assert.ok(!classes.has('story-on'));
  assert.equal(listeners.scroll, undefined);
});

test('magnet pull is proportional to the pointer offset and capped at 8px', () => {
  const { api } = load();
  assert.deepEqual({ ...api.magnet(0, 0) }, { x: 0, y: 0 });
  assert.deepEqual({ ...api.magnet(20, -10) }, { x: 4, y: -2 });
  assert.deepEqual({ ...api.magnet(500, -500) }, { x: 8, y: -8 });
});
