// MockSetmore: an in-memory fetch that speaks the Setmore API v2 routes the
// BFF uses (ARCHITECTURE §13). Everything above the fetcher (TokenManager,
// SetmoreClient, catalog, slots, appointments) runs unchanged against it.
//
// Scenario counters live in each fetch instance; customers and bookings live
// in `state`, which callers may share between instances.

import {
  MOCK_ACCOUNT_ID, MOCK_CATEGORIES, MOCK_HOURS, MOCK_NON_PROVIDER_ID, MOCK_PROVIDER_ID, MOCK_SERVICES, MOCK_STAFF
} from './fixtures.js';
import { addDays, formatRfc3339Local, instantToZonedParts, zonedDateTimeToInstant } from '../time.js';

export const MOCK_SCENARIOS = [
  'normal', 'slot_taken', 'slot_taken_on_create', 'rate_limited', 'rate_limited_once', 'token_expired',
  'unavailable', 'double_booked_after_create'
];

// Live Setmore spaces slot starts by `slot_limit` (minutes); the BFF sends 15.
const DEFAULT_SLOT_SPACING_MINUTES = 15;
const TOKEN_LIFETIME_SECONDS = 7200;

export function createMockState() {
  return { customers: new Map(), bookings: new Map(), sequence: 0 };
}

function nextId(state, prefix) {
  state.sequence += 1;
  return `${prefix}_mock_${String(state.sequence).padStart(6, '0')}`;
}

