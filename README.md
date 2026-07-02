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

The recommended runtime is now the Google Apps Script web app in `apps-script/`. GitHub Pages was useful for the first prototype, but frontend-only OAuth is not stable enough for daily iPhone capture.

## Runtime

- Recommended: Google Apps Script Web App.
- Legacy prototype: GitHub Pages frontend OAuth.

Production web app:

- <https://script.google.com/macros/s/AKfycbzhzb2xT22srpiT_cN8zy8UaR7QKAvfOut_HRwXyt-Xur-3TsSPpiCo0Vk2kWvLN8lIag/exec>

Required Google Calendar names:

- Plan source: `1 BD`, `2 SP`, `3 MM`, `4 RS`, `5 CM`, `6 FN`, `7 CT`, `8 LS`
- Actual source: `Actual-Time Log`
- Supported actual alias: `Actual - Time Log`
- Optional plan marker aliases: `Plan-Week`, `Plan - Week`

Runtime behavior:

- Apps Script is authorized once with the user's Google account.
- `Sync Plan` imports the current week from the 8 LD8 calendars.
- New actual blocks are written server-side to `Actual-Time Log`.
- No recurring `Connect GCal` step is needed in normal use.

## Current scope

- Quick actual capture.
- Switch capture: tapping another LD8 ends the current actual block and starts the new one.
- Fix last block.
- Visible GCal sync status and retry sync for the last actual block.
- Manual plan blocks.
- Today view for plan vs actual.
- Weekly category delta.
- Apps Script Calendar sync.

## Next phase

- Push weekly review into the secondbrain memory app.
- Read actual history back from `Actual-Time Log`.
- Add stronger duplicate protection for repeated syncs.
