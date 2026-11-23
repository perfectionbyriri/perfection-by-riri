// Booking flow state and deep links (docs/booking/DESIGN_SPEC.md §3).

import { formatMoney } from './checkout.js';
import { formatDuration } from './render-services.js';

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export function createState(initial = {}) {
  let value = { ...initial };
  const listeners = new Set();
  return {
    get: () => value,
    set(patch) {
      value = { ...value, ...patch };
      for (const listener of listeners) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

// `/book/?service=<id>` or `/book/?group=<key>`; anything malformed is ignored.
export function parseDeepLink(search) {
  const params = new URLSearchParams(search || '');
  const serviceId = params.get('service');
  if (serviceId && ID_RE.test(serviceId)) return { serviceId };
  const group = params.get('group');
  if (group && ID_RE.test(group)) return { group };
  return {};
}

// A known service opens step 2. An unknown service or group quietly falls
// back to step 1: an old link must never show an error.
export function resolveDeepLink(link, catalog) {
  const groups = catalog?.groups ?? [];
  const linked = link.serviceId
    ? groups.flatMap((group) => group.services).find((service) => service.service_id === link.serviceId)
    : null;
  // A service with a notice stays on step 1: the client must see and confirm it first.
  if (linked) return { step: linked.notice ? 1 : 2, serviceId: link.serviceId, group: null, error: null };
  const group = link.group && groups.some((item) => item.key === link.group) ? link.group : null;
  return { step: 1, serviceId: null, group, error: null };
}

// Browser back and forward (docs/booking/DESIGN_SPEC.md §5.6). Each step pushes
// `{ step }` onto history. On popstate the step comes back from there, clamped
// to the furthest step whose data still exists, and the form values are handed
// back untouched: going back never drops what the client typed. Step 5 (the
// confirmation) is never restored: it is replaced in history, not pushed.
export function stepFromHistory(historyState, current = {}) {
  const wanted = Number.isInteger(historyState?.step) && historyState.step >= 1 && historyState.step <= 4
    ? historyState.step
    : 1;
  let step = wanted;
  if (step >= 2 && !current.serviceId) step = 1;
  const chosen = current.catalog?.groups?.flatMap((group) => group.services).find((service) => service.service_id === current.serviceId);
  if (step >= 2 && continueBlocked({ service: chosen, faqAcknowledged: current.faqAcknowledged })) step = 1;
  if (step >= 3 && !current.startAt) step = 2;
  if (step >= 4 && !hasDetails(current.details)) step = 3;
  return { step, details: current.details ?? {} };
}

function hasDetails(details) {
  return Boolean(details && details.first_name && details.last_name && details.email && details.phone);
}

// One line for the sticky bar: `Classic full set · Thu 27, 1:00 PM`.
export function summaryLine({ service, week, startAt, startLabel } = {}) {
  if (!service) return '';
  const day = startAt ? week?.days?.find((item) => startAt.startsWith(item.date)) : null;
  if (!day || !startLabel) return service.name;
  const date = new Date(`${day.date}T12:00:00Z`);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${service.name} · ${weekday} ${date.getUTCDate()}, ${startLabel}`;
}

const NOT_CHOSEN = 'Not chosen yet';

// Three columns of the live selection ribbon (Variant C §5.2). Plain text; callers use textContent.
export function ribbonValues({ service, week, startAt, startLabel } = {}) {
  const values = {
    service: { title: NOT_CHOSEN, sub: '' },
    time: { title: NOT_CHOSEN, sub: '' },
    deposit: { title: '\u2014', sub: '' }
  };
  if (!service) return values;
  values.service = { title: service.name, sub: `${formatDuration(service.duration_minutes)} \u00b7 ${formatMoney(service.price_cents)}` };
  values.deposit = service.deposit?.required
    ? { title: formatMoney(service.deposit.total_cents), sub: 'Deposit \u00b7 balance at the studio' }
    : { title: formatMoney(0), sub: 'No deposit needed' };
  const day = startAt ? week?.days?.find((item) => startAt.startsWith(item.date)) : null;
  if (day && startLabel) {
    const monthDay = new Date(`${day.date}T12:00:00Z`)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
      .replace(' ', '\u00a0');
    values.time = { title: `${day.weekday}, ${monthDay}`, sub: `${startLabel} Pacific Time` };
  }
  return values;
}

// A service that carries a notice (the Lip Blushing FAQ) cannot continue until
// the client has confirmed it.
export function continueBlocked({ service, faqAcknowledged } = {}) {
  return Boolean(service?.notice) && !faqAcknowledged;
}