function reply(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const fail = (status, code, headers) => reply(status, { errors: [{ code }] }, headers);

function page(items, url) {
  const limit = Math.max(1, Number(url.searchParams.get('limit')) || 100);
  const offset = Math.max(0, Number(url.searchParams.get('cursor')) || 0);
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? String(offset + limit) : null;
  return reply(200, { data: slice, cursor: next });
}

function toMinutes(hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

function toHHMM(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function activeBookings(state, providerId) {
  return [...state.bookings.values()].filter((item) => item.provider_id === providerId && item.status !== 'CANCELLED');
}

function overlaps(state, providerId, start, end) {
  return activeBookings(state, providerId).some((item) => Date.parse(item.start_at) < end && start < Date.parse(item.end_at));
}

function generateDays(state, url, now, blocked) {
  const duration = Number(url.searchParams.get('duration'));
  const startAt = url.searchParams.get('start_at');
  const endAt = url.searchParams.get('end_at');
  const spacing = Number(url.searchParams.get('slot_limit')) > 0
    ? Number(url.searchParams.get('slot_limit'))
    : DEFAULT_SLOT_SPACING_MINUTES;
  if (!(duration > 0) || parseInstant(startAt) === null || parseInstant(endAt) === null) return null;

  const firstDate = startAt.slice(0, 10);
  const lastDate = endAt.slice(0, 10);
  const open = toMinutes(MOCK_HOURS.open);
  const close = toMinutes(MOCK_HOURS.close);
  const days = {};
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    days[date] = [];
    if (date === lastDate) break;
    const weekday = instantToZonedParts(zonedDateTimeToInstant(date, '12:00')).weekday;
    if (MOCK_HOURS.closedWeekdays.includes(weekday)) continue;
    for (let minute = open; minute + duration <= close; minute += spacing) {
      const start = zonedDateTimeToInstant(date, toHHMM(minute)).getTime();
      const end = start + duration * 60000;
      if (start < now().getTime() || blocked.has(start) || overlaps(state, MOCK_PROVIDER_ID, start, end)) continue;
      days[date].push({
        start_at: formatRfc3339Local(date, toHHMM(minute)),
        end_at: formatRfc3339Local(date, toHHMM(minute + duration))
      });
    }
  }
  return days;
}

function customerRecord(state, body, now) {
  const withIds = (list) => (Array.isArray(list) ? list : []).map((item) => ({ id: nextId(state, 'ref'), primary: false, ...item }));
  return {
    id: nextId(state, 'cus'),
    account_id: MOCK_ACCOUNT_ID,
    first_name: typeof body.first_name === 'string' ? body.first_name : '',
    last_name: typeof body.last_name === 'string' ? body.last_name : '',
    email_addresses: withIds(body.email_addresses),
    phone_numbers: withIds(body.phone_numbers),
    custom_fields: {},
    created_at: now().toISOString()
  };
}

function bookingRecord(state, body, service, now, consumerId = body.consumer_ids[0]) {
  return {
    id: nextId(state, 'bkg'),
    type: 'APPOINTMENT',
    calendar_id: 'cal_mock',
    account_id: MOCK_ACCOUNT_ID,
    provider_id: body.provider_id,
    consumer_ids: [consumerId],
    service_id: body.service_id,
    start_at: body.start_at,
    end_at: body.end_at,
    booking_id: nextId(state, 'ref'),
    cost: typeof body.cost === 'number' ? body.cost : service.cost,
    title: service.title,
    status: 'CONFIRMED',
    label: '',
    location: {},
    notes: typeof body.notes === 'string' ? body.notes : '',
    created_at: now().toISOString(),
    source: 'API',
    meta_data: { reminders: [], consumerTimezone: 'America/Los_Angeles', bookingId: '', tc: [] }
  };
}

export function createMockSetmoreFetch({
  scenario = 'normal',
  now = () => new Date(),
  rateLimitCount = 3,
  state = createMockState()
} = {}) {
  const counters = { rateLimited: new Map(), tokenExpired: false, slotCalls: 0 };
  const firstSlotStarts = new Set();

  async function handle(method, url, headers, readBody, active) {
    const path = url.pathname.replace(/^\/api\/v2/, '');

    if (active === 'unavailable') return fail(503, 'service_unavailable');

    if (path === '/o/oauth2/token' && method === 'GET') {
      if (!url.searchParams.get('refreshToken')) return fail(400, 'parameter_invalid');
      return reply(200, { data: { token: { access_token: `mock-access-${state.sequence}`, token_type: 'Bearer', expires_in: TOKEN_LIFETIME_SECONDS } } });
    }

    if (!/^Bearer \S+/.test(headers.get('Authorization') ?? '')) return fail(401, 'token_invalid');

    const limit = active === 'rate_limited' ? rateLimitCount : active === 'rate_limited_once' ? 1 : 0;
    // Each route has its own 429 budget, so concurrent calls fail alike.
    const limited = counters.rateLimited.get(path) ?? 0;
    if (limited < limit) {
      counters.rateLimited.set(path, limited + 1);
      return fail(429, 'rate_limited', { 'Retry-After': '1' });
    }
    if (active === 'token_expired' && !counters.tokenExpired) {
      counters.tokenExpired = true;
      return fail(401, 'token_expired');
    }

    if (method === 'GET' && path === '/services') return page(MOCK_SERVICES, url);
    if (method === 'GET' && path === '/categories') return page(MOCK_CATEGORIES, url);
    if (method === 'GET' && path === '/staff') return page(MOCK_STAFF, url);

    if (method === 'GET' && path === '/slots') {
      const providerId = url.searchParams.get('provider_id');
      if (providerId !== MOCK_PROVIDER_ID) {
        return fail(400, providerId === MOCK_NON_PROVIDER_ID ? 'staff_not_provider' : 'parameter_invalid');
      }
      counters.slotCalls += 1;
      const blocked = active === 'slot_taken' && counters.slotCalls > 1 ? firstSlotStarts : new Set();
      const days = generateDays(state, url, now, blocked);
      if (!days) return fail(400, 'parameter_invalid');
      if (active === 'slot_taken' && counters.slotCalls === 1) {
        for (const slot of Object.values(days).flat()) firstSlotStarts.add(Date.parse(slot.start_at));
      }
      return reply(200, { data: { days } });
    }

    if (method === 'GET' && path === '/customers') {
      return page([...state.customers.values()], url);
    }
    const customerMatch = /^\/customers\/([^/]+)$/.exec(path);
    if (method === 'GET' && customerMatch) {
      const customer = state.customers.get(decodeURIComponent(customerMatch[1]));
      return customer ? reply(200, { data: customer }) : fail(404, 'not_found');
    }
    if (method === 'POST' && path === '/customers') {
      const body = await readBody();
      if (!body || typeof body !== 'object') return fail(400, 'parameter_invalid');
      const customer = customerRecord(state, body, now);
      state.customers.set(customer.id, customer);
      return reply(201, { data: customer });
    }

    if (method === 'POST' && path === '/bookings') {
      const body = await readBody();
      const service = MOCK_SERVICES.find((item) => item.id === body?.service_id);
      const start = parseInstant(body?.start_at);
      const end = parseInstant(body?.end_at);
      if (!service || body.type !== 'APPOINTMENT' || body.provider_id !== MOCK_PROVIDER_ID || start === null || end === null || end <= start) {
        return fail(400, 'parameter_invalid');
      }
      if (!Array.isArray(body.consumer_ids) || body.consumer_ids.length !== 1) return fail(400, 'out_of_range');
      if (active === 'slot_taken_on_create' || overlaps(state, body.provider_id, start, end)) {
        return fail(400, 'resource_conflict');
      }
      const booking = bookingRecord(state, body, service, now);
      state.bookings.set(booking.id, booking);
      if (active === 'double_booked_after_create') {
        const other = bookingRecord(state, body, service, now, 'cus_mock_other');
        state.bookings.set(other.id, other);
      }
      return reply(201, { data: booking });
    }

    const staffBookings = /^\/bookings\/staffs\/([^/]+)$/.exec(path);
    if (method === 'GET' && staffBookings) {
      const from = parseInstant(url.searchParams.get('start_at'));
      const to = parseInstant(url.searchParams.get('end_at'));
      if (from === null || to === null) return fail(400, 'parameter_invalid');
      const staffId = decodeURIComponent(staffBookings[1]);
      const items = [...state.bookings.values()]
        .filter((item) => item.provider_id === staffId && Date.parse(item.start_at) >= from && Date.parse(item.start_at) < to)
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
      return page(items, url);
    }

    return fail(404, 'not_found');
  }

  return async function mockSetmoreFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers ?? request?.headers);
    const requested = headers.get('X-Mock-Scenario');
    const active = MOCK_SCENARIOS.includes(requested) ? requested : scenario;
    const readBody = async () => {
      try {
        if (init.body !== undefined) return JSON.parse(init.body);
        return request ? await request.json() : null;
      } catch {
        return null;
      }
    };
    return handle(method, url, headers, readBody, active);
  };
}
