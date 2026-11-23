# Setmore live verification for `/book/` — design

Date: 2026-11-23. Status: draft for owner approval. Scope: booking only. Square stays in mock mode until the final stage.

## 1. Intent

The owner wants `/book/` to work against the real Setmore account precisely:

- it shows only the times that are free in Setmore right now;
- it never lets a client book a slot that is already taken.

Square payments are configured last (owner, 2026-11-23). Until then the deposit step runs in mock mode, outside production.

## 2. Current state (verified 2026-11-23)

- The BFF code exists on branch `claude/dazzling-shannon-7jkxc1` (not merged; merging to `main` deploys to production through Workers Builds). Availability comes from Setmore `GET /slots` with `double_booking=false`; slots are cached 30 s; `POST /api/booking/appointments` re-checks the slot twice with the cache bypassed and runs an overlap post-check (`docs/booking/ARCHITECTURE.md` §6, §8).
- `worker/config/services-meta.json` holds **placeholder ids** for all 43 services (`svc_lip_blushing`, …). Against the real account the catalog would be empty, because every entry would log `meta_service_missing`.
- Cloudflare Worker `perfection-by-riri` exists and has **no secrets** (read-only Cloudflare API check, 2026-11-23). No Worker is connected to Setmore yet.
- Earlier read-only probe runs (44989221725, 44990258119) verified the token, account id, provider id, the `/slots` shape and the bookings-by-staff endpoint. They did not record real service ids (logs deleted) and did not test writes.

## 3. Goals

1. Real Setmore service ids, names, durations, prices and buffers in `services-meta.json`, mapped to the 43 whitelisted services with no silent gaps.
2. Proof that `/slots` never returns a start that overlaps an existing non-cancelled booking (including its buffers).
3. Proof that a booking created through the API removes that slot at once, and that a second booking attempt on the same slot is refused by the BFF.
4. Known required fields for `POST /customers` and `POST /bookings`, and confirmed duplicate-free customer resolution.
5. Known behaviour of Setmore notifications for API-created bookings (V3) and whether our own marker survives on the booking (V6).
6. A preview deployment where the owner can walk through `/book/` with the real schedule, without touching production.

## 4. Non-goals

- Square production keys and real payments (final stage, separate design).
- Merging to `main` or any production deploy.
- Changing salon hours, services or prices in Setmore.

## 5. Anti-goals (failure even if it "works")

- A real client's booking deleted or changed by a test.
- Client names, emails or phones in public Actions logs, artifacts, Git or chat. The repository is public.
- A Setmore token in this chat, in Git, or in any session container.
- A public preview URL that lets strangers create real Setmore bookings without a deposit.
- Free-looking slots that Setmore would actually reject or double-book.

## 6. Approaches (owner picked A on 2026-11-23)

| Approach | Trade-off |
|---|---|
| **A. Verify in GitHub Actions first, then a preview Worker** (picked) | Two stages, but each Setmore fact is proven alone before the UI depends on it. |
| B. Preview Worker straight away | Faster, but a failure could come from Setmore, the catalog or the UI and is harder to pin down. |
| C. Run locally in a session with the owner's token | Rejected: the token would pass through the chat or container. |

## 7. Design

### Stage 1 — Setmore verification in GitHub Actions

A new manual workflow `setmore-verify.yml` runs a new tool `worker/tools/setmore-verify.js`. The tool uses the **production code path**: `createTokenManager` + `createSetmoreClient` from `worker/src/setmore/`, so the checks exercise the same client the Worker will use. The existing `setmore-probe.yml` stays as it is.

Inputs: `mode` = `read` (default) or `write`. Secrets: `SETMORE_REFRESH_TOKEN` (existing name); in `write` mode also `SETMORE_TEST_EMAIL` and `SETMORE_TEST_PHONE` (the owner's own contact). Contact values never appear as workflow inputs, because inputs are public.

**`mode=read`** (GET only):

1. Catalog map. Read `/services`; match each `services-meta.json` entry to a Setmore service by normalised `title`. Placeholder ids were derived from the public service names, so the match key is the name. Output a JSON artifact `setmore-catalog-map.json` with, per entry: placeholder id, Setmore id, title, duration, cost, `buffer{before,after}`, `provider_ids`, `visibility`. Service data is public business information; no customer data is read. Unmatched meta entries and unlisted Setmore services are listed explicitly; the run fails if any whitelisted entry is unmatched or ambiguous.
2. Slot overlap check. For the next 4 studio weeks and every distinct (duration, buffer) pair in the catalog, call `/slots` exactly as `worker/src/slots.js` does, and list bookings with `GET /bookings/staffs/{provider}` for the same window. Assert that no returned start overlaps any booking interval that blocks time. Also assert that every start lies inside the studio's hours. Run once with `working_hours=false` (today's BFF value) and once with `true`, and report the difference. The log prints only counts, dates, times and booking `status`/`type` values, with no ids, titles or consumer fields.
3. Buffer check. Report whether `/slots` honours service buffers when only `duration` is passed. If it does not, Stage 1 also changes `worker/src/slots.js` to request `duration + buffer.before + buffer.after` and to offset the start by `buffer.before`. That change is test-first, with unit tests from the measured behaviour.

