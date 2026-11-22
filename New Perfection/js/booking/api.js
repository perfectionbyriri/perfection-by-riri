// Booking API client for /api/booking/* (docs/booking/ARCHITECTURE.md §14).
//
// Every call resolves to { ok: true, data } or { ok: false, status, error },
// where `error` is the server's { code, message, ... } object. A network
// failure or a reply that is not JSON becomes the NETWORK error below. It
// never rejects, so callers only branch on `ok`.

const BASE = '/api/booking';

const NETWORK_ERROR = {
  code: 'NETWORK',
  message: 'We could not reach the booking calendar. Please check your connection and try again, or call (425) 845 0045.',
  retry_after_seconds: null,
  fallback_phone: '+14258450045'
};

export function createApi({ fetch = (...args) => globalThis.fetch(...args) } = {}) {
  async function call(url, init) {
    let response;
    let body;
    try {
      response = await fetch(url, init);
      body = await response.json();
    } catch {
      return { ok: false, status: response ? response.status : 0, error: NETWORK_ERROR };
    }
    if (response.ok) return { ok: true, status: response.status, data: body };
    const error = body && typeof body.error === 'object' && body.error ? body.error : NETWORK_ERROR;
    const result = { ok: false, status: response.status, error };
    // Keep extra fields (for example refreshed_week on 409 SLOT_TAKEN).
    if (body && Object.keys(body).some((key) => key !== 'error')) result.data = body;
    return result;
  }

  return {
    fetchCatalog() {
      return call(`${BASE}/catalog`, { headers: { Accept: 'application/json' } });
    },

    fetchWeek(serviceId, weekStart) {
      const query = new URLSearchParams({ service_id: serviceId });
      if (weekStart) query.set('week_start', weekStart);
      return call(`${BASE}/slots?${query}`, { headers: { Accept: 'application/json' } });
    },

    createAppointment(body) {
      return call(`${BASE}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
      });
    }
  };
}
