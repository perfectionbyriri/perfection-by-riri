// Read-only Setmore API probe (IMPLEMENTATION_PLAN Task 1).
//
// Answers two questions before any booking code is written:
//   1. Does the owner's refresh token work with API v2, v1, or neither?
//   2. What do the real v2 responses look like (field names, slot format)?
//
// Safety rules:
//   - GET requests only. Never calls /customers. Reads bookings only through
//     GET /bookings/staffs/{id} and reports status, count and type schema only.
//   - The report holds type schemas and allowlisted, non-personal values only.
//     It runs in a public repository's Actions log, so tokens, emails, phones
//     and unknown string values are always redacted.
//   - URLs in the report never include the query string (the refresh token
//     travels in the query).

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const V2_BASE = 'https://developer.setmore.com/api/v2';
const V1_TOKEN_URL = 'https://developer.setmore.com/api/v1/o/oauth2/token';
const STUDIO_TIMEZONE = 'America/Los_Angeles';
const TIMEOUT_MS = 10000;
const ARRAY_SAMPLE = 3;

const ID_KEYS = new Set([
  'id', 'key', 'account_id', 'provider_id', 'staff_id', 'service_id', 'category_id',
  'user_id', 'staff_ids', 'staff_keys', 'service_ids', 'provider_ids', 'category_ids'
]);
const VALUE_KEYS = new Set([
  // Person names (first_name, last_name) are deliberately absent.
  'name', 'service_name', 'category_name', 'title', 'duration',
  'duration_minutes', 'cost', 'price', 'currency', 'type', 'status', 'token_type',
  'expires_in', 'timezone', 'start_at', 'end_at', 'start_time', 'end_time', 'slot',
  'visibility'
]);
const SAFE_ID = /^[A-Za-z0-9_\-:.]{1,128}$/;
const PHONE_LIKE = /^\+?[\d\s().-]{7,}$/;

function isTokenKey(key) {
  return typeof key === 'string' && key.toLowerCase() !== 'token_type' && /token$/i.test(key);
}

export function schemaOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? [schemaOf(value[0])] : [];
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, schemaOf(v)]));
  }
  return typeof value;
}

function redactPrimitive(value, key) {
  if (value === null || typeof value === 'boolean') return value;
  if (isTokenKey(key)) return '<redacted>';
  if (ID_KEYS.has(key)) {
    if (typeof value === 'number') return value;
    return typeof value === 'string' && SAFE_ID.test(value) ? value : '<redacted>';
  }
  if (VALUE_KEYS.has(key)) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      return value.includes('@') || PHONE_LIKE.test(value.trim()) ? '<redacted>' : value;
    }
    return '<redacted>';
  }
  if (typeof value === 'number') return '<number>';
  return '<string>';
}

export function redact(value, key) {
  if (key === 'cursor') return Boolean(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, ARRAY_SAMPLE).map((item) => redact(item, key));
    if (value.length > ARRAY_SAMPLE) items.push(`…(+${value.length - ARRAY_SAMPLE} more)`);
    return items;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      // Values under `days` are slot lists keyed by date; give them the slot rule.
      Object.entries(value).map(([k, v]) => [k, redact(v, key === 'days' ? 'slot' : k)])
    );
  }
  return redactPrimitive(value, key);
}

function studioDateParts(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: STUDIO_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(instant).map((part) => [part.type, part.value])
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function midnightOffset(year, month, day) {
  // Local midnight is never inside a DST gap (changes happen at 02:00), and
  // 08:00 UTC on that date is still before the change, so its offset holds.
  const probe = new Date(Date.UTC(year, month - 1, day, 8));
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: STUDIO_TIMEZONE, timeZoneName: 'longOffset'
  }).formatToParts(probe).find((part) => part.type === 'timeZoneName').value;
  const match = /^GMT([+-]\d{2}:\d{2})$/.exec(name);
  return match ? match[1] : '+00:00';
}

function localMidnight(utcDate) {
  const year = utcDate.getUTCFullYear();
  const month = utcDate.getUTCMonth() + 1;
  const day = utcDate.getUTCDate();
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return `${date}T00:00:00${midnightOffset(year, month, day)}`;
}

