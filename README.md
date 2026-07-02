# TimeBlock Reality

Mobile-first companion for a two-calendar time blocking workflow:

- `Plan - Week` for the intended week.
- `Actual - Time Log` for what actually happened.
- LD8 code as the main time-block type.

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

- `Plan - Week`
- `Actual - Time Log`

Expected Google Cloud setup:

- Google Calendar API enabled.
- OAuth web client authorized JavaScript origin: `https://saharatunsaeng-lang.github.io`.
- Optional local dev origin: `http://localhost:4173`.

Runtime behavior:

- `Connect GCal` requests access in the browser.
- `Sync Plan` imports the current week from `Plan - Week`.
- New actual blocks are written to `Actual - Time Log` when connected.
- Access tokens stay in browser memory; calendar IDs are stored locally.

## Current scope

- Quick actual capture.
- Manual plan blocks.
- Today view for plan vs actual.
- Weekly category delta.
- Markdown export.
- GitHub Pages deployment.
- Google Calendar OAuth connect.
- Plan calendar sync.
- Actual event write.

## Next phase

- Google Calendar OAuth.
- Read `Plan - Week` and `Actual - Time Log` directly.
- Write actual blocks directly to the selected actual calendar.
- Push weekly review into the secondbrain memory app.
