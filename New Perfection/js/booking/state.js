// Booking flow state and deep links (docs/booking/DESIGN_SPEC.md §3).

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
  if (link.serviceId && groups.some((group) => group.services.some((service) => service.service_id === link.serviceId))) {
    return { step: 2, serviceId: link.serviceId, group: null, error: null };
  }
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
