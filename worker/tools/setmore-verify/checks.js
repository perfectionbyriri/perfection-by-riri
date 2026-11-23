// Pure checks for the Setmore verification run (docs/superpowers/specs/
// 2026-11-23-setmore-live-verification-design.md). No network, no logging:
// the runner in ../setmore-verify.js feeds these functions live API data.

import { instantToZonedParts, STUDIO_TIMEZONE } from '../../src/time.js';

// Statuses that free the calendar. Anything else, including a missing or
// unknown status, is treated as blocking so an unexpected value fails safe.
export const NON_BLOCKING_STATUSES = ['CANCELLED', 'CANCELED', 'DELETED'];

// Studio hours by weekday index (0 = Sunday), studio local time.
export const STUDIO_HOURS = {
  0: null,
  1: ['10:00', '17:00'],
  2: ['10:00', '17:00'],
  3: ['10:00', '17:00'],
  4: ['10:00', '17:00'],
  5: ['10:00', '17:00'],
  6: ['10:00', '17:00']
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function slugId(title) {
  return `svc_${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function entryOf(placeholder, service) {
  return {
    placeholder,
    id: service.id,
    title: service.title,
    duration: service.duration,
    cost: service.cost,
    buffer_before: service.buffer?.before ?? 0,
    buffer_after: service.buffer?.after ?? 0,
    provider_ids: service.provider_ids,
    visibility: service.visibility
  };
}

export function mapCatalog(metaServices, setmoreServices) {
  const byId = new Map(setmoreServices.map((service) => [service.id, service]));
  const bySlug = new Map();
  for (const service of setmoreServices) {
    const slug = slugId(service.title);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), service]);
  }
  const map = [];
  const unmatched = [];
  const ambiguous = [];
  const used = new Set();
  for (const { service_id: placeholder } of metaServices) {
    if (byId.has(placeholder)) {
      map.push(entryOf(placeholder, byId.get(placeholder)));
      used.add(placeholder);
      continue;
    }
    const candidates = bySlug.get(placeholder) ?? [];
    if (candidates.length === 0) unmatched.push(placeholder);
    else if (candidates.length > 1) ambiguous.push(placeholder);
    else {
      map.push(entryOf(placeholder, candidates[0]));
      used.add(candidates[0].id);
    }
  }
  const unlisted = setmoreServices.filter((service) => !used.has(service.id)
    && !ambiguous.includes(slugId(service.title))).map((service) => service.title);
  return { map, unmatched, ambiguous, unlisted };
}

export function isBlocking(booking) {
  const status = String(booking?.status ?? '').toUpperCase();
  return !NON_BLOCKING_STATUSES.includes(status);
}

export function findSlotConflicts(days, bookings, { bufferBefore = 0, bufferAfter = 0 } = {}, tz = STUDIO_TIMEZONE) {
  const blocking = bookings.filter(isBlocking)
    .map((booking) => [Date.parse(booking.start_at), Date.parse(booking.end_at)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end));
  const conflicts = [];
  for (const [date, slots] of Object.entries(days ?? {})) {
    for (const slot of Array.isArray(slots) ? slots : []) {
      const start = Date.parse(slot.start_at);
      const end = Date.parse(slot.end_at);
      const from = start - bufferBefore * 60000;
      const to = end + bufferAfter * 60000;
      if (blocking.some(([bStart, bEnd]) => from < bEnd && bStart < to)) {
        conflicts.push({
          date,
          start: instantToZonedParts(new Date(start), tz).time,
          end: instantToZonedParts(new Date(end), tz).time
        });
      }
    }
  }
  return conflicts;
}

export function slotsOutsideHours(days, hours, tz = STUDIO_TIMEZONE) {
  const outside = [];
  for (const [date, slots] of Object.entries(days ?? {})) {
    for (const slot of Array.isArray(slots) ? slots : []) {
      const startParts = instantToZonedParts(new Date(Date.parse(slot.start_at)), tz);
      const endParts = instantToZonedParts(new Date(Date.parse(slot.end_at)), tz);
      const window = hours[WEEKDAYS.indexOf(startParts.weekday)];
      const ok = window
        && endParts.date === startParts.date
        && minutes(startParts.time) >= minutes(window[0])
        && minutes(endParts.time) <= minutes(window[1]);
      if (!ok) outside.push({ date, start: startParts.time });
    }
  }
  return outside;
}

export function applyMap(meta, map) {
  const ids = new Map(map.map((entry) => [entry.placeholder, entry.id]));
  const services = meta.services.map((service) => {
    const id = ids.get(service.service_id);
    if (!id) throw new Error(`No Setmore id for ${service.service_id}`);
    return { ...service, service_id: id };
  });
  return { ...meta, services };
}
