# Claude Code Handoff - TimeBlock Reality

Date: 2026-07-06
Repo: `saharatunsaeng-lang/timeblock-reality`
Local path: `/Users/saharatunsaeng/Documents/Codex/2026-07-01/google-calendar-plan-time-blocking-1-2`
Branch: `main`
Latest commit: `f48a3da Make capture local first`

## Goal

TimeBlock Reality is a mobile-first Google Apps Script app for LD8 time blocking:

- `Plan`: read weekly plan blocks from 8 Google Calendars named `1 BD` to `8 LS`.
- `Actual`: capture real time blocks into `Actual-Time Log`.
- Review: compare plan vs actual, weekly drift, habit signals, and copy weekly memory handoff.

The current product focus is no longer adding analytics. The immediate priority is real-world capture speed and reliability on iPhone.

## Production Runtime

Primary production app is Google Apps Script Web App, not the legacy GitHub Pages frontend.

Production URL:
`https://script.google.com/macros/s/AKfycbzhzb2xT22srpiT_cN8zy8UaR7QKAvfOut_HRwXyt-Xur-3TsSPpiCo0Vk2kWvLN8lIag/exec`

Apps Script project in `.clasp.json`:
`18eClTwNLqTHYUj8w6haSHMdOvtTysS9E_xzQ2KGbYIneQGJlvOJW0ztY`

Current deployed version after last change:

- Apps Script version: `65`
- Deployment: `@66`

Deploy command pattern:

```bash
npx --yes @google/clasp push --force
npx --yes @google/clasp version "description"
npx --yes @google/clasp deploy --deploymentId AKfycbzhzb2xT22srpiT_cN8zy8UaR7QKAvfOut_HRwXyt-Xur-3TsSPpiCo0Vk2kWvLN8lIag --description "description"
```

## Important Files

- `apps-script/Code.gs`: Apps Script backend for Google Calendar read/write.
- `apps-script/Index.html`: production frontend UI and local-first capture logic.
- `apps-script/appsscript.json`: Apps Script manifest and Calendar scope.
- `apps-script/README.md`: runtime notes and required calendar names.
- `design-one-thumb-detail.html`: earlier detailed UI design baseline.
- `design-variants.html`: earlier UI variants.

## Current Calendar Contract

Required calendars:

- Plan calendars: `1 BD`, `2 SP`, `3 MM`, `4 RS`, `5 CM`, `6 FN`, `7 CT`, `8 LS`
- Actual calendar: `Actual-Time Log`
- Alias supported: `Actual - Time Log`

LD8 ids:

- `bd`: `1 BD`
- `sp`: `2 SP`
- `mm`: `3 MM`
- `rs`: `4 RS`
- `cm`: `5 CM`
- `fn`: `6 FN`
- `ct`: `7 CT`
- `ls`: `8 LS`

## Completed Phases

MVP phases are complete:

1. Core Capture + GCal sync
2. Plan vs Actual calendar structure
3. Daily Review
4. Weekly Analysis
5. Habit Signals
6. App stability / resume state
7. Second Brain handoff via copyable weekly markdown

Recent reliability work:

- `4e17bfc Lock capture while syncing`
- `dea7804 Add sync timeout recovery`
- `f48a3da Make capture local first`

## Latest Behavior

The app was changed from "wait for GCal first" to "local-first capture":

- Opening app uses cached local state immediately when possible.
- `End` updates UI/local state immediately.
- Domain switch updates UI/local state immediately.
- GCal writes run in a background queue.
- Sync calls have a 25 second timeout.
- Backend uses `blockId` lookup to avoid duplicate events if a client times out and retries.
- During `Checking...`, capture buttons should no longer be blocked if usable local state exists.

Last verified from Chrome after deploy:

- Active block appeared in about `3.7s` in the desktop Chrome check.
- `End` and domain buttons were not disabled during `Checking...`.
- Final status became `Ready`.
- No browser error logs.

Do not assume this means iPhone is fully fixed. User reported iPhone felt slow at around 7 seconds open and 8 seconds switching before this local-first change. Needs real iPhone validation next.

## Known Data Issue

A prior bug created a bad actual event:

- Calendar: `Actual-Time Log`
- Date: `2026-07-04`
- Domain: `7 CT`
- Event id: `mj8p4luu4iqkufgci1lvn3alp0@google.com`
- Current wrong time: `10:20:00 - 23:01:59` Asia/Bangkok
- Suggested correction: `10:20 - 11:55` Asia/Bangkok

Do not silently mutate this event unless Saharat explicitly confirms. It is user data.

## Useful Audit Endpoint

`Code.gs` supports a read-only audit mode for actual events:

```text
?mode=audit&categoryId=ct&day=20260704&fromMin=570&toMin=690
```

Notes:

- Use compact day format `YYYYMMDD`; Chrome tooling previously blocked URLs with ISO timestamps or dashed dates in this context.
- The endpoint renders HTML with a nested iframe under Apps Script. In browser tooling, read `iframe -> iframe -> body`.

## Verification Checklist

Before reporting a fix:

1. Run syntax check:

```bash
perl -0777 -ne 'print $1 if m{<script>(.*)</script>}s' apps-script/Index.html > /tmp/timeblock-current-index.js
node --check /tmp/timeblock-current-index.js
git diff --check
```

2. Deploy to the existing Apps Script deployment URL.
3. Open production with a cache-bust query.
4. Verify:

- App reaches `Ready`.
- No browser console errors.
- Capture buttons are not stuck disabled.
- Do not click `Start`, `End`, or domain switch unless explicitly testing a live calendar write.

## Next Recommended Work

1. iPhone pilot validation

- Ask user to test open speed and switch speed after `f48a3da`.
- Confirm whether UI now changes instantly and only the status chip waits for GCal.

2. Add visible pending sync queue indicator

- Current UI says `syncing` in active meta and chip.
- Consider a small non-blocking indicator like `Syncing 2` or `Saved`.
- Keep it quiet. Do not reintroduce blocking UI.

3. Add recovery for unsynced local blocks

- On app open, find local actual blocks without `googleEventId`.
- Show a small `Retry unsynced` state or auto-queue them.
- Backend is now idempotent by `blockId`, so retry is safer.

4. Optional: fix the old `7 CT` bad event only after explicit user confirmation.

## User Preferences

- Speak Thai to the user.
- Keep answers short and actionable.
- The user prefers execution over long options.
- Do not over-add features. This app succeeds or fails on low-friction capture.
- Production deploy is acceptable here because this app has been iterated directly as the active Apps Script production runtime.

## Cautions

- Do not revert user data or Calendar events without confirmation.
- Do not assume desktop Chrome speed equals iPhone speed.
- Do not bring back "wait for GCal" blocking for capture. The user explicitly finds 7-8 seconds too slow.
- Keep calendar writes idempotent. Preserve `blockId` retry behavior.
