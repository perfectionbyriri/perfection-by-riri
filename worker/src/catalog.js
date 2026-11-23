// Catalog: merge the live Setmore catalog with services-meta.json
// (ARCHITECTURE §5, DESIGN_SPEC §6) and quote deposits on the server (§11).
//
// Setmore stays the source of truth for names, prices, durations and
// existence; meta is a whitelist plus presentation data. The merged catalog
// contains no PII, so it is cached in memory and in the Cache API, and a copy
// up to 24 h old is served with `stale: true` when Setmore fails.

import { BookingError } from './errors.js';

const CACHE_KEY = 'https://bff.internal/catalog/v1';
const STALE_LIMIT_SECONDS = 24 * 3600;
const DEFAULT_FOCAL = '50% 50%';
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function invalidMeta(reason) {
  return new BookingError('MISCONFIGURED', { message: `Invalid services-meta.json: ${reason}` });
}

function checkPhoto(photo, where) {
  const ok = photo && typeof photo === 'object'
    && typeof photo.src === 'string' && photo.src.startsWith('/images/')
    && Number.isInteger(photo.width) && photo.width > 0
    && Number.isInteger(photo.height) && photo.height > 0
    && typeof photo.alt === 'string' && photo.alt.trim() !== '' && photo.alt.length <= 120
    && (photo.focal === undefined || typeof photo.focal === 'string');
  if (!ok) throw invalidMeta(`photo of ${where}`);
}

// Mock mode serves the placeholder fixtures (worker/src/setmore/fixtures.js),
// so it reads each service's `mock_id` instead of the real Setmore id.
export function metaForMock(meta) {
  return {
    ...meta,
    services: meta.services.map((service) => (service.mock_id ? { ...service, service_id: service.mock_id } : service))
  };
}

export function validateMeta(meta) {
  if (!meta || meta.version !== 1) throw invalidMeta('unsupported version');
  if (!Array.isArray(meta.groups) || !Array.isArray(meta.services)) throw invalidMeta('groups and services must be arrays');

  const groupKeys = new Set();
  for (const group of meta.groups) {
    if (typeof group?.key !== 'string' || !KEBAB_RE.test(group.key)) throw invalidMeta('group key');
    if (groupKeys.has(group.key)) throw invalidMeta(`duplicate group ${group.key}`);
    groupKeys.add(group.key);
    if (typeof group.label !== 'string' || !group.label.trim() || group.label.length > 40) throw invalidMeta(`label of ${group.key}`);
    if (!Number.isInteger(group.order)) throw invalidMeta(`order of ${group.key}`);
    checkPhoto(group.photo, group.key);
  }

  const serviceIds = new Set();
  for (const service of meta.services) {
    const id = service?.service_id;
    if (typeof id !== 'string' || !id) throw invalidMeta('service_id');
    if (serviceIds.has(id)) throw invalidMeta(`duplicate service ${id}`);
    serviceIds.add(id);
    if (!groupKeys.has(service.group)) throw invalidMeta(`unknown group for ${id}`);
    if (!Number.isInteger(service.order)) throw invalidMeta(`order of ${id}`);
    if (!['standard', 'none'].includes(service.deposit)) throw invalidMeta(`deposit of ${id}`);
    if (service.display_name !== undefined && (typeof service.display_name !== 'string' || !service.display_name.trim())) {
      throw invalidMeta(`display_name of ${id}`);
    }
    if (service.blurb !== undefined && (typeof service.blurb !== 'string' || service.blurb.length > 120)) throw invalidMeta(`blurb of ${id}`);
    if (service.notice !== undefined && (typeof service.notice !== 'string' || !service.notice.trim())) throw invalidMeta(`notice of ${id}`);
    if (service.photo !== undefined && service.photo !== null) checkPhoto(service.photo, id);
  }
}

export function depositQuote(priceCents, rule, depositCents, feeBasisPoints) {
  if (rule !== 'standard' || priceCents <= depositCents) {
    return { required: false, deposit_cents: 0, fee_cents: 0, total_cents: 0, fee_basis_points: 0 };
  }
  const feeCents = Math.floor((depositCents * feeBasisPoints + 5000) / 10000);
  return {
    required: true,
    deposit_cents: depositCents,
    fee_cents: feeCents,
    total_cents: depositCents + feeCents,
    fee_basis_points: feeBasisPoints
  };
}

function publicPhoto(photo) {
  return { src: photo.src, width: photo.width, height: photo.height, alt: photo.alt, focal: photo.focal ?? DEFAULT_FOCAL };
}

