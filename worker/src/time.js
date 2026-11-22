// Studio time helpers (America/Los_Angeles by default).
//
// Built on Intl.DateTimeFormat only, so they run unchanged in Cloudflare
// Workers and Node. The approach mirrors the voice agent's proven
// pacificSlotTimestamp: try each offset the zone uses around a wall time and
// keep the instants that format back to that same wall time.

export const STUDIO_TIMEZONE = 'America/Los_Angeles';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOUR_MS = 3600000;

const formatterCache = new Map();
function formatter(tz, options) {
  const key = `${tz}|${JSON.stringify(options)}`;
  if (!formatterCache.has(key)) formatterCache.set(key, new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options }));
  return formatterCache.get(key);
}

function parseDate(dateISO) {
  const match = DATE_RE.exec(String(dateISO));
  if (!match) throw new RangeError('invalid_date');
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError('invalid_date');
  }
  return { year, month, day };
}

function parseTime(hhmm) {
  const match = TIME_RE.exec(String(hhmm));
  if (!match) throw new RangeError('invalid_time');
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function wallParts(instant, tz) {
  const parts = Object.fromEntries(
    formatter(tz, {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      weekday: 'long', hourCycle: 'h23'
    }).formatToParts(instant).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), weekday: parts.weekday
  };
}

function offsetMinutesAt(instant, tz) {
  const name = formatter(tz, { timeZoneName: 'longOffset' })
    .formatToParts(instant).find((part) => part.type === 'timeZoneName').value;
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!match || !match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

export function addDays(dateISO, days) {
  const { year, month, day } = parseDate(dateISO);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function zonedDateTimeToInstant(dateISO, hhmm, tz = STUDIO_TIMEZONE) {
  const { year, month, day } = parseDate(dateISO);
  const { hour, minute } = parseTime(hhmm);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([offsetMinutesAt(new Date(wall - 14 * HOUR_MS), tz), offsetMinutesAt(new Date(wall + 14 * HOUR_MS), tz)]);
  const matches = [];
  for (const offset of offsets) {
    const candidate = wall - offset * 60000;
    const parts = wallParts(new Date(candidate), tz);
    if (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) === wall) matches.push(candidate);
  }
  if (!matches.length) throw new RangeError('nonexistent_local_time');
  return new Date(Math.min(...matches));
}

export function offsetFor(instant, tz = STUDIO_TIMEZONE) {
  const minutes = offsetMinutesAt(instant, tz);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function formatRfc3339Local(dateISO, hhmm, tz = STUDIO_TIMEZONE) {
  const instant = zonedDateTimeToInstant(dateISO, hhmm, tz);
  return `${dateISO}T${hhmm}:00${offsetFor(instant, tz)}`;
}

export function instantToZonedParts(instant, tz = STUDIO_TIMEZONE) {
  const parts = wallParts(instant, tz);
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
    offset: offsetFor(instant, tz),
    weekday: parts.weekday
  };
}

export function studioToday(now, tz = STUDIO_TIMEZONE) {
  return instantToZonedParts(now, tz).date;
}

export function weekWindow(weekStartISO, tz = STUDIO_TIMEZONE) {
  return {
    startAt: formatRfc3339Local(weekStartISO, '00:00', tz),
    endAt: formatRfc3339Local(addDays(weekStartISO, 7), '00:00', tz)
  };
}

export function formatSlotLabel(instant, tz = STUDIO_TIMEZONE) {
  // ICU separates "PM" with a narrow no-break space; normalise to a plain space.
  return formatter(tz, { hour: 'numeric', minute: '2-digit', hour12: true }).format(instant).replace(/\s/g, ' ');
}
