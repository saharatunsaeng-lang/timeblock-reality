# TimeBlock Reality

Mobile-first companion for an LD8 calendar time blocking workflow:

- Plan source: the 8 LD8 Google Calendars.
- Actual source: `Actual-Time Log`.
- LD8 code as the main capture type.

## LD8 Domains

- `1 BD - Body & Diet`
- `2 SP - Spiritual & Purpose`
- `3 MM - Mind & Memory`
- `4 RS - Relationships & Social`
- `5 CM - Career & Money`
- `6 FN - Finance & Numbers`
- `7 CT - Contribute`
- `8 LS - Lifestyle`

The recommended runtime is now the GitHub Pages frontend with direct Google Calendar OAuth. The frontend is a standalone PWA, so it does not show the Apps Script banner and does not depend on a hidden iframe bridge.

## Runtime

- Recommended: GitHub Pages frontend + direct Google Calendar API.
- Fallback/admin utility: Google Apps Script Web App. `apps-script/Index.html` is frozen (emergency fallback only) - ship UI changes to this root `index.html`. `apps-script/Code.gs` stays active as the Calendar backend for admin and recovery utilities; the daily app does not depend on Apps Script Execution API setup.

GitHub Pages app:

- <https://saharatunsaeng-lang.github.io/timeblock-reality/>

Production web app:

- <https://script.google.com/macros/s/AKfycbzhzb2xT22srpiT_cN8zy8UaR7QKAvfOut_HRwXyt-Xur-3TsSPpiCo0Vk2kWvLN8lIag/exec>

Required Google Calendar names:

- Plan source: `1 BD`, `2 SP`, `3 MM`, `4 RS`, `5 CM`, `6 FN`, `7 CT`, `8 LS`
- Actual source: `Actual-Time Log`
- Supported actual alias: `Actual - Time Log`
- Optional plan marker aliases: `Plan-Week`, `Plan - Week`

Runtime behavior:

- Google Calendar is authorized on demand from the More tab; it is never loaded during app startup.
- Actual capture is local-first and never waits for Google. Pending blocks sync to `Actual-Time Log` after authorization.
- `Sync Plan` imports the current week from the 8 LD8 calendars.
- New actual blocks are written server-side to `Actual-Time Log`.
- No `Connect GCal` step is needed for normal Start/End capture.
- A 30-minute focus check-in appears in Capture for every active block. Optional browser alerts require a user tap to grant notification permission and are most reliable while the PWA remains active; fully backgrounded iPhone alerts require a push service and are intentionally out of scope.

## Current scope

- Quick actual capture.
- Switch capture: tapping another LD8 ends the current actual block and starts the new one.
- Fix last block.
- Visible GCal sync status and retry sync for the last actual block.
- Manual plan blocks.
- Today view for plan vs actual.
- Weekly category delta.
- 30-minute focus signal with optional device alerts.
- Apps Script Calendar sync.

## Sync reliability

- Google token silently refreshes on app resume and on 401 (no manual reconnect needed for a normal expiry).
- Actual-block sync is idempotent: before creating an event it looks up an existing one by `blockId` (extendedProperties), so a lost response never creates a duplicate GCal event.
- Blocks under 60 seconds are discarded instead of padded to 5 minutes, so a mis-tap never writes fake data to `Actual-Time Log`.
- An active block older than 6 hours (device died / forgot to end) is auto-closed to a 30-minute placeholder on next bootstrap and flagged for a manual fix, instead of being resurrected as still-running.
- Bootstrap reads the last 14 days of `Actual-Time Log` (not just the current week), so a fresh device or a cleared cache recovers recent history from GCal instead of starting blank. Local `state.actual` is pruned to the same 14-day window for synced blocks (anything still pending sync is kept regardless of age) to keep localStorage from growing unbounded.

## Next phase

- Push weekly review into the secondbrain memory app.
- Read actual history back from `Actual-Time Log`.
