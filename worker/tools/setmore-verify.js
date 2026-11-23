// Setmore live verification (docs/superpowers/specs/2026-11-23-setmore-live-verification-design.md).
//
// Usage: node worker/tools/setmore-verify.js --mode=read
//
// Uses the production Setmore client and token manager. The repository and
// its Actions logs are public, so the log carries only public service data
// (ids, titles, durations, prices, buffers), counts, dates and times. It never
// prints customer data, booking ids, booking titles or consumer ids.
//
// mode=read makes GET requests only. mode=write creates one booking on the
// owner's contact (SETMORE_TEST_EMAIL / SETMORE_TEST_PHONE), verifies that the
// slot disappears, then deletes the booking.

import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createCatalogService } from '../src/catalog.js';
import { loadConfig } from '../src/config.js';
import { createCustomerResolver } from '../src/customers.js';
import { createSetmoreClient } from '../src/setmore/client.js';
import { createSlotsService } from '../src/slots.js';
import { createTokenManager } from '../src/setmore/token-manager.js';
import { addDays, formatRfc3339Local, instantToZonedParts, studioToday, weekWindow } from '../src/time.js';
import { createMemoryKV } from './setmore-verify/memory-kv.js';
import { STUDIO_HOURS, TITLE_ALIASES, findSlotConflicts, mapCatalog, slotsOutsideHours } from './setmore-verify/checks.js';

const WEEKS = 4;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_API_BASE = 'https://developer.setmore.com/api/v2';

function distinctPairs(map) {
  const pairs = new Map();
  for (const entry of map) {
    const key = `${entry.duration}/${entry.buffer_before}/${entry.buffer_after}`;
    if (!pairs.has(key)) {
      pairs.set(key, { duration: entry.duration, buffer_before: entry.buffer_before, buffer_after: entry.buffer_after });
    }
  }
  return [...pairs.values()];
}

async function fetchSlots(client, config, { duration, startAt, endAt, workingHours }) {
  const body = await client.request('GET', '/slots', {
    query: {
      account_id: config.setmoreAccountId,
      provider_id: config.setmoreProviderId,
      duration,
      start_at: startAt,
      end_at: endAt,
      timezone: config.studioTimezone,
      slot_limit: 15,
      double_booking: false,
      working_hours: workingHours
    }
  });
  const days = body?.data?.days;
  return days && typeof days === 'object' && !Array.isArray(days) ? days : {};
}

export async function runRead({ client, meta, config, now = () => new Date(), log = () => {} }) {
  const services = await client.listServices();
  const catalog = mapCatalog(meta.services, services, TITLE_ALIASES);
  log(`CATALOG_MAP ${JSON.stringify(catalog.map)}`);
  log(`catalog: mapped=${catalog.map.length} unmatched=${JSON.stringify(catalog.unmatched)} ambiguous=${JSON.stringify(catalog.ambiguous)} unlisted=${JSON.stringify(catalog.unlisted)}`);

  const tz = config.studioTimezone;
  const today = studioToday(now(), tz);
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => addDays(today, 7 * i));

  const bookings = [];
  for (const weekStart of weekStarts) {
    const { startAt, endAt } = weekWindow(weekStart, tz);
    bookings.push(...await client.listBookingsByStaff({ staffId: config.setmoreProviderId, startAt, endAt }));
  }
  const statuses = {};
  for (const booking of bookings) statuses[booking?.status ?? '(none)'] = (statuses[booking?.status ?? '(none)'] ?? 0) + 1;
  log(`bookings: count=${bookings.length} statuses=${JSON.stringify(statuses)}`);

  const conflicts = [];
  const outsideHours = [];
  let bufferedPairs = 0;
  let bufferOnlyConflicts = 0;
  for (const pair of distinctPairs(catalog.map)) {
    const hasBuffer = pair.buffer_before > 0 || pair.buffer_after > 0;
    if (hasBuffer) bufferedPairs += 1;
    for (const workingHours of [false, true]) {
      let slotCount = 0;
      const startTimes = {};
      for (const weekStart of weekStarts) {
        const { startAt, endAt } = weekWindow(weekStart, tz);
        const days = await fetchSlots(client, config, { duration: pair.duration, startAt, endAt, workingHours });
        slotCount += Object.values(days).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
        for (const list of Object.values(days)) {
          for (const slot of Array.isArray(list) ? list : []) {
            const time = instantToZonedParts(new Date(Date.parse(slot.start_at)), tz).time;
            startTimes[time] = (startTimes[time] ?? 0) + 1;
          }
        }
        const withBuffers = findSlotConflicts(days, bookings, { bufferBefore: pair.buffer_before, bufferAfter: pair.buffer_after }, tz);
        if (hasBuffer && !workingHours) {
          bufferOnlyConflicts += withBuffers.length - findSlotConflicts(days, bookings, {}, tz).length;
        }
        for (const c of withBuffers) conflicts.push({ working_hours: workingHours, ...pair, ...c });
        for (const o of slotsOutsideHours(days, STUDIO_HOURS, tz)) outsideHours.push({ working_hours: workingHours, ...o });
      }
      log(`slots: duration=${pair.duration} buffer=${pair.buffer_before}/${pair.buffer_after} working_hours=${workingHours} slots=${slotCount}`);
      const sortedTimes = Object.fromEntries(Object.entries(startTimes).sort(([a], [b]) => a.localeCompare(b)));
      log(`slot_times duration=${pair.duration} working_hours=${workingHours} ${JSON.stringify(sortedTimes)}`);
    }
  }

  const bufferHonoured = bufferedPairs === 0 ? null : bufferOnlyConflicts === 0;
  const conflictsLive = conflicts.filter((c) => !c.working_hours);
  const outsideLive = outsideHours.filter((o) => !o.working_hours);
  for (const flag of [false, true]) {
    log(`conflicts working_hours=${flag}: ${JSON.stringify(conflicts.filter((c) => c.working_hours === flag))}`);
    log(`outside_hours working_hours=${flag}: ${JSON.stringify(outsideHours.filter((o) => o.working_hours === flag))}`);
  }
  log(`buffer_honoured=${bufferHonoured}`);

  const ok = catalog.unmatched.length === 0 && catalog.ambiguous.length === 0
    && conflictsLive.length === 0 && outsideLive.length === 0;
  log(`RESULT ok=${ok}`);
  return { ok, catalog, conflicts, outsideHours, bufferHonoured };
}

