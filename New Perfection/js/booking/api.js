// Booking API client for /api/booking/* (docs/booking/ARCHITECTURE.md §14).
//
// Every call resolves to { ok: true, data } or { ok: false, status, error },
// where `error` is the server's { code, message, ... } object. A network
// failure becomes the NETWORK error below; an error reply that is not JSON
// becomes SERVER_ERROR. It never rejects, so callers only branch on `ok`.

const BASE = '/api/booking';

const NETWORK_ERROR = {
  code: 'NETWORK',
  message: 'We could not reach the booking calendar. Please check your connection and try again, or call (425) 845 0045.',
  retry_after_seconds: null,
  fallback_phone: '+14258450045'
};

const SERVER_ERROR = {
  code: 'SERVER_ERROR',
  message: 'Something went wrong on our side. Please try again in a moment, or call (425) 845 0045.',
  retry_after_seconds: null,
  fallback_phone: '+14258450045'
};

export function createApi({ fetch = (...args) => globalThis.fetch(...args) } = {}) {
  async function call(url, init) {
    let response;
    let body;
    try {
      response = await fetch(url, init);
    } catch {
      return { ok: false, status: 0, error: NETWORK_ERROR };
    }
    try {
      body = await response.json();
    } catch {
      // The server answered, but not with the booking API's JSON (a platform
      // error page): not a connection problem.
      return { ok: false, status: response.status, error: response.ok ? NETWORK_ERROR : SERVER_ERROR };
    }
    if (response.ok) return { ok: true, status: response.status, data: body };
    const error = body && typeof body.error === 'object' && body.error ? body.error : SERVER_ERROR;
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
