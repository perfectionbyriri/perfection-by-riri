// Setmore API v2 HTTP client (ARCHITECTURE §12.1).
//
// Retry policy:
//   - GET: up to 2 retries on 429, 5xx, timeout or network error, with
//     400 ms / 1200 ms backoff (±20% jitter) or Retry-After (capped at 3 s).
//   - POST: never retried, except once after 401 (the request was not
//     processed). A POST timeout, network error or 5xx is an UNKNOWN outcome
//     and is reported as SetmoreUnavailable; callers must not assume failure.
//   - 401 on any call: invalidate the token, refresh once, retry once.
//   - After a final 429 the client refuses calls for `cooldownSeconds`
//     (unless the caller passes `cooldown: false`).

import {
  SetmoreAuthError, SetmoreBusy, SetmoreConflict, SetmoreInvalidResponse, SetmoreNotFound,
  SetmoreRejected, SetmoreUnavailable
} from '../errors.js';

const BACKOFF_MS = [400, 1200];
const MAX_RETRY_AFTER_MS = 3000;
const MAX_PAGES = 10;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response) {
  const value = response.headers.get('Retry-After');
  if (!value || !/^\d+$/.test(value.trim())) return null;
  return Math.min(Number(value.trim()) * 1000, MAX_RETRY_AFTER_MS);
}

async function errorCode(response) {
  try {
    const body = await response.json();
    return typeof body?.errors?.[0]?.code === 'string' ? body.errors[0].code : null;
  } catch {
    return null;
  }
}

export function createSetmoreClient({
  apiBase,
  tokenManager,
  fetch,
  sleep = defaultSleep,
  random = Math.random,
  now = () => new Date(),
  cooldownSeconds = 10,
  timeoutMs = 7000
}) {
  let cooldownUntil = 0;

  function backoff(retryIndex, response) {
    const fromHeader = response ? retryAfterMs(response) : null;
    if (fromHeader !== null) return fromHeader;
    return Math.round(BACKOFF_MS[retryIndex] * (0.8 + 0.4 * random()));
  }

  async function request(method, path, { query, body, cooldown = true } = {}) {
    const remaining = cooldownUntil - now().getTime();
    if (remaining > 0) throw new SetmoreBusy(Math.ceil(remaining / 1000));

    const isGet = method === 'GET';
    const url = new URL(`${apiBase}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }

    let authRetried = false;
    let retries = 0;
    for (;;) {
      const token = await tokenManager.getToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      let response;
      try {
        response = await fetch(url, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch {
        if (isGet && retries < BACKOFF_MS.length) {
          await sleep(backoff(retries));
          retries += 1;
          continue;
        }
        throw new SetmoreUnavailable();
      }

      // `redirect: 'manual'` (workerd rejects 'error'): an unexpected redirect is an upstream fault.
      if (response.status >= 300 && response.status < 400) throw new SetmoreUnavailable();

      if (response.status === 401) {
        if (authRetried) throw new SetmoreAuthError();
        authRetried = true;
        await tokenManager.invalidate();
        continue;
      }

      if (response.status === 429) {
        if (isGet && retries < BACKOFF_MS.length) {
          await sleep(backoff(retries, response));
          retries += 1;
          continue;
        }
        if (cooldown) cooldownUntil = now().getTime() + cooldownSeconds * 1000;
        const header = retryAfterMs(response);
        throw new SetmoreBusy(header !== null ? Math.ceil(header / 1000) : cooldownSeconds);
      }

      if (response.status >= 500) {
        if (isGet && retries < BACKOFF_MS.length) {
          await sleep(backoff(retries));
          retries += 1;
          continue;
        }
        throw new SetmoreUnavailable();
      }

      if (response.status === 404) throw new SetmoreNotFound();

      if (response.status >= 400) {
        const code = await errorCode(response);
        if (response.status === 409 || code === 'resource_conflict') throw new SetmoreConflict();
        throw new SetmoreRejected(code ?? `http_${response.status}`);
      }

      try {
        return await response.json();
      } catch {
        throw new SetmoreInvalidResponse();
      }
    }
  }

  async function listAll(path, query = {}) {
    const items = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await request('GET', path, { query: { ...query, cursor } });
      if (!Array.isArray(body?.data)) throw new SetmoreInvalidResponse();
      items.push(...body.data);
      if (!body.cursor) return items;
      cursor = body.cursor;
    }
    // Never serve a silently truncated list.
    throw new SetmoreUnavailable();
  }

  function dataOf(body) {
    if (body?.data === undefined || body.data === null) throw new SetmoreInvalidResponse();
    return body.data;
  }

  return {
    request,
    listAll,
    listServices: () => listAll('/services'),
    listCategories: () => listAll('/categories'),
    listStaff: () => listAll('/staff'),

    // Setmore treats slot_limit as the spacing between starts in minutes: 5 gave a 5-minute grid
    // (run 44990258119), 100 a 100-minute grid (run 45122471180). 15 matches the booking page.
    async getSlots({ accountId, providerId, duration, startAt, endAt, timezone, slotLimit = 15 }) {
      const body = await request('GET', '/slots', {
        query: {
          account_id: accountId, provider_id: providerId, duration, start_at: startAt, end_at: endAt,
          timezone, slot_limit: slotLimit, double_booking: false
        }
      });
      const days = body?.data?.days;
      if (!days || typeof days !== 'object' || Array.isArray(days)) throw new SetmoreInvalidResponse();
      return days;
    },

    async getCustomer(id) {
      return dataOf(await request('GET', `/customers/${encodeURIComponent(id)}`));
    },

    // `cooldown: false` lets the bounded customer scan give up on a 429 without
    // blocking the customer and booking POSTs that follow (ARCHITECTURE §9 step 4).
    async listCustomersPage(cursor, limit = 100, { cooldown = true } = {}) {
      const body = await request('GET', '/customers', { query: { cursor, limit }, cooldown });
      if (!Array.isArray(body?.data)) throw new SetmoreInvalidResponse();
      return { items: body.data, cursor: body.cursor || null };
    },

    async createCustomer(customer) {
      return dataOf(await request('POST', '/customers', { body: customer }));
    },

    async createBooking(booking) {
      return dataOf(await request('POST', '/bookings', { body: booking }));
    },

    listBookingsByStaff({ staffId, startAt, endAt }) {
      return listAll(`/bookings/staffs/${encodeURIComponent(staffId)}`, { start_at: startAt, end_at: endAt, limit: 100 });
    }
  };
}
