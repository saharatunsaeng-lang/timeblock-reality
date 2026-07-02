# TimeBlock Reality Apps Script

This is the stable runtime for the daily iPhone capture flow. It avoids frontend OAuth refresh problems by running Google Calendar operations server-side in Google Apps Script.

## Files

- `Code.gs`: Apps Script backend for Calendar read/write.
- `Index.html`: mobile-first web app UI.
- `appsscript.json`: manifest and Calendar scopes.

## Deploy Manually

1. Go to <https://script.google.com/>.
2. Create a new project named `TimeBlock Reality`.
3. Add `Code.gs` from this folder.
4. Add an HTML file named `Index` and paste `Index.html`.
5. Add/update the manifest with `appsscript.json`.
6. Click `Deploy` -> `New deployment`.
7. Select type `Web app`.
8. Execute as: `Me`.
9. Who has access: `Only myself`.
10. Deploy and approve Calendar permissions once.

## Required Google Calendars

- Plan source: `1 BD`, `2 SP`, `3 MM`, `4 RS`, `5 CM`, `6 FN`, `7 CT`, `8 LS`
- Actual target: `Actual-Time Log`
- Actual alias also supported: `Actual - Time Log`

## Runtime Behavior

- `End` writes directly to `Actual-Time Log`.
- `Sync Plan` reads the current week from the 8 LD8 calendars.
- `Fix` updates the existing actual event when possible.
- No recurring `Connect GCal` step is required in the web app.
