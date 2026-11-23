// Step 2 · Date & time (docs/booking/DESIGN_SPEC.md §4, §7).
//
// Renders one 7-day window from GET /api/booking/slots. Times are always the
// studio's Pacific Time labels from the API; the device zone only decides
// whether to say so.

import { escapeHtml } from './html.js';

const STUDIO_ZONE = 'America/Los_Angeles';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PHONE_LINK = '<a href="tel:+14258450045">(425) 845 0045</a>';

function shortDate(dateISO) {
  const [, month, day] = dateISO.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

// The API's start_at carries the studio offset, so its clock digits are Pacific.
const studioHour = (startAt) => Number(startAt.slice(11, 13));

export function groupSlots(slots) {
  return {
    morning: slots.filter((item) => studioHour(item.start_at) < 12),
    afternoon: slots.filter((item) => studioHour(item.start_at) >= 12)
  };
}

export function defaultDay(week) {
  return week.days.find((day) => day.slots.length > 0)?.date ?? null;
}

function arrow(action, target, label, symbol) {
  return target
    ? `<button type="button" class="bk-week-arrow" data-action="${action}" data-week="${escapeHtml(target)}" aria-label="${label}">${symbol}</button>`
    : `<button type="button" class="bk-week-arrow" data-action="${action}" aria-label="${label}" disabled>${symbol}</button>`;
}

function dayButton(day, selectedDate) {
  const count = day.slots.length;
  const countLabel = count === 0 ? 'No times' : `${count} ${count === 1 ? 'time' : 'times'}`;
  const disabled = count === 0 ? ' aria-disabled="true"' : '';
  return `<li><button type="button" class="bk-day" data-date="${escapeHtml(day.date)}" aria-pressed="${day.date === selectedDate ? 'true' : 'false'}"${disabled}>`
    + `<span class="bk-day-name">${escapeHtml(day.weekday.slice(0, 3))}</span>`
    + `<span class="bk-day-date">${Number(day.date.slice(8, 10))}</span>`
    + `<span class="bk-day-count">${countLabel}</span>`
    + '</button></li>';
}

function slotGroup(title, slots, selectedStartAt, dayLabel) {
  if (!slots.length) return '';
  const buttons = slots.map((item) => `<button type="button" class="button button-outline button-small bk-slot" data-start-at="${escapeHtml(item.start_at)}" aria-pressed="${item.start_at === selectedStartAt ? 'true' : 'false'}">${escapeHtml(item.label)}</button>`).join('');
  const date = dayLabel ? `<span class="bk-slot-group-date"> &middot; ${escapeHtml(dayLabel)}</span>` : '';
  return `<div class="bk-slot-group"><h3 class="bk-slot-group-title">${title}${date}</h3><div class="bk-slot-list">${buttons}</div></div>`;
}

export function renderWeek({ week, selectedDate, selectedStartAt = null, deviceTimeZone }) {
  const head = '<div class="bk-week-head">'
    + '<p class="bk-week-zone">Pacific Time (Lynnwood, WA)</p>'
    + '<div class="bk-week-nav">'
    + arrow('prev-week', week.prev_week_start, 'Previous week', '‹')
    + `<p class="bk-week-range">${shortDate(week.week_start)} – ${shortDate(week.week_end)}</p>`
    + arrow('next-week', week.next_week_start, 'Next week', '›')
    + '</div></div>';
  const note = deviceTimeZone && deviceTimeZone !== STUDIO_ZONE ? '<p class="bk-zone-note">Times are shown in Pacific Time.</p>' : '';
  const strip = `<ol class="bk-days" aria-label="Days of the week">${week.days.map((day) => dayButton(day, selectedDate)).join('')}</ol>`;

  if (!defaultDay(week)) {
    const next = week.next_week_start
      ? ` <button type="button" class="bk-text-button" data-action="next-week" data-week="${escapeHtml(week.next_week_start)}">Next week ›</button>`
      : '';
    return `${head}${note}${strip}<div class="bk-empty"><p>No openings this week.${next}</p>`
      + `<p class="bk-fine">Can&rsquo;t find a time that works? Call ${PHONE_LINK} and we&rsquo;ll help.</p></div>`;
  }

  const day = week.days.find((item) => item.date === selectedDate);
  const { morning, afternoon } = groupSlots(day ? day.slots : []);
  const dayLabel = day ? `${day.weekday}, ${shortDate(day.date)}` : '';
  const slots = day
    ? `<div class="bk-slots bk-slots-split">${slotGroup('Morning', morning, selectedStartAt, dayLabel)}${slotGroup('Afternoon', afternoon, selectedStartAt, dayLabel)}</div>`
    : '';
  return `${head}${note}${strip}${slots}`;
}

export function renderSlotsLoading() {
  return '<div class="bk-slots-loading" aria-busy="true">'
    + '<div class="bk-skeleton-row"></div><div class="bk-skeleton-row"></div>'
    + '<p class="sr-only">Loading available times…</p></div>';
}

export function renderSlotsError(error) {
  if (error?.code === 'UPSTREAM_BUSY' || error?.code === 'RATE_LIMITED' || error?.code === 'NETWORK') {
    return '<p>Our booking calendar is busy right now. Please try again in a minute, or call (425) 845 0045.</p>'
      + '<button type="button" class="button button-outline" data-action="retry-week">Try again</button>';
  }
  return '<p>Online booking is taking a short break. Please call (425) 845 0045 and we&rsquo;ll book you in.</p>'
    + '<a class="button button-gold" href="tel:+14258450045">Call (425) 845 0045</a>';
}