export function studioWeekAfter(now, offsetWeeks = 0) {
  const { year, month, day } = studioDateParts(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  const daysToMonday = ((1 - today.getUTCDay() + 7) % 7) || 7;
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() + daysToMonday + 7 * offsetWeeks);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { startAt: localMidnight(start), endAt: localMidnight(end) };
}

async function getJson(fetch, baseUrl, query = {}, headers = {}) {
  const url = new URL(baseUrl);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
  const result = { url: `${url.origin}${url.pathname}`, status: null, ok: false, body: null };
  try {
    const response = await fetch(url, {
      method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    result.status = response.status;
    result.ok = response.ok;
    try {
      result.body = await response.json();
    } catch {
      result.body = null;
      result.non_json = true;
    }
  } catch (error) {
    result.error = error?.name || 'Error';
  }
  return result;
}

function summarize(result) {
  const summary = { url: result.url, status: result.status, ok: result.ok };
  if (result.error) summary.error = result.error;
  if (result.non_json) summary.non_json = true;
  summary.schema = schemaOf(result.body);
  summary.sample = redact(result.body);
  return summary;
}

function listOf(body) {
  return Array.isArray(body?.data) ? body.data : [];
}

function countBy(items, pick) {
  const counts = {};
  for (const item of items) {
    for (const value of pick(item)) {
      if (typeof value === 'string' && SAFE_ID.test(value)) counts[value] = (counts[value] ?? 0) + 1;
    }
  }
  return counts;
}

function visibilityCounts(items) {
  return countBy(items, (item) => [item?.visibility]);
}

function summarizeSlotWindow(result, window) {
  const days = result.body?.data?.days;
  const entries = days && typeof days === 'object' ? Object.entries(days) : [];
  const nonEmpty = entries.filter(([, slots]) => Array.isArray(slots) && slots.length).sort(([a], [b]) => a.localeCompare(b));
  const summary = { start_at: window.startAt, end_at: window.endAt, status: result.status, ok: result.ok };
  if (result.error) summary.error = result.error;
  summary.day_keys = entries.map(([date]) => date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  summary.day_count = entries.length;
  summary.slot_count = entries.reduce((total, [, slots]) => total + (Array.isArray(slots) ? slots.length : 0), 0);
  summary.first_non_empty_day = nonEmpty.length
    ? { date: nonEmpty[0][0], sample: redact(nonEmpty[0][1], 'slot'), element_schema: schemaOf(nonEmpty[0][1][0]) }
    : null;
  if (!entries.length) summary.schema = schemaOf(result.body);
  return summary;
}

function findAccountId(tokenData, staff, service) {
  const keys = ['account_id', 'merchant_id', 'company_id'];
  const sources = [['token', tokenData], ['staff[0]', staff], ['services[0]', service]];
  for (const [label, object] of sources) {
    for (const key of keys) {
      if (object && object[key] != null) return { value: object[key], source: `${label}.${key}` };
    }
  }
  if (tokenData?.user_id != null) return { value: tokenData.user_id, source: 'token.user_id' };
  return { value: undefined, source: 'none' };
}

function findDuration(service) {
  for (const key of ['duration', 'duration_minutes']) {
    if (typeof service?.[key] === 'number' && service[key] > 0) return service[key];
  }
  return 60;
}

export async function runProbe({ env, fetch, now = () => new Date(), log = console }) {
  const report = {
    probe: 'setmore-read-only',
    ran_at: now().toISOString(),
    conclusion: 'skipped',
    v2: {},
    v1: {}
  };
  const refreshToken = typeof env?.SETMORE_REFRESH_TOKEN === 'string' ? env.SETMORE_REFRESH_TOKEN.trim() : '';
  if (!refreshToken) {
    report.reason = 'SETMORE_REFRESH_TOKEN is not set';
    return report;
  }

  const v2Token = await getJson(fetch, `${V2_BASE}/o/oauth2/token`, { refreshToken });
  report.v2.token = summarize(v2Token);
  log.log(`v2 token: ${v2Token.status ?? v2Token.error}`);
  const tokenData = v2Token.body?.data?.token;
  const accessToken = v2Token.ok && typeof tokenData?.access_token === 'string' ? tokenData.access_token : '';

  let v2ReadsOk = false;
  if (accessToken) {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const staff = await getJson(fetch, `${V2_BASE}/staff`, {}, auth);
    const services = await getJson(fetch, `${V2_BASE}/services`, {}, auth);
    const categories = await getJson(fetch, `${V2_BASE}/categories`, {}, auth);
    report.v2.staff = summarize(staff);
    report.v2.services = summarize(services);
    report.v2.categories = summarize(categories);

    const staffList = listOf(staff.body);
    const serviceList = listOf(services.body);
    const categoryList = listOf(categories.body);
    report.v2.services.summary = {
      count: serviceList.length,
      services_per_provider: countBy(serviceList, (item) => (Array.isArray(item?.provider_ids) ? item.provider_ids : [])),
      visibility_counts: visibilityCounts(serviceList)
    };
    report.v2.categories.summary = { count: categoryList.length, visibility_counts: visibilityCounts(categoryList) };

    const account = findAccountId(tokenData, staffList[0], serviceList[0]);
    report.v2.account_id_source = account.source;
    const windows = [studioWeekAfter(now(), 0), studioWeekAfter(now(), 1)];
    const staffIds = staffList
      .map((item) => item?.id ?? item?.key)
      .filter((id) => typeof id === 'string' && SAFE_ID.test(id))
      .slice(0, 3);

    const slotResults = [];
    report.v2.slots_by_staff = [];
    for (const providerId of staffIds) {
      const entry = { provider_id: providerId, windows: [] };
      for (const window of windows) {
        const query = {
          provider_id: providerId,
          duration: 60,
          start_at: window.startAt,
          end_at: window.endAt,
          timezone: STUDIO_TIMEZONE,
          slot_limit: 5
        };
        if (account.value !== undefined) query.account_id = account.value;
        const result = await getJson(fetch, `${V2_BASE}/slots`, query, auth);
        slotResults.push(result);
        entry.windows.push(summarizeSlotWindow(result, window));
        log.log(`v2 slots ${providerId} ${window.startAt}: ${result.status ?? result.error}`);
      }
      report.v2.slots_by_staff.push(entry);
    }

    // Bookings hold customer data: report status, count and type schema only.
    report.v2.bookings_by_staff = [];
    for (const providerId of staffIds) {
      const result = await getJson(
        fetch,
        `${V2_BASE}/bookings/staffs/${encodeURIComponent(providerId)}`,
        { start_at: windows[0].startAt, end_at: windows[0].endAt, limit: 5 },
        auth
      );
      const entry = { provider_id: providerId, url: result.url, status: result.status, ok: result.ok };
      if (result.error) entry.error = result.error;
      entry.count = listOf(result.body).length;
      entry.has_cursor = Boolean(result.body?.cursor);
      entry.schema = schemaOf(result.body);
      report.v2.bookings_by_staff.push(entry);
      log.log(`v2 bookings by staff ${providerId}: ${result.status ?? result.error}`);
    }

    for (const [name, result] of Object.entries({ staff, services, categories })) {
      log.log(`v2 ${name}: ${result.status ?? result.error}`);
    }
    v2ReadsOk = [staff, services, categories, ...slotResults].every((result) => result.ok) && slotResults.length > 0;
  }

  const v1Token = await getJson(fetch, V1_TOKEN_URL, { refreshToken });
  report.v1.token = summarize(v1Token);
  log.log(`v1 token: ${v1Token.status ?? v1Token.error}`);

  if (accessToken && v2ReadsOk) report.conclusion = 'v2_ok';
  else if (!accessToken && v1Token.ok) report.conclusion = 'v1_only';
  else if (accessToken) report.conclusion = 'v2_token_ok_reads_failed';
  else report.conclusion = 'neither';
  return report;
}

async function main() {
  try {
    const report = await runProbe({ env: process.env, fetch: globalThis.fetch });
    console.log(JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Setmore probe conclusion: **${report.conclusion}**\n`);
    }
  } catch (error) {
    // Print the error class only; messages could echo request details.
    console.error(`Probe failed unexpectedly: ${error?.name || 'Error'}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
