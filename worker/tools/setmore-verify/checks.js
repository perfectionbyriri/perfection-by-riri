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

// Live Setmore titles that differ from the placeholder names, confirmed by
// the owner on 2026-11-23 (run 45116299041). Placeholder id -> exact title.
export const TITLE_ALIASES = {
  svc_lip_blushing_touch_up: 'Lip Blushing Touch-Up Session',
  svc_ombre_powder_eyebrows_touch_up: 'Ombre Powder Eyebrows Touch-Up Session',
  svc_eyeliner_touch_up: 'Eyeliner Tattoo Touch-Up Session',
  svc_lash_line_touch_up: 'Lash Line Tattoo Touch-Up Session',
  svc_bottom_eyeliner_touch_up: 'Bottom Eyeliner Tattoo Touch-Up Session',
  svc_wet_effect_full_extension: 'Wet Effect',
  svc_classic_wispy: 'Classic Wispy Effect',
  svc_hybrid_wispy: 'Hybrid Wispy Effect 2D-3D',
  svc_volume_wispy: 'Volume Wispy Effect 4D-5D',
  svc_classic_wispy_refill_2_weeks: 'Classic Wispy Refill 2 Week',
  svc_classic_wispy_refill_3_weeks: 'Classic Wispy Refill 3 Week',
  svc_hybrid_wispy_refill_2_weeks: 'Hybrid Wispy Refill 2 Week',
  svc_hybrid_wispy_refill_3_weeks: 'Hybrid Wispy Refill 3 Week',
  svc_volume_wispy_refill_2_weeks: 'Volume Wispy Refill 2 Week',
  svc_volume_wispy_refill_3_weeks: 'Volume Wispy Refill 3 Week',
  svc_mega_volume_wispy_refill_2_weeks: 'MEGA Volume Wispy Refill 2 Week',
  svc_mega_volume_wispy_refill_3_weeks: 'MEGA Volume Wispy Refill 3 Week'
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

export function mapCatalog(metaServices, setmoreServices, aliases = {}) {
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
    const key = aliases[placeholder] ? slugId(aliases[placeholder]) : placeholder;
    const candidates = bySlug.get(key) ?? [];
    if (candidates.length === 0) unmatched.push(placeholder);
    else if (candidates.length > 1) ambiguous.push(placeholder);
    else {
      map.push(entryOf(placeholder, candidates[0]));
      used.add(candidates[0].id);
    }
  }
  const unlisted = setmoreServices.filter((service) => !used.has(service.id)
    && !ambiguous.some((placeholder) => (aliases[placeholder] ? slugId(aliases[placeholder]) : placeholder) === slugId(service.title))).map((service) => service.title);
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
