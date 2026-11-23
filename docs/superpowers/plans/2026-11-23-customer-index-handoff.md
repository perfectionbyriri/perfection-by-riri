# Handoff: fast customer resolution for `/book/` (background customer index)

Date: 2026-11-23. Written for a new session or model that has not seen the earlier conversation. Read this whole file before you change anything.

## 0. Ground rules (mandatory)

- Repo `perfectionbyriri/perfection-by-riri`, branch **`claude/dazzling-shannon-7jkxc1`**. Work and push only there. **Never merge or push to `main`**: a push to `main` deploys production through Cloudflare Workers Builds. Open a PR only when the owner asks.
- Follow `AGENTS.md`. Read the owner's private passport `perfectionbyriri/project-context` → `PROJECT_CONTEXT.md` and `context/site.md` first. Communicate with the owner in Russian. Only the owner edits the passport's open-tasks section.
- "Done" means evidence (command plus output, or a CI run ID) and an explicit list of what was not verified. Use the four sections of `.github/pull_request_template.md`.
- TDD: write a failing test, watch it fail, then implement. CI test command: `node --test tests/*.test.cjs tests/booking/*.test.mjs` (402 pass at `4f07612`).
- **The repo and its Actions logs are public.** Never print customer names, emails, phones, customer ids, booking ids or `consumer_ids`. Log only counts, timings and statuses.
- Secrets (Setmore token, Square, Cloudflare) never go into chat, Git or logs.

## 1. Problem

On the preview Worker, `POST /api/booking/appointments` for a no-deposit service took **59 s wall time with 120 ms CPU** (Cloudflare Workers observability, 2026-11-23). The client waited about a minute before "See you soon".

The same request logged `customer_identity_conflict`: the email and the phone matched two different Setmore customers, so duplicates already exist in Setmore.

## 2. Root cause

`worker/src/customers.js` → `createCustomerResolver({ client, kv, secret, maxPages = 20, log })` → `resolve({ firstName, lastName, email, phone })` works like this:

1. Looks up the KV keys `cust:e:<HMAC(email)>` and `cust:p:<HMAC(phone)>`. On a hit, it calls `GET /customers/{id}`.
2. On a miss, it runs a **sequential scan** of `GET /customers?limit=100` for up to 20 pages, hashing every contact and warming KV. It stops at the end of the first page with a match.
3. With no match, it creates the customer with `POST /customers`.

Setmore API v2 has no search by email or phone. A KV miss cannot distinguish "new customer" from "not indexed yet", so **every first-time client pays a full scan**, up to 20 sequential Setmore calls, each with a 7 s timeout plus 429 backoff. A fresh preview KV makes even returning clients pay the scan once. CPU is idle; the time is spent waiting on Setmore.

## 3. Chosen fix (recommended option A — confirm with the owner first)

The owner was offered three options and had not answered when this file was written:

- **A** (recommended): a background index kept warm by the cron.
- **B**: keep the scan and only show a waiting message.
- **C**: never search; always create the customer.

**Ask the owner in Russian before implementing A.** The trade-off to state: a customer added in Setmore by hand less than about 15 minutes earlier may be created again as a duplicate.

Design for A:

- **Request path (fast).** `resolve()` checks the KV email key, then the phone key, as today. If the index has completed at least one full pass (`cust:sync` → `complete_at` is set), a miss goes **straight to `POST /customers`**, with no scan. If the index has never completed, keep a small bounded scan as a fallback (`maxPages` default 3 instead of 20) so the first hours after a deploy do not create mass duplicates.
- **Background sync (cron, every 15 minutes, existing trigger).** Add `syncCustomerIndex({ client, kv, secret, pagesPerRun, now, log })`. It continues from the cursor stored in KV `cust:sync` = `{ cursor, pass_started_at, complete_at, pages_this_pass }` and pages `GET /customers?limit=100` for at most `pagesPerRun` pages (default 10). For every contact it writes the email and phone keys (reuse the existing `contactKeys` and `putIfChanged` logic, extracted into a shared helper). When the cursor ends (`cursor` null), it sets `complete_at = now`, clears the cursor and starts a new pass next run. On `SetmoreBusy` (429) or any upstream error it stops, keeps the cursor and logs `customer_sync_paused` with counts only. Use `cooldown: false` on `listCustomersPage`, as the scan does today.
- **Wiring.** In `worker/src/app.js` → `scheduled()`, run `syncCustomerIndex` after `reconcileStaleAuthorizations`, each in its own try/catch so one failure does not skip the other. Log `customer_sync_finished` with `{ pages, contacts, complete }`.
- **Config** (`worker/src/config.js`): `CUSTOMER_SYNC_PAGES_PER_RUN` (int, default 10). Reduce `CUSTOMER_SCAN_MAX_PAGES` default from 20 to 3; its meaning becomes "fallback scan before the first full pass". Document both in `docs/booking/ARCHITECTURE.md` §9 and §15 and in `.env.example`.
- **Preview cron.** `wrangler.jsonc` → `env.preview` now has `"triggers": { "crons": [] }`, set on purpose earlier. With option A, the preview needs the cron to warm its index: change it to `{ "crons": ["*/15 * * * *"] }` and update the test in `tests/booking/router.test.mjs` ("wrangler.jsonc preview env…") and `ARCHITECTURE.md` §15.1. The cron also runs reconcile, which on the preview only reads Setmore and uses mock payments; that is acceptable.

## 4. Steps

