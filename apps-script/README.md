# TimeBlock Reality Apps Script

This is the fallback/admin runtime for Calendar operations. The daily iPhone app now runs from GitHub Pages with direct Google Calendar OAuth; this Apps Script web app remains available for administrative utilities and recovery.

## Files

- `Code.gs`: Apps Script backend for Calendar read/write.
- `Index.html`: mobile-first web app UI.
- `appsscript.json`: manifest and Calendar scopes.

## Production URL

<https://script.google.com/macros/s/AKfycbzhzb2xT22srpiT_cN8zy8UaR7QKAvfOut_HRwXyt-Xur-3TsSPpiCo0Vk2kWvLN8lIag/exec>

## Deploy Status

Deployed with `clasp` under `saharat.unsaeng@gmail.com`.

Local deployment state is stored in `.clasp.json` and intentionally ignored by git.

## Manual Redeploy Fallback

1. Go to <https://script.google.com/>.
2. Open `TimeBlock Reality`.
3. Update `Code.gs`, `Index.html`, and `appsscript.json` from this folder.
4. Click `Deploy` -> `Manage deployments`.
5. Edit the Web App deployment.
6. Choose a new version.
7. Execute as: `Me`.
8. Who has access: `Only myself`.
9. Deploy and approve Calendar permissions if Google asks again.

## Required Google Calendars

- Plan source: `1 BD`, `2 SP`, `3 MM`, `4 RS`, `5 CM`, `6 FN`, `7 CT`, `8 LS`
- Actual target: `Actual-Time Log`
- Actual alias also supported: `Actual - Time Log`

## Runtime Behavior

- `End` writes directly to `Actual-Time Log`.
- `Sync Plan` reads the current week from the 8 LD8 calendars.
- `Fix` updates the existing actual event when possible.
- No recurring `Connect GCal` step is required in the web app.