export function mergeCatalog({ services, meta, providerId, depositCents, feeBasisPoints }) {
  const warnings = [];
  const byId = new Map(services.map((service) => [service.id, service]));
  const groups = [...meta.groups]
    .sort((a, b) => a.order - b.order)
    .map((group) => ({ key: group.key, label: group.label, photo: publicPhoto(group.photo), services: [], order: group.order }));
  const groupByKey = new Map(groups.map((group) => [group.key, group]));

  for (const entry of [...meta.services].sort((a, b) => a.order - b.order)) {
    const service = byId.get(entry.service_id);
    if (!service) {
      warnings.push({ code: 'meta_service_missing', service_id: entry.service_id });
      continue;
    }
    if (!Array.isArray(service.provider_ids) || !service.provider_ids.includes(providerId)) {
      warnings.push({ code: 'service_not_offered_by_provider', service_id: entry.service_id });
      continue;
    }
    const priceCents = Math.round(Number(service.cost) * 100);
    const durationMinutes = Number(service.duration);
    if (!Number.isFinite(priceCents) || priceCents < 0 || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      warnings.push({ code: 'setmore_service_invalid', service_id: entry.service_id });
      continue;
    }
    if (entry.deposit === 'standard' && priceCents <= depositCents) {
      warnings.push({ code: 'deposit_meta_overridden', service_id: entry.service_id });
    }
    const group = groupByKey.get(entry.group);
    group.services.push({
      service_id: entry.service_id,
      name: entry.display_name ?? service.title,
      blurb: entry.blurb ?? null,
      notice: entry.notice ?? null,
      duration_minutes: durationMinutes,
      price_cents: priceCents,
      photo: publicPhoto(entry.photo ?? group.photo),
      deposit: depositQuote(priceCents, entry.deposit, depositCents, feeBasisPoints)
    });
  }

  return {
    groups: groups.filter((group) => group.services.length > 0).map(({ order, ...group }) => group),
    warnings
  };
}

export function createCatalogService({ client, meta, config, cache = null, now = () => new Date(), log = () => {} }) {
  validateMeta(meta);
  const ttlMs = config.catalogTtlSeconds * 1000;
  let memory = null;
  let inflight = null;

  const isFresh = (entry) => entry && now().getTime() - entry.fetchedAt < ttlMs;
  const isUsable = (entry) => entry && now().getTime() - entry.fetchedAt < STALE_LIMIT_SECONDS * 1000;

  async function readShared() {
    if (!cache) return null;
    try {
      const response = await cache.match(CACHE_KEY);
      if (!response) return null;
      const entry = await response.json();
      return Array.isArray(entry?.groups) && typeof entry?.fetchedAt === 'number' ? entry : null;
    } catch {
      return null;
    }
  }

  async function writeShared(entry) {
    if (!cache) return;
    try {
      await cache.put(CACHE_KEY, new Response(JSON.stringify(entry), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${STALE_LIMIT_SECONDS}` }
      }));
    } catch {
      // A cache write failure only costs an extra upstream round later.
    }
  }

  async function refresh() {
    const [services, categories, staff] = await Promise.all([client.listServices(), client.listCategories(), client.listStaff()]);
    const { groups, warnings } = mergeCatalog({
      services, categories, staff, meta,
      providerId: config.setmoreProviderId,
      depositCents: config.depositAmountCents,
      feeBasisPoints: config.cardFeeBasisPoints
    });
    for (const { code, ...fields } of warnings) log(code, fields);
    const entry = { groups, fetchedAt: now().getTime() };
    memory = entry;
    await writeShared(entry);
    return entry;
  }

  async function getCatalog() {
    if (isFresh(memory)) return { groups: memory.groups, stale: false };
    const shared = await readShared();
    if (shared && (!memory || shared.fetchedAt > memory.fetchedAt)) memory = shared;
    if (isFresh(memory)) return { groups: memory.groups, stale: false };

    try {
      inflight ??= refresh().finally(() => { inflight = null; });
      const entry = await inflight;
      return { groups: entry.groups, stale: false };
    } catch (err) {
      if (isUsable(memory)) {
        log('catalog_served_stale', { reason: err?.name ?? 'error' });
        return { groups: memory.groups, stale: true };
      }
      throw err;
    }
  }

  async function getService(serviceId) {
    const { groups } = await getCatalog();
    for (const group of groups) {
      const service = group.services.find((item) => item.service_id === serviceId);
      if (service) return { ...service, group: group.key };
    }
    return null;
  }

  return { getCatalog, getService };
}
