'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = readFileSync('New Perfection/js/pmu-results.js', 'utf8');

function setup({ reduced = false, left = 0 } = {}) {
  const listeners = {};
  const calls = [];
  let now = 0;
  const track = {
    children: [0, 400, 800, 1200].map(offsetLeft => ({ offsetLeft })),
    scrollLeft: left, scrollWidth: 1600, clientWidth: 400,
    addEventListener(name, handler, options) { listeners[name] = { handler, options }; },
    scrollTo(options) { calls.push(options); }
  };
  const section = { querySelector: selector => selector === '.pmu-results-track' ? track : null };
  runInNewContext(source, {
    document: { querySelector: () => section },
    window: { matchMedia: () => ({ matches: reduced }), addEventListener() {} },
    getComputedStyle: () => ({ paddingLeft: '0' }),
    performance: { now: () => now }, requestAnimationFrame() {}
  });
  function wheel(time, values = {}) {
    now = time;
    const event = {
      deltaX: 30, deltaY: 0, deltaMode: 0, shiftKey: false,
      ctrlKey: false, cancelable: true, prevented: false,
      preventDefault() { this.prevented = true; }, ...values
    };
    listeners.wheel?.handler(event);
    return event;
  }
  return { wheel, calls, track, listeners };
}

test('continuous input resumes at a bounded pace without pointer movement', () => {
  const h = setup();
  for (let t = 0; t <= 1500; t += 30) {
    h.track.scrollLeft = Math.min(400 * Math.floor(t / 600), 1200);
    assert.equal(h.wheel(t).prevented, true);
  }
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[0].left, 400);
  assert.equal(h.calls[1].left, 800);
  assert.equal(h.calls[2].left, 1200);
  assert.equal(h.calls[0].behavior, 'smooth');
  assert.equal(h.listeners.wheel.options.passive, false);
});

test('ignored wheel events do not extend the cooldown', () => {
  const h = setup();
  h.wheel(0);
  for (let t = 50; t < 600; t += 50) h.wheel(t);
  h.track.scrollLeft = 400;
  h.wheel(600);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].left, 800);
});

test('direction can reverse after cooldown even while events keep arriving', () => {
  const h = setup({ left: 400 });
  h.wheel(0);
  h.track.scrollLeft = 800;
  for (let t = 30; t < 600; t += 30) h.wheel(t, { deltaX: -30 });
  h.wheel(600, { deltaX: -30 });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].left, 400);
});

test('new gesture after quiet time steps again; early bursts are swallowed', () => {
  const h = setup();
  h.wheel(0); h.wheel(300);
  assert.equal(h.calls.length, 1);
  h.track.scrollLeft = 400;
  h.wheel(650);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].left, 800);
});

test('small deltas accumulate and a reverse gesture goes backwards', () => {
  const h = setup({ left: 800 });
  h.wheel(0, { deltaX: -8 }); h.wheel(20, { deltaX: -8 });
  assert.equal(h.calls.length, 0);
  h.wheel(40, { deltaX: -8 });
  assert.equal(h.calls[0].left, 400);
});

test('vertical scroll, zoom and noncancelable events remain native', () => {
  const h = setup();
  for (const values of [{deltaX:0, deltaY:50}, {deltaX:10, deltaY:50},
    {ctrlKey:true}, {cancelable:false}]) {
    assert.equal(h.wheel(0, values).prevented, false);
  }
  assert.equal(h.calls.length, 0);
});

test('shift-wheel and line/page delta units work', () => {
  for (const values of [{shiftKey:true, deltaX:0, deltaY:30},
    {deltaX:2, deltaMode:1}, {deltaX:1, deltaMode:2}]) {
    const h = setup();
    h.wheel(0, values);
    assert.equal(h.calls.length, 1);
  }
});

test('reduced motion, keyboard stepping and end positions are preserved', () => {
  const h = setup({ reduced:true });
  h.wheel(0);
  assert.equal(h.calls[0].behavior, 'auto');
  h.listeners.keydown.handler({key:'ArrowRight', preventDefault() {}});
  assert.equal(h.calls.length, 2);
  assert.equal(setup({left:1200}).wheel(0).prevented, true);
  const end = setup({left:1200});
  end.wheel(0);
  assert.equal(end.calls.length, 0);
});