1. **Measure first (read-only).** Extend `worker/tools/setmore-verify.js` `runRead` to page through `GET /customers?limit=100` and log only `customers_pages=<n> customers_total=<n> avg_page_ms=<n> max_page_ms=<n>`. Never log contact fields. Test-first in `tests/booking/setmore-verify-run.test.mjs`: assert the counts line exists and that no contact field leaks.
   - Push, dispatch `setmore-verify.yml` with `mode=read` on the branch. Use the GitHub MCP `actions_run_trigger`, workflow id `427423574`.
   - Read the job log. If `get_job_logs` with `return_content` fails, use the signed `logs_url` and `curl` it into the scratchpad.
   - Record the numbers in `ARCHITECTURE.md` §9. They size `pagesPerRun` and prove the root cause.
2. **Extract the shared indexing helper** from `customers.js` (`indexContact(kv, secret, contact)`: hash emails and phones, `putIfChanged`). Existing customer tests must stay green.
3. **`syncCustomerIndex`**, test-first in `tests/booking/customers.test.mjs` with `createMemoryKV` from `tests/booking/helpers/fakes.mjs` and a fake client whose `listCustomersPage(cursor, limit, { cooldown })` returns `{ items, cursor }`. Cases:
   - resumes from the stored cursor;
   - stops after `pagesPerRun`;
   - sets `complete_at` when the cursor ends and restarts next run;
   - a 429 (`SetmoreBusy`) keeps the cursor;
   - writes keys for every contact;
   - logs no PII.
4. **Change `resolve()`**, test-first:
   - after a completed pass, a miss creates without listing any page (assert zero `listCustomersPage` calls);
   - before any completed pass, the scan is capped at `maxPages`;
   - a hit still verifies with `GET /customers/{id}` and drops stale keys on 404, as today.
5. **Wire the cron and config**, test-first in `tests/booking/router.test.mjs` and `tests/booking/config.test.mjs`. Then update the preview `triggers` as in §3.
6. **Docs:** `ARCHITECTURE.md` §9 (new algorithm and duplicate trade-off), §15 (new variables), §15.1 (preview cron).
7. **Run the full test suite. Dispatch `site-ci.yml` on the branch** (it runs only on PRs to `main` or by dispatch) and record the run ID.
8. **Deploy and verify on the preview.** A push to the branch triggers Cloudflare Workers Builds for `perfection-by-riri-preview` automatically (deploy command `npx wrangler deploy --env preview`). Check the latest deployment time with the Cloudflare API: `GET /accounts/2dd5ff6f68f776082417f16d8c8a300d/workers/scripts/perfection-by-riri-preview/deployments`.
   - After at least one cron run, check logs for `customer_sync_finished` via `POST /accounts/{id}/workers/observability/telemetry/query`, filtered on `$metadata.service = perfection-by-riri-preview`.
   - Then ask the owner to make one no-deposit test booking with a **new** contact and one with an **existing** contact. From the logs, report `wallTimeMs` of `POST /api/booking/appointments`; the target is under 10 s.
   - The owner deletes those test bookings in Setmore afterwards.

## 5. Environment facts the new session needs

- Cloudflare API calls go through a proxy that injects the account token. It **overwrites the `Authorization` header**, so `wrangler deploy` with assets cannot run from a session (the asset upload JWT is replaced, and the upload gets 401). Deploy only through Workers Builds, by pushing to the branch. Read-only API calls and secret writes work.
- The preview Worker `perfection-by-riri-preview` (`https://perfection-by-riri-preview.perfection-byriri.workers.dev`) sits behind Cloudflare Access (All traffic, account members), so a session cannot open its pages. Ask the owner to test in a browser, and use the Workers logs for timings.
- The preview has secrets `SETMORE_REFRESH_TOKEN` and `CUSTOMER_HASH_SECRET`, live Setmore, mock payments, and Turnstile test keys. **Bookings made there are real Setmore bookings without a deposit.**
- GitHub: use the MCP tools (`mcp__github__*`); the `gh` CLI is only for search. The workflow `setmore-verify.yml` (id `427423574`) has `mode=read` (GET only) and `mode=write`. Write mode makes one owner test booking, needs owner approval in the `setmore-write` environment, and the owner must say "go" in chat first.
- Workers runtime differences already found: `fetch` `redirect: 'error'` is rejected by workerd (fixed to `'manual'`), and Setmore reads `slot_limit` as the slot spacing in minutes (`SETMORE_SLOT_SPACING_MINUTES = 15` in `worker/src/setmore/client.js`). Test any new `fetch` or `Request` option against workerd behaviour; see `tests/booking/workerd-fetch.test.mjs`.

## 6. Still open from the previous session (tell the owner, do not do unasked)

- The owner should explicitly re-confirm the 17 Setmore title pairs in `TITLE_ALIASES` (`worker/tools/setmore-verify/checks.js`). The earlier answer was only "вроде бы да" ("I think yes").
- Deferred minor items:
  - the preview shares rate-limit `namespace_id` 1001/1002 with production;
  - `validateMeta` does not check `mock_id`;
  - the push trigger in `setmore-verify.yml` has no branch filter;
  - write mode may leave a "Riri Verification" customer in Setmore.
- Not verified:
  - how long the `/slots` lag lasts (the owner accepted the race for now);
  - whether `POST /bookings` rejects an already-taken slot;
  - how `slot_limit` behaves when omitted;
  - Access coverage of versioned preview URLs;
  - Square (configured last, by owner decision).
- After the owner merges to `main`: prepare the `project-context` passport update with confirmed facts only (PR, commits, run IDs), via a PR in `perfectionbyriri/project-context`.