export const VERIFY_LABEL = 'pbr-verify';
export const VERIFY_NOTE = 'Setmore API verification by perfectionbyriri.com — safe to delete.';
const MIN_DAYS_AHEAD = 14;

async function firstFreeSlot({ slots, serviceId, today }) {
  let weekStart = addDays(today, MIN_DAYS_AHEAD);
  while (weekStart) {
    const week = await slots.getWeek({ serviceId, weekStart });
    for (const day of week.days) {
      if (day.date < addDays(today, MIN_DAYS_AHEAD)) continue;
      if (day.slots.length) return day.slots[0].start_at;
    }
    weekStart = week.next_week_start;
  }
  return null;
}

function weekHasStart(week, startAt) {
  return week.days.some((day) => day.slots.some((slot) => slot.start_at === startAt));
}

export async function runWrite({ client, catalogService, slots, resolver, config, contact, now = () => new Date(), log = () => {} }) {
  const tz = config.studioTimezone;
  const result = {
    ok: false, slot: null, slotGoneAfterCreate: false, freshCheckRefused: false, slotFreeAfterDelete: false,
    markerReturned: false, customerCreated: false, customerFields: [], bookingFields: [], deleted: false
  };
  const { groups } = await catalogService.getCatalog();
  const service = groups.flatMap((group) => group.services)
    .reduce((best, item) => (!best || item.duration_minutes < best.duration_minutes ? item : best), null);
  if (!service) throw new Error('catalog empty');
  const today = studioToday(now(), tz);
  const startAt = await firstFreeSlot({ slots, serviceId: service.service_id, today });
  if (!startAt) {
    log('RESULT ok=false reason=no_free_slot');
    return result;
  }
  const startParts = instantToZonedParts(new Date(Date.parse(startAt)), tz);
  const endParts = instantToZonedParts(new Date(Date.parse(startAt) + service.duration_minutes * 60000), tz);
  const endAt = formatRfc3339Local(endParts.date, endParts.time, tz);
  result.slot = { date: startParts.date, start: startParts.time };
  log(`test slot: ${startParts.date} ${startParts.time} duration=${service.duration_minutes} service=${service.service_id}`);

  const { customerId, created } = await resolver.resolve({ firstName: 'Riri', lastName: 'Verification', email: contact.email, phone: contact.phone });
  result.customerCreated = created === true;
  log(`customer_created=${result.customerCreated}`);
  try {
    result.customerFields = Object.keys(await client.getCustomer(customerId)).sort();
  } catch (error) {
    log(`customer read failed: ${error?.name || 'Error'}`);
  }
  log(`customer fields: ${JSON.stringify(result.customerFields)}`);

  const booking = await client.createBooking({
    type: 'APPOINTMENT',
    account_id: config.setmoreAccountId,
    provider_id: config.setmoreProviderId,
    consumer_ids: [customerId],
    service_id: service.service_id,
    start_at: startAt,
    end_at: endAt,
    cost: service.price_cents / 100,
    label: VERIFY_LABEL,
    notes: VERIFY_NOTE
  });
  log('booking created');

  try {
    const week = await slots.getWeek({ serviceId: service.service_id, weekStart: startParts.date });
    result.slotGoneAfterCreate = !weekHasStart(week, startAt);
    result.freshCheckRefused = !(await slots.isSlotAvailable({ serviceId: service.service_id, startAt })).available;
    const day = weekWindow(startParts.date, tz);
    const listed = await client.listBookingsByStaff({ staffId: config.setmoreProviderId, startAt: day.startAt, endAt: day.endAt });
    const found = listed.find((item) => item?.id === booking.id);
    result.bookingFields = found ? Object.keys(found).sort() : [];
    result.markerReturned = Boolean(found) && JSON.stringify({ label: found.label, meta: found.meta_data, notes: found.notes }).includes(VERIFY_LABEL);
  } catch (error) {
    log(`check after create failed: ${error?.name || 'Error'}`);
  } finally {
    try {
      await client.request('DELETE', `/bookings/${encodeURIComponent(booking.id)}`);
      result.deleted = true;
      log('booking deleted');
    } catch (error) {
      log(`DELETE FAILED (${error?.name || 'Error'}): remove the test booking in Setmore by hand: ${startParts.date} ${startParts.time} (${tz})`);
    }
  }

  if (result.deleted) {
    try {
      result.slotFreeAfterDelete = (await slots.isSlotAvailable({ serviceId: service.service_id, startAt })).available;
    } catch (error) {
      log(`check after delete failed: ${error?.name || 'Error'}`);
    }
  }
  log(`booking fields: ${JSON.stringify(result.bookingFields)}`);
  result.ok = result.slotGoneAfterCreate && result.freshCheckRefused && result.deleted && result.slotFreeAfterDelete;
  log(`RESULT ok=${result.ok} slot_gone=${result.slotGoneAfterCreate} fresh_check_refused=${result.freshCheckRefused} deleted=${result.deleted} slot_free_after_delete=${result.slotFreeAfterDelete} marker_returned=${result.markerReturned}`);
  return result;
}

