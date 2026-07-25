# TimeBlock Reality - Agent Handoff

Date: 2026-07-25
Repo: `saharatunsaeng-lang/timeblock-reality`
Local path: `/Users/saharatunsaeng/Developer/timeblock-reality`
Branch: `main`

## Goal

Mobile-first LD8 time blocking companion:

- `Plan`: weekly plan blocks read from 8 Google Calendars named `1 BD` to `8 LS`.
- `Actual`: real time blocks captured into `Actual-Time Log`.
- Review: plan vs actual, weekly drift, habit signals, weekly memory handoff.

The product bet is low-friction capture. Do not add features that slow down
Start/Switch/End, and never reintroduce "wait for GCal" blocking on capture.

## Architecture

- **Primary runtime**: root `index.html` - a standalone PWA on GitHub Pages using
  direct Google Calendar OAuth (Google Identity Services token client).
  <https://saharatunsaeng-lang.github.io/timeblock-reality/>
- **`apps-script/Index.html` is FROZEN** - an emergency fallback UI only. Ship all
  UI work to the root `index.html`. `apps-script/Code.gs` stays active as the
  Calendar backend, for `?mode=audit` / `?mode=duplicate-ld8` admin utilities, and
  for `buildWeeklyMemoryPayload()` (invoked via `clasp run`).
- **`push-worker/` + `push-config.js`**: Cloudflare Worker delivering the 30-minute
  check-in as a real push notification. In-app `setTimeout` is the fallback when
  push is unavailable (iOS suspends timers for backgrounded PWAs).
- **`calendar-worker/`**: Cloudflare Worker holding Google OAuth for server-side
  calendar reads. `provision-production.sh` reads the client secret from the
  terminal only - it is never committed.
- **`hermes/google_calendar.py`**: connector used by scripts (e.g. the quality gate)
  to read `Actual-Time Log` without a browser.
- **`scripts/audit_actual_time_log.py`**: read-only quality gate. Capacity learning
  may only start when it reports `learningReady: true`.

## Deploying

GitHub Pages serves `origin/main` directly, so **a commit alone changes nothing for
the live app - it must be pushed.**

Git auth on this Mac has two GitHub accounts in `gh`. Pushing to this repo requires
`saharatunsaeng-lang` to be the active one (`pwbfitness` gets a 403). Check with:

```bash
gh auth status
gh api user --jq .login   # must print saharatunsaeng-lang
gh auth switch --user saharatunsaeng-lang   # if it does not
```

Whenever `index.html` or `sw.js` changes, bump the cache version in `sw.js`,
`manifest.webmanifest`, and the two `?v=` query strings in `index.html`, or the
service worker keeps serving the old bundle to returning users. This is easy to
forget and it silently hides the change - it was hit during the 2026-07-25 session.

Apps Script deploy (fallback runtime only):

```bash
npx --yes @google/clasp push --force
npx --yes @google/clasp version "description"
npx --yes @google/clasp deploy --deploymentId AKfycbzhzb2xT22srpiT_cN8zy8UaR7QKAvfOut_HRwXyt-Xur-3TsSPpiCo0Vk2kWvLN8lIag --description "description"
```

## Session 2026-07-25 - capture correctness audit

Reviewed the live app and found four real defects, all fixed and verified in a
browser (seeded state, driven through the real UI, asserted against `localStorage`):

1. **Editing a block moved it to today.** `buildBlockFromForm()` always used
   `todayDateKey()`, so opening `Fix` on an older block and pressing Save with no
   edits rewrote it to today and queued that over the real Google Calendar event.
   The most common trigger was the stale-active-block guard, which tells the user
   to "fix the time in Last block" for a block that started yesterday.
   Fixed by threading the block's own day through as `baseDay`.
2. **Blocks crossing midnight collapsed to 30 minutes.** With start and end forced
   onto the same day, `23:00 -> 01:00` hit the `end <= start` branch and was
   silently saved as 30 minutes. Now interpreted as spanning midnight (`end + 1 day`).
3. **One bad block froze the whole sync queue.** `drainPersistentSyncBlock` stopped
   at the first failure with no retry limit, so a permanently failing block (for
   example one whose Calendar event had been deleted by hand, making PATCH 404
   forever) stopped every later capture from ever syncing. Fixed on two levels:
   `writeActualEvent()` recreates an event that returns 404/410 instead of failing
   forever, and the drain now counts attempts per task and rotates a repeatedly
   failing task behind newer work after `maxSyncAttempts`.
4. **`silentReconnectInFlight` was in the temporal dead zone.** It was declared far
   below `init()`, which calls `silentReconnectGoogle()` during startup, so every
   returning user who had connected Google hit `Cannot access ... before
   initialization` on open - showing a red "Issue" chip and, worse, meaning the
   silent Google reconnect had never actually run since it was written. Declaration
   moved up with the other module-level state.

Also in that session: the status chip no longer reports "Ready" while work is
queued (`applyIdleSyncChip()` reports `Syncing` / `Pending` / `Offline` / `Ready`),
`getLastActualBlock()` picks the newest block by start time instead of by array
position (the bootstrap merge and stale auto-close append out of order), the `Last`
card and edit sheet show the date when a block is not from today, and the dead
`updateActualBlock` / `updateDirectActualBlock` path was removed.

## Verification approach

There is no test suite - this is a static HTML/JS app. What works:

- Extract the inline `<script>` and run `node --check` after every edit round.
- Serve the folder (`python3 -m http.server`) and drive the real UI in a browser,
  seeding `localStorage` for the case under test and asserting on stored state.
- **Unregister the service worker and clear caches before re-testing**, otherwise
  the old bundle is served and the fix appears not to work.
- Google-OAuth paths cannot be exercised without credentials; stub `runServer` or
  `gcalFetch` to simulate 404/500 and queue behaviour instead.

## Calendar contract

- Plan calendars: `1 BD` Body & Diet, `2 SP` Spiritual & Purpose, `3 MM` Mind &
  Memory, `4 RS` Relationships & Social, `5 CM` Career & Money, `6 FN` Finance &
  Numbers, `7 CT` Contribute, `8 LS` Lifestyle.
- Actual calendar: `Actual-Time Log` (alias `Actual - Time Log`).
- Internal ids: `bd`, `sp`, `mm`, `rs`, `cm`, `fn`, `ct`, `ls`.

## Open work

- Weekly memory push into the secondbrain vault is still manual. `Code.gs` has
  `buildWeeklyMemoryPayload()` returning a payload shaped for ld8-quick-notes'
  `POST /api/notes` (`domainId: "3 MM"`, `memoryType: "signal"`), and the manifest
  already declares `executionApi`. It needs the account-level "Google Apps Script
  API" toggle at <https://script.google.com/home/usersettings> to be ON before
  `clasp run buildWeeklyMemoryPayload` works, then a small wrapper script to POST
  the result. Do not put this behind a LaunchAgent - on-demand only.
- A known bad historical event exists in `Actual-Time Log` on 2026-07-04 (`7 CT`,
  event `mj8p4luu4iqkufgci1lvn3alp0@google.com`, `10:20-23:01` instead of
  `10:20-11:55`). Do not mutate it without explicit confirmation - it is user data.

## Cautions

- Speak Thai to the user. Keep answers short and actionable; prefer executing over
  presenting option menus, but stop and ask on genuine architecture decisions or
  external blockers.
- Do not revert user data or Calendar events without confirmation.
- Keep calendar writes idempotent - preserve the `blockId` extendedProperty lookup
  and the 404 recreate path.
- Desktop Chrome speed is not iPhone speed.
