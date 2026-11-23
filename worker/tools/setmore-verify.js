// Setmore live verification (docs/superpowers/specs/2026-11-23-setmore-live-verification-design.md).
//
// Usage: node worker/tools/setmore-verify.js --mode=read
//
// Uses the production Setmore client and token manager. The repository and
// its Actions logs are public, so the log carries only public service data
// (ids, titles, durations, prices, buffers), counts, dates and times. It never
// prints customer data, booking ids, booking titles or consumer ids.
//
// mode=read makes GET requests only.

import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createSetmoreClient } from '../src/setmore/client.js';
import { createTokenManager } from '../src/setmore/token-manager.js';
import { addDays, studioToday, weekWindow } from '../src/time.js';
import { STUDIO_HOURS, findSlotConflicts, mapCatalog, slotsOutsideHours } from './setmore-verify/checks.js';

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
      slot_limit: 100,
      double_booking: false,
      working_hours: workingHours
    }
  });
  const days = body?.data?.days;
  return days && typeof days === 'object' && !Array.isArray(days) ? days : {};
}

export async function runRead({ client, meta, config, now = () => new Date(), log = () => {} }) {
  const services = await client.listServices();
  const catalog = mapCatalog(meta.services, services);
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
      for (const weekStart of weekStarts) {
        const { startAt, endAt } = weekWindow(weekStart, tz);
        const days = await fetchSlots(client, config, { duration: pair.duration, startAt, endAt, workingHours });
        slotCount += Object.values(days).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
        const withBuffers = findSlotConflicts(days, bookings, { bufferBefore: pair.buffer_before, bufferAfter: pair.buffer_after }, tz);
        if (hasBuffer && !workingHours) {
          bufferOnlyConflicts += withBuffers.length - findSlotConflicts(days, bookings, {}, tz).length;
        }
        for (const c of withBuffers) conflicts.push({ working_hours: workingHours, ...pair, ...c });
        for (const o of slotsOutsideHours(days, STUDIO_HOURS, tz)) outsideHours.push({ working_hours: workingHours, ...o });
      }
      log(`slots: duration=${pair.duration} buffer=${pair.buffer_before}/${pair.buffer_after} working_hours=${workingHours} slots=${slotCount}`);
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
  const vars = readWranglerVars();
  const config = {
    setmoreAccountId: vars.SETMORE_ACCOUNT_ID,
    setmoreProviderId: vars.SETMORE_PROVIDER_ID,
    studioTimezone: vars.STUDIO_TIMEZONE
  };
  const meta = JSON.parse(readFileSync(path.join(ROOT, 'worker/config/services-meta.json'), 'utf8'));
  const client = createLiveClient(process.env);
  try {
    if (mode === 'read') {
      const result = await runRead({ client, meta, config, log: (line) => console.log(line) });
      summary(`Setmore verify (read): **ok=${result.ok}**, buffer_honoured=${result.bufferHonoured}`);
      if (!result.ok) process.exitCode = 1;
    } else {
      console.error(`Unknown mode: ${mode}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // Print the error class only; messages could echo request details.
    console.error(`Verification failed unexpectedly: ${error?.name || 'Error'}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