**`mode=write`** (owner approval each run; a GitHub environment `setmore-write` with the owner as required reviewer gates the job):

1. Pick the first free 15-minute-grid slot for the shortest whitelisted service, at least 14 days ahead, so a real client is unlikely to be looking at it.
2. Resolve the customer the way `worker/src/customers.js` does (bounded scan, then `POST /customers`), with an in-memory KV. Record the required fields from the response and errors. A customer record cannot be removed by this tool; with the owner's own contact the scan normally finds the existing record, and at worst one owner contact is added.
3. `POST /bookings` with the BFF's body, including a test note and our marker in `label`/`meta_data` (V6).
4. Re-read `/slots`: the slot must be gone. Run the BFF's fresh check for that slot: it must report `SLOT_TAKEN`.
5. Read the booking back by staff: confirm the fields and whether the marker survived.
6. `DELETE /bookings/{id}` in a `finally` block (the endpoint is named in ARCHITECTURE §20 V3 but not yet exercised; if Setmore rejects it, the run stops and the owner deletes the booking in Setmore by hand), then re-read `/slots` to confirm the slot is free again. If the delete fails, the job fails loudly and the summary gives the booking time so the owner can remove it in Setmore by hand.
7. The owner checks the inbox of `SETMORE_TEST_EMAIL` for a Setmore notification (V3) and reports it.

The log prints statuses, field names, counts and the booking time only. No names, emails, phones or customer ids.

Output of Stage 1: a PR that writes real ids into `services-meta.json` (plus the buffer fix if needed), updates `ARCHITECTURE.md` §6, §9, §17 and §20 (V2, V3, V6, O4) with run IDs, and passes all tests.

### Stage 2 — preview Worker

- A new Wrangler environment `preview` in `wrangler.jsonc`: Worker name `perfection-by-riri-preview`, its own KV namespace, `ENVIRONMENT=preview`, `SETMORE_MOCK_MODE=false`, `PAYMENTS_MOCK_MODE=true`, `ALLOWED_ORIGINS` = the preview hostname, Turnstile test keys, no cron (the reconciliation cron is not needed with mock payments). The production environment does not change.
- Secrets on the preview Worker only: `SETMORE_REFRESH_TOKEN`, `CUSTOMER_HASH_SECRET`.
- Access: the preview hostname sits behind Cloudflare Access with a one-email policy (the owner's), so strangers cannot create real bookings.
- The owner walks through `/book/` with the real schedule. Every test booking is deleted afterwards in Setmore.

## 8. Owner actions

1. Confirm `SETMORE_REFRESH_TOKEN` is present in GitHub → Settings → Secrets and variables → Actions (add it again if it was removed after the earlier probe).
2. For `mode=write`: add secrets `SETMORE_TEST_EMAIL` and `SETMORE_TEST_PHONE` (your own contact); create the GitHub environment `setmore-write` (Settings → Environments) with yourself as required reviewer; approve each write run.
3. Stage 2: see open question Q1.

## 9. Open questions for the owner

- **Q1. How the preview Worker gets its Setmore token.** (a) A manual GitHub workflow deploys the preview and sets the secret from GitHub Secrets; it needs a Cloudflare API token stored as a GitHub secret. (b) The session deploys the preview code through the connected Cloudflare account, and the owner pastes the Setmore token into the Cloudflare dashboard for the preview Worker. Builder's pick: (b), because there is one fewer long-lived credential in GitHub and the token never passes through the session.

## 10. Calls made by the designer (owner may override)

- Name-based matching for the catalog map; ambiguity fails the run, so no guess is applied silently.
- 4-week window for the overlap check; test booking at least 14 days ahead, shortest service.
- The `DELETE /bookings/{id}` call lives only in the verification tool, not in the BFF client used by the site.
- No cron on the preview.

## 11. Left to the builder

Tool module layout, artifact formatting, the test fakes, and the exact wording of the job summary.
