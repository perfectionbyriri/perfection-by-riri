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
