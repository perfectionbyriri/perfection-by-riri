import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDay, groupSlots, renderSlotsError, renderSlotsLoading, renderWeek } from '../../New Perfection/js/booking/render-slots.js';

const slot = (date, hhmm, label) => ({ start_at: `${date}T${hhmm}:00-08:00`, label });

// The shape GET /api/booking/slots returns (ARCHITECTURE §14).
function week(overrides = {}) {
  return {
    service_id: 'svc_lash_lift',
    timezone: 'America/Los_Angeles',
    week_start: '2026-11-23',
    week_end: '2026-11-29',
    days: [
      { date: '2026-11-23', weekday: 'Monday', slots: [slot('2026-11-23', '10:00', '10:00 AM'), slot('2026-11-23', '11:45', '11:45 AM'), slot('2026-11-23', '12:00', '12:00 PM'), slot('2026-11-23', '15:30', '3:30 PM')] },
      { date: '2026-11-24', weekday: 'Tuesday', slots: [] },
      { date: '2026-11-25', weekday: 'Wednesday', slots: [slot('2026-11-25', '13:00', '1:00 PM')] },
      { date: '2026-11-26', weekday: 'Thursday', slots: [] },
      { date: '2026-11-27', weekday: 'Friday', slots: [] },
      { date: '2026-11-28', weekday: 'Saturday', slots: [] },
      { date: '2026-11-29', weekday: 'Sunday', slots: [] }
    ],
    may_have_more: false,
    prev_week_start: '2026-11-16',
    next_week_start: '2026-11-30',
    ...overrides
  };
}