export function readWranglerVars(file = path.join(ROOT, 'wrangler.jsonc')) {
  const text = readFileSync(file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  return JSON.parse(text).vars;
}

export function createLiveClient(env, fetchImpl = globalThis.fetch) {
  const apiBase = env.SETMORE_API_BASE || DEFAULT_API_BASE;
  const tokenManager = createTokenManager({ refreshToken: env.SETMORE_REFRESH_TOKEN, apiBase, fetch: fetchImpl });
  return createSetmoreClient({ apiBase, tokenManager, fetch: fetchImpl });
}

function summary(line) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function main() {
  const mode = (process.argv.find((arg) => arg.startsWith('--mode=')) ?? '--mode=read').slice('--mode='.length);
  if (!process.env.SETMORE_REFRESH_TOKEN) {
    console.error('SETMORE_REFRESH_TOKEN is not set.');
    process.exitCode = 1;
    return;
  }
  // Production values from wrangler.jsonc, with live Setmore and no payments.
  const config = loadConfig({
    ...readWranglerVars(),
    ENVIRONMENT: 'verification',
    SETMORE_MOCK_MODE: 'false',
    PAYMENTS_MOCK_MODE: 'true',
    SQUARE_ENVIRONMENT: 'sandbox',
    SETMORE_REFRESH_TOKEN: process.env.SETMORE_REFRESH_TOKEN
  });
  const meta = JSON.parse(readFileSync(path.join(ROOT, 'worker/config/services-meta.json'), 'utf8'));
  const client = createLiveClient(process.env);
  try {
    if (mode === 'read') {
      const result = await runRead({ client, meta, config, log: (line) => console.log(line) });
      summary(`Setmore verify (read): **ok=${result.ok}**, buffer_honoured=${result.bufferHonoured}`);
      if (!result.ok) process.exitCode = 1;
    } else if (mode === 'write') {
      const contact = { email: process.env.SETMORE_TEST_EMAIL, phone: process.env.SETMORE_TEST_PHONE };
      if (!contact.email || !contact.phone) {
        console.error('SETMORE_TEST_EMAIL and SETMORE_TEST_PHONE must be set.');
        process.exitCode = 1;
        return;
      }
      const catalogService = createCatalogService({ client, meta, config });
      const slots = createSlotsService({ client, catalog: catalogService, config });
      const secret = randomBytes(32).toString('hex');
      const resolver = createCustomerResolver({ client, kv: createMemoryKV(), secret, maxPages: config.customerScanMaxPages });
      const result = await runWrite({ client, catalogService, slots, resolver, config, contact, log: (line) => console.log(line) });
      summary(`Setmore verify (write): **ok=${result.ok}**, deleted=${result.deleted}`);
      if (!result.ok) process.exitCode = 1;
    } else {
      console.error(`Unknown mode: ${mode}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // Print the error class only; messages could echo request details.
    // Upstream error codes are Setmore's own short codes (no request data).
    const code = error?.upstreamCode ? ` (${error.upstreamCode})` : '';
    console.error(`Verification failed unexpectedly: ${error?.name || 'Error'}${code}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
