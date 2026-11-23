// Slots service (ARCHITECTURE §6).
//
// One request covers one studio week: week_start 00:00 local to +7 days
// 00:00 local (the two boundaries may carry different offsets across DST).
// Setmore returns starts on a 5-minute grid plus an empty key for the end
// date; the BFF keeps the seven requested days, removes starts inside the
// lead time or past the horizon. Setmore's own slot interval decides which
// starts exist (owner, 2026-11-23); the BFF does not thin them further.
// Slots are matched by instant, never by string.

import { BookingError } from './errors.js';
import { addDays, formatRfc3339Local, formatSlotLabel, instantToZonedParts, studioToday, weekWindow } from './time.js';

const CACHE_PREFIX = 'https://bff.internal/slots/v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}

export function parseInstant(value) {
  if (typeof value !== 'string' || !RFC3339_RE.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

export function createSlotsService({ client, catalog, config, cache = null, now = () => new Date() }) {
  const tz = config.studioTimezone;

  const cacheKey = (serviceId, weekStart) => `${CACHE_PREFIX}/${encodeURIComponent(serviceId)}/${weekStart}`;

  async function requireService(serviceId) {
    const service = typeof serviceId === 'string' && serviceId ? await catalog.getService(serviceId) : null;
    if (!service) throw new BookingError('NOT_FOUND', { message: 'That service is not available for online booking.' });
    return service;
  }

  function range() {
    const today = studioToday(now(), tz);
    return { today, firstWeekStart: addDays(today, -6), lastDate: addDays(today, config.bookingHorizonDays) };
  }

  async function readCached(key) {
    if (!cache) return null;
    try {
      const response = await cache.match(key);
      return response ? await response.json() : null;
    } catch {
      return null;
    }
  }

  async function writeCached(key, days) {
    if (!cache) return;
    try {
      await cache.put(key, new Response(JSON.stringify(days), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${config.slotsTtlSeconds}` }
      }));
    } catch {
      // A cache write failure only costs an extra upstream call later.
    }
  }

  async function upstreamDays(service, weekStart, { bypassCache }) {
    const key = cacheKey(service.service_id, weekStart);
    if (!bypassCache) {
      const cached = await readCached(key);
      if (cached && typeof cached === 'object') return cached;
    }
    const { startAt, endAt } = weekWindow(weekStart, tz);
    const days = await client.getSlots({
      accountId: config.setmoreAccountId,
      providerId: config.setmoreProviderId,
      duration: service.duration_minutes,
      startAt,
      endAt,
      timezone: tz,
      slotLimit: 100
    });
    await writeCached(key, days);
    return days;
  }

  function buildWeek(service, weekStart, days) {
    const { firstWeekStart, lastDate } = range();
    const earliest = now().getTime() + config.minLeadMinutes * 60000;
    const result = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(weekStart, i);
      const seen = new Set();
      const slots = [];
      const raw = date <= lastDate && Array.isArray(days?.[date]) ? days[date] : [];
      for (const item of raw) {
        const instant = parseInstant(item?.start_at);
        if (!instant || instant.getTime() < earliest || seen.has(instant.getTime())) continue;
        const parts = instantToZonedParts(instant, tz);
        if (parts.date !== date) continue;
        seen.add(instant.getTime());
        slots.push({ instant: instant.getTime(), start_at: formatRfc3339Local(parts.date, parts.time, tz), label: formatSlotLabel(instant, tz) });
      }
      slots.sort((a, b) => a.instant - b.instant);
      result.push({
        date,
        weekday: instantToZonedParts(new Date(Date.parse(`${date}T12:00:00Z`)), 'UTC').weekday,
        slots: slots.map(({ start_at, label }) => ({ start_at, label }))
      });
    }
    const prev = addDays(weekStart, -7);
    const next = addDays(weekStart, 7);
    return {
      service_id: service.service_id,
      timezone: tz,
      week_start: weekStart,
      week_end: addDays(weekStart, 6),
      days: result,
      may_have_more: false,
      prev_week_start: prev >= firstWeekStart ? prev : null,
      next_week_start: next <= lastDate ? next : null
    };
  }

  async function getWeek({ serviceId, weekStart } = {}) {
    const service = await requireService(serviceId);
    const { today, firstWeekStart, lastDate } = range();
    const start = weekStart ?? today;
    if (!validDate(start)) {
      throw new BookingError('VALIDATION_FAILED', { fields: { week_start: 'Use a date in the form YYYY-MM-DD.' } });
    }
    if (start < firstWeekStart || start > lastDate) throw new BookingError('OUT_OF_RANGE');
    const days = await upstreamDays(service, start, { bypassCache: false });
    return buildWeek(service, start, days);
  }

  async function isSlotAvailable({ serviceId, startAt }) {
    const service = await requireService(serviceId);
    const instant = parseInstant(startAt);
    if (!instant) throw new BookingError('VALIDATION_FAILED', { fields: { start_at: 'Choose a time from the list.' } });
    const weekStart = instantToZonedParts(instant, tz).date;
    const { today, lastDate } = range();
    if (weekStart < today || weekStart > lastDate) return { available: false, refreshedWeek: null };
    const days = await upstreamDays(service, weekStart, { bypassCache: true });
    const refreshedWeek = buildWeek(service, weekStart, days);
    const available = refreshedWeek.days.some((day) => day.slots.some((item) => Date.parse(item.start_at) === instant.getTime()));
    return { available, refreshedWeek };
  }

  async function purgeWeek(serviceId, weekStart) {
    if (!cache) return;
    try {
      await cache.delete(cacheKey(serviceId, weekStart));
    } catch {
      // Purge is best effort; the entry expires within SLOTS_TTL_SECONDS anyway.
    }
  }

  return { getWeek, isSlotAvailable, purgeWeek };
}
