// Setmore access-token manager (ARCHITECTURE §7).
//
// The permanent refresh token is exchanged for a short-lived access token
// (observed lifetime ~2 hours). Tokens are reused while more than
// `marginSeconds` remain, shared across isolates in one data centre through
// the Cache API, and refreshed by one in-flight request at a time.
// Errors never carry the refresh token, the URL or the provider response.

import { SetmoreUnavailable } from '../errors.js';

const CACHE_KEY = 'https://bff.internal/setmore-token';

export function createTokenManager({
  refreshToken,
  apiBase,
  fetch,
  now = () => new Date(),
  cache = null,
  marginSeconds = 60,
  timeoutMs = 7000
}) {
  let memory = null;
  let inflight = null;

  const fresh = (entry) => entry && entry.expiresAt - now().getTime() > marginSeconds * 1000;

  async function readShared() {
    if (!cache) return null;
    try {
      const response = await cache.match(CACHE_KEY);
      if (!response) return null;
      const entry = await response.json();
      return typeof entry?.token === 'string' && typeof entry?.expiresAt === 'number' ? entry : null;
    } catch {
      return null;
    }
  }

  async function writeShared(entry, expiresIn) {
    if (!cache) return;
    const maxAge = Math.max(1, Math.floor(expiresIn - marginSeconds));
    try {
      await cache.put(CACHE_KEY, new Response(JSON.stringify(entry), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${maxAge}` }
      }));
    } catch {
      // A cache write failure only costs an extra refresh later.
    }
  }

  async function refresh() {
    try {
      const url = new URL(`${apiBase}/o/oauth2/token`);
      url.searchParams.set('refreshToken', refreshToken);
      const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error('token refresh failed');
      const body = await response.json();
      const token = body?.data?.token;
      if (typeof token?.access_token !== 'string' || !token.access_token || !(token.expires_in > 0)) {
        throw new Error('token body invalid');
      }
      const entry = { token: token.access_token, expiresAt: now().getTime() + token.expires_in * 1000 };
      memory = entry;
      await writeShared(entry, token.expires_in);
      return entry.token;
    } catch {
      throw new SetmoreUnavailable();
    }
  }

  async function getToken() {
    if (fresh(memory)) return memory.token;
    if (inflight) return inflight;
    inflight = (async () => {
      const shared = await readShared();
      if (fresh(shared)) {
        memory = shared;
        return shared.token;
      }
      return refresh();
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  async function invalidate() {
    memory = null;
    if (cache) {
      try {
        await cache.delete(CACHE_KEY);
      } catch {
        // Ignore: the next refresh overwrites the entry.
      }
    }
  }

  return { getToken, invalidate };
}
