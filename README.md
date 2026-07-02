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

The first version is local-device first. It stores blocks in browser storage, creates Google Calendar event links for actual blocks, and exports a weekly Markdown review for secondbrain notes.

## Google Calendar integration

OAuth client:

- `809951458535-dg6gjp5nk4fjrgs1kngrger4cni90er9.apps.googleusercontent.com`

Required Google Calendar names:

- Plan source: `1 BD`, `2 SP`, `3 MM`, `4 RS`, `5 CM`, `6 FN`, `7 CT`, `8 LS`
- Actual source: `Actual-Time Log`
- Supported actual alias: `Actual - Time Log`
- Optional plan marker aliases: `Plan-Week`, `Plan - Week`

Expected Google Cloud setup:

- Google Calendar API enabled.
- OAuth web client authorized JavaScript origin: `https://saharatunsaeng-lang.github.io`.
- Optional local dev origin: `http://localhost:4173`.

Runtime behavior:

- `Connect GCal` requests access in the browser.
- `Sync Plan` imports the current week from the 8 LD8 calendars.
- New actual blocks are written to `Actual-Time Log` when connected.
- Access tokens stay in browser memory; calendar IDs are stored locally.

## Current scope

- Quick actual capture.
- Switch capture: tapping another LD8 ends the current actual block and starts the new one.
- Fix last block.
- Visible GCal sync status and retry sync for the last actual block.
- Manual plan blocks.
- Today view for plan vs actual.
- Weekly category delta.
- Markdown export.
- GitHub Pages deployment.
- Google Calendar OAuth connect.
- Plan calendar sync.
- Actual event write.

## Next phase

- Push weekly review into the secondbrain memory app.
- Read actual history back from `Actual-Time Log`.
- Add stronger duplicate protection for repeated syncs.