const PACIFIC = 'America/Los_Angeles';
const dayButtons = (html) => [...html.matchAll(/<button\b[^>]*class="bk-day"[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
const dayButton = (html, date) => dayButtons(html).find((item) => item.includes(`data-date="${date}"`));

test('the strip shows seven days with weekday, date and slot count', () => {
  const html = renderWeek({ week: week(), selectedDate: '2026-11-23', deviceTimeZone: PACIFIC });
  assert.equal(dayButtons(html).length, 7);
  assert.match(dayButton(html, '2026-11-23'), /<span class="bk-day-name">Mon<\/span>/);
  assert.match(dayButton(html, '2026-11-23'), /<span class="bk-day-date">23<\/span>/);
  assert.match(dayButton(html, '2026-11-23'), /4 times/);
  assert.match(dayButton(html, '2026-11-25'), /1 time</);
  assert.match(html, /Nov 23 – Nov 29/);
});

test('days with 0 slots get aria-disabled="true"', () => {
  const html = renderWeek({ week: week(), selectedDate: '2026-11-23', deviceTimeZone: PACIFIC });
  assert.match(dayButton(html, '2026-11-24'), /aria-disabled="true"/);
  assert.match(dayButton(html, '2026-11-29'), /aria-disabled="true"/);
  assert.doesNotMatch(dayButton(html, '2026-11-23'), /aria-disabled/);
  assert.match(dayButton(html, '2026-11-24'), /No times/);
});

test('the selected day is pressed and its slots are listed', () => {
  const html = renderWeek({ week: week(), selectedDate: '2026-11-25', deviceTimeZone: PACIFIC });
  assert.match(dayButton(html, '2026-11-25'), /aria-pressed="true"/);
  assert.match(dayButton(html, '2026-11-23'), /aria-pressed="false"/);
  assert.match(html, /data-start-at="2026-11-25T13:00:00-08:00"[^>]*>1:00 PM</);
  assert.doesNotMatch(html, /10:00 AM/);
});

test('slots are grouped into Morning (<12:00) and Afternoon', () => {
  assert.deepEqual(groupSlots(week().days[0].slots).morning.map((item) => item.label), ['10:00 AM', '11:45 AM']);
  assert.deepEqual(groupSlots(week().days[0].slots).afternoon.map((item) => item.label), ['12:00 PM', '3:30 PM']);
  const html = renderWeek({ week: week(), selectedDate: '2026-11-23', deviceTimeZone: PACIFIC });
  const morning = html.indexOf('>Morning<');
  const afternoon = html.indexOf('>Afternoon<');
  assert.ok(morning >= 0 && afternoon > morning);
  assert.ok(html.indexOf('11:45 AM') < afternoon && html.indexOf('12:00 PM') > afternoon);
  const onlyAfternoon = renderWeek({ week: week(), selectedDate: '2026-11-25', deviceTimeZone: PACIFIC });
  assert.doesNotMatch(onlyAfternoon, />Morning</, 'an empty part of the day is not shown');
});

test('the chosen slot is pressed and slot buttons use the site outline button', () => {
  const html = renderWeek({ week: week(), selectedDate: '2026-11-23', selectedStartAt: '2026-11-23T12:00:00-08:00', deviceTimeZone: PACIFIC });
  const slots = [...html.matchAll(/<button\b[^>]*class="button button-outline button-small bk-slot"[^>]*>/g)].map((match) => match[0]);
  assert.equal(slots.length, 4);
  assert.equal(slots.filter((item) => /aria-pressed="true"/.test(item)).length, 1);
  assert.match(slots.find((item) => /aria-pressed="true"/.test(item)), /data-start-at="2026-11-23T12:00:00-08:00"/);
});

test('the back arrow is disabled when prev_week_start is null', () => {
  const first = renderWeek({ week: week({ prev_week_start: null }), selectedDate: '2026-11-23', deviceTimeZone: PACIFIC });
  assert.match(first, /<button[^>]*data-action="prev-week"[^>]*disabled/);
  assert.match(first, /<button[^>]*data-action="next-week"(?![^>]*disabled)[^>]*>/);
  const later = renderWeek({ week: week(), selectedDate: '2026-11-23', deviceTimeZone: PACIFIC });
  assert.match(later, /<button[^>]*data-action="prev-week"(?![^>]*disabled)[^>]*data-week="2026-11-16"|<button[^>]*data-week="2026-11-16"[^>]*data-action="prev-week"(?![^>]*disabled)/);
  const last = renderWeek({ week: week({ next_week_start: null }), selectedDate: '2026-11-23', deviceTimeZone: PACIFIC });
  assert.match(last, /<button[^>]*data-action="next-week"[^>]*disabled/);
});

test('the Pacific Time note appears only when the device zone differs', () => {
  const note = 'Times are shown in Pacific Time.';
  assert.ok(!renderWeek({ week: week(), selectedDate: '2026-11-23', deviceTimeZone: PACIFIC }).includes(note));
  assert.ok(renderWeek({ week: week(), selectedDate: '2026-11-23', deviceTimeZone: 'Europe/Kyiv' }).includes(note));
  assert.ok(renderWeek({ week: week(), selectedDate: '2026-11-23', deviceTimeZone: 'America/New_York' }).includes(note));
});

test('the strip header always names Pacific Time (Lynnwood, WA)', () => {
  assert.match(renderWeek({ week: week(), selectedDate: '2026-11-23', deviceTimeZone: PACIFIC }), /Pacific Time \(Lynnwood, WA\)/);
});

test('an empty week renders the empty-week copy, a next-week button and the phone link', () => {
  const empty = week({ days: week().days.map((day) => ({ ...day, slots: [] })) });
  const html = renderWeek({ week: empty, selectedDate: null, deviceTimeZone: PACIFIC });
  assert.match(html, /No openings this week\./);
  assert.match(html, /<button[^>]*data-action="next-week"[^>]*>Next week ›<\/button>/);
  assert.match(html, /href="tel:\+14258450045"/);
  assert.doesNotMatch(html, /bk-slot"/);
});

test('an empty last week has no next-week button but keeps the phone link', () => {
  const empty = week({ next_week_start: null, days: week().days.map((day) => ({ ...day, slots: [] })) });
  const html = renderWeek({ week: empty, selectedDate: null, deviceTimeZone: PACIFIC });
  assert.doesNotMatch(html, />Next week ›</);
  assert.match(html, /href="tel:\+14258450045"/);
});

test('defaultDay picks the first day with a slot, or null', () => {
  assert.equal(defaultDay(week()), '2026-11-23');
  assert.equal(defaultDay(week({ days: week().days.map((day, index) => ({ ...day, slots: index === 2 ? day.slots : [] })) })), '2026-11-25');
  assert.equal(defaultDay(week({ days: week().days.map((day) => ({ ...day, slots: [] })) })), null);
});

test('the loading state is a busy skeleton with a polite status text', () => {
  const html = renderSlotsLoading();
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading available times…/);
});

test('a busy calendar offers Try again; other failures offer the phone', () => {
  const busy = renderSlotsError({ code: 'UPSTREAM_BUSY' });
  assert.match(busy, /Our booking calendar is busy right now\. Please try again in a minute, or call \(425\) 845 0045\./);
  assert.match(busy, /<button type="button" class="button button-outline" data-action="retry-week">Try again<\/button>/);
  const down = renderSlotsError({ code: 'UPSTREAM_UNAVAILABLE' });
  assert.match(down, /Online booking is taking a short break/);
  assert.match(down, /href="tel:\+14258450045"/);
  assert.match(renderSlotsError({ code: 'NETWORK' }), /data-action="retry-week"/);
});
