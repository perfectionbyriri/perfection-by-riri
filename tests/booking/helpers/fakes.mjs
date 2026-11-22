// Test-only fakes for Cloudflare bindings and time. Never imported by worker/src.

export function createClock(iso = '2026-11-22T20:00:00Z') {
  let current = new Date(iso).getTime();
  return {
    now: () => new Date(current),
    advance(ms) { current += ms; },
    set(nextIso) { current = new Date(nextIso).getTime(); }
  };
}

export function createMemoryKV() {
  const store = new Map();
  return {
    async get(key, type) {
      if (!store.has(key)) return null;
      const { value } = store.get(key);
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value, options = {}) {
      store.set(key, { value: typeof value === 'string' ? value : JSON.stringify(value), options });
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '' } = {}) {
      const keys = [...store.keys()].filter((name) => name.startsWith(prefix)).sort().map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
    entries() {
      return [...store.entries()].map(([key, { value, options }]) => ({ key, value, options }));
    }
  };
}

export function createMemoryCache(clock = { now: () => new Date() }) {
  const store = new Map();
  const keyOf = (request) => (typeof request === 'string' ? request : request.url);
  return {
    async match(request) {
      const entry = store.get(keyOf(request));
      if (!entry) return undefined;
      if (entry.expiresAt !== null && clock.now().getTime() >= entry.expiresAt) {
        store.delete(keyOf(request));
        return undefined;
      }
      return new Response(entry.body, { status: entry.status, headers: entry.headers });
    },
    async put(request, response) {
      const headers = Object.fromEntries(response.headers.entries());
      const maxAge = /max-age=(\d+)/.exec(headers['cache-control'] ?? '');
      store.set(keyOf(request), {
        body: await response.text(),
        status: response.status,
        headers,
        expiresAt: maxAge ? clock.now().getTime() + Number(maxAge[1]) * 1000 : null
      });
    },
    async delete(request) {
      return store.delete(keyOf(request));
    },
    keys() {
      return [...store.keys()];
    }
  };
}

// routes: { 'GET /path': handler | {status, body, headers} }, handler(url, init, call) → {status, body, headers} | Response
export function createFetchRecorder(routes = {}) {
  const calls = [];
  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const call = { method, url, path: url.pathname, init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const route = routes[`${method} ${url.pathname}`] ?? routes[url.pathname];
    if (!route) return Response.json({ errors: [{ code: 'not_found' }] }, { status: 404 });
    const result = typeof route === 'function' ? await route(url, init, call) : route;
    if (result instanceof Response) return result;
    if (result instanceof Error) throw result;
    const { status = 200, body = {}, headers = {} } = result;
    return Response.json(body, { status, headers });
  }
  return { fetch, calls };
}
