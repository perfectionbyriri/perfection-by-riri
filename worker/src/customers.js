// Customer resolver without duplicates and without raw PII in KV
// (ARCHITECTURE §9).
//
// Setmore v2 has no customer search, so the BFF keeps an index in KV:
// `cust:e:<HMAC(email)>` and `cust:p:<HMAC(phone)>` → Setmore customer id.
// On a miss it runs a bounded scan of GET /customers that warms the index
// for every scanned contact. Match priority: email, then phone. Logs carry
// event names only, never contact details.

import { SetmoreBusy, SetmoreInvalidResponse, SetmoreNotFound } from './errors.js';

const PAGE_SIZE = 100;
const encoder = new TextEncoder();

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizePhoneUS(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export async function hmacKey(secret, kind, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return `cust:${kind}:${[...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function contactValues(list, scalar) {
  const values = Array.isArray(list) ? list.map((item) => item?.value) : [];
  if (typeof scalar === 'string') values.push(scalar);
  return values.filter((item) => typeof item === 'string' && item.trim() !== '');
}

export function createCustomerResolver({ client, kv, secret, maxPages = 20, log = () => {} }) {
  async function liveCustomer(key) {
    const id = await kv.get(key);
    if (!id) return null;
    try {
      await client.getCustomer(id);
      return id;
    } catch (err) {
      if (!(err instanceof SetmoreNotFound)) throw err;
      await kv.delete(key);
      return null;
    }
  }

  async function putIfChanged(key, id) {
    if ((await kv.get(key)) !== id) await kv.put(key, id);
  }

  async function putIfAbsent(key, id) {
    if (!(await kv.get(key))) await kv.put(key, id);
  }

  async function contactKeys(contact) {
    const emails = contactValues(contact.email_addresses, contact.email).map(normalizeEmail);
    const phones = contactValues(contact.phone_numbers, contact.phone).map(normalizePhoneUS).filter(Boolean);
    return {
      email: await Promise.all([...new Set(emails)].map((value) => hmacKey(secret, 'e', value))),
      phone: await Promise.all([...new Set(phones)].map((value) => hmacKey(secret, 'p', value)))
    };
  }

  async function scan(emailKey, phoneKey) {
    const warmed = new Set();
    let emailMatch = null;
    let phoneMatch = null;
    let cursor;
    for (let page = 0; page < maxPages; page += 1) {
      let result;
      try {
        result = await client.listCustomersPage(cursor, PAGE_SIZE, { cooldown: false });
      } catch (err) {
        if (!(err instanceof SetmoreBusy)) throw err;
        log('customer_scan_aborted', {});
        return { emailMatch, phoneMatch };
      }
      for (const contact of result.items) {
        if (typeof contact?.id !== 'string' || !contact.id) continue;
        const keys = await contactKeys(contact);
        for (const key of [...keys.email, ...keys.phone]) {
          if (warmed.has(key)) continue;
          warmed.add(key);
          await putIfChanged(key, contact.id);
        }
        if (!emailMatch && keys.email.includes(emailKey)) emailMatch = contact.id;
        if (!phoneMatch && phoneKey && keys.phone.includes(phoneKey)) phoneMatch = contact.id;
      }
      // Stop at the end of the first page with a match; email outranks phone within it.
      if (emailMatch || phoneMatch || !result.cursor) break;
      cursor = result.cursor;
    }
    return { emailMatch, phoneMatch };
  }

  async function resolve({ firstName, lastName, email, phone }) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhoneUS(phone);
    const emailKey = await hmacKey(secret, 'e', normalizedEmail);
    const phoneKey = normalizedPhone ? await hmacKey(secret, 'p', normalizedPhone) : null;

    const byEmail = await liveCustomer(emailKey);
    if (byEmail) {
      if (phoneKey) {
        const phoneId = await kv.get(phoneKey);
        if (!phoneId) await kv.put(phoneKey, byEmail);
        else if (phoneId !== byEmail) log('customer_identity_conflict', {});
      }
      return { customerId: byEmail, created: false };
    }

    const byPhone = phoneKey ? await liveCustomer(phoneKey) : null;
    if (byPhone) {
      await kv.put(emailKey, byPhone);
      return { customerId: byPhone, created: false };
    }

    const { emailMatch, phoneMatch } = await scan(emailKey, phoneKey);
    if (emailMatch && phoneMatch && emailMatch !== phoneMatch) log('customer_identity_conflict', {});
    const found = emailMatch ?? phoneMatch;
    if (found) {
      await putIfAbsent(emailKey, found);
      if (phoneKey) await putIfAbsent(phoneKey, found);
      return { customerId: found, created: false };
    }

    const created = await client.createCustomer({
      first_name: firstName,
      last_name: lastName,
      email_addresses: [{ value: normalizedEmail, primary: true }],
      phone_numbers: normalizedPhone ? [{ value: normalizedPhone, primary: true }] : []
    });
    if (typeof created?.id !== 'string' || !created.id) throw new SetmoreInvalidResponse();
    await kv.put(emailKey, created.id);
    if (phoneKey) await kv.put(phoneKey, created.id);
    return { customerId: created.id, created: true };
  }

  return { resolve };
}
