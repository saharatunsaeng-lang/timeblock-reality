const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const PLAN_CALENDARS = ["1 BD", "2 SP", "3 MM", "4 RS", "5 CM", "6 FN", "7 CT", "8 LS"];
const ACTUAL_CALENDARS = ["Actual-Time Log", "Actual - Time Log"];
const STATE_TTL_MS = 10 * 60 * 1000;
const CONFIRMATION_TTL_MS = 30 * 60 * 1000;
// Written so a block started from the Watch is indistinguishable from one the app
// wrote: same titles, same private properties, same placeholder length.
const LD8 = [
  { id: "bd", code: "1 BD" },
  { id: "sp", code: "2 SP" },
  { id: "mm", code: "3 MM" },
  { id: "rs", code: "4 RS" },
  { id: "cm", code: "5 CM" },
  { id: "fn", code: "6 FN" },
  { id: "ct", code: "7 CT" },
  { id: "ls", code: "8 LS" },
];
const ACTIVE_PLACEHOLDER_MINUTES = 360;
const MIN_BLOCK_MS = 60 * 1000;
const PWA_ORIGIN = "https://saharatunsaeng-lang.github.io";
const PAIRING_TTL_MS = 15 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.CALENDAR_CREDENTIAL.idFromName("primary");
    const credential = env.CALENDAR_CREDENTIAL.get(id);

    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    if (request.method === "GET" && url.pathname === "/oauth/start") {
      return credential.fetch(withInternalPath(request, "/oauth/start"));
    }
    if (request.method === "GET" && url.pathname === "/oauth/callback") {
      return credential.fetch(withInternalPath(request, "/oauth/callback"));
    }
    if (url.pathname.startsWith("/app/")) {
      if (request.method === "OPTIONS") return appCors(new Response(null, { status: 204 }));
      return appCors(await credential.fetch(withInternalPath(request, url.pathname)));
    }
    if (!url.pathname.startsWith("/v1/")) return json({ error: "Not found" }, 404);
    if (!isAuthorized(request, env)) return json({ error: "Unauthorized" }, 401);
    return credential.fetch(withInternalPath(request, url.pathname));
  },
};

export class CalendarCredential {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/oauth/start") return this.startOAuth(request);
    if (request.method === "GET" && url.pathname === "/oauth/callback") return this.completeOAuth(request);
    if (request.method === "GET" && url.pathname === "/v1/status") return this.status();
    if (request.method === "GET" && url.pathname === "/v1/calendars") return this.calendars();
    if (request.method === "GET" && url.pathname === "/v1/events") return this.events(url);
    if (request.method === "POST" && url.pathname === "/v1/preview-copy") return this.previewCopy(request);
    if (request.method === "POST" && url.pathname === "/v1/confirm-copy") return this.confirmCopy(request);
    if (request.method === "POST" && url.pathname === "/v1/delete-exact-duplicate") return this.deleteExactDuplicate(request);
    if (request.method === "POST" && url.pathname === "/v1/start-block") return this.startBlock(request);
    // Shortcuts on watchOS is strict about URLs: a space needs encoding and a field
    // mixing text with a variable arrives as rich text. This form has neither, so it
    // can be typed straight into the action.
    if (url.pathname.startsWith("/v1/s/")) return this.startBlock(request, url.pathname.slice(6));
    if (request.method === "GET" && url.pathname === "/v1/running") return this.running();
    if (request.method === "POST" && url.pathname === "/v1/create-pairing") return this.createPairing();
    if (request.method === "POST" && url.pathname === "/app/pair") return this.pair(request);
    if (request.method === "POST" && url.pathname === "/app/start-block") {
      if (!(await this.validPwaToken(request))) return json({ error: "Pair this device first" }, 401);
      return this.startBlock(request);
    }
    if (request.method === "GET" && url.pathname === "/app/bootstrap") return this.appBootstrap(request);
    return json({ error: "Not found" }, 404);
  }

  async startOAuth(request) {
    const origin = request.headers.get("x-calendar-public-origin") || new URL(request.url).origin;
    const state = randomId();
    const verifier = randomVerifier();
    await this.state.storage.put(`oauth:${state}`, {
      verifier,
      redirectUri: `${origin}/oauth/callback`,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    const params = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${origin}/oauth/callback`,
      response_type: "code",
      scope: CALENDAR_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: await sha256Base64Url(verifier),
      code_challenge_method: "S256",
    });
    return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
  }

  async completeOAuth(request) {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) return oauthPage("Google Calendar was not connected", `Google returned: ${escapeHtml(error)}`, 400);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!state || !code) return oauthPage("Google Calendar was not connected", "Missing authorization response.", 400);

    const pending = await this.state.storage.get(`oauth:${state}`);
    await this.state.storage.delete(`oauth:${state}`);
    if (!pending || pending.expiresAt < Date.now()) return oauthPage("This connection link expired", "Open a new connection link from Hermes.", 400);

    const body = new URLSearchParams({
      code,
      client_id: this.env.GOOGLE_CLIENT_ID,
      client_secret: this.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: pending.redirectUri,
      grant_type: "authorization_code",
      code_verifier: pending.verifier,
    });
    const response = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const token = await response.json();
    if (!response.ok || !token.refresh_token) return oauthPage("Google Calendar was not connected", "Google did not return an offline credential. Open a new connection link and allow access.", 400);
    await this.storeToken(token);
    return oauthPage("Google Calendar connected", "You can return to Discord. Hermes can now read your calendars and prepare previews.");
  }

  async status() {
    const token = await this.loadToken();
    return json({ connected: Boolean(token?.refresh_token) });
  }

  async calendars() {
    const data = await this.google("/users/me/calendarList?minAccessRole=reader");
    const items = (data.items || []).map((item) => ({ id: item.id, summary: item.summary, accessRole: item.accessRole }));
    const plan = PLAN_CALENDARS.map((summary) => ({ summary, found: items.some((item) => item.summary === summary) }));
    return json({ calendars: items, plan, actual: items.find((item) => ["Actual-Time Log", "Actual - Time Log"].includes(item.summary)) || null });
  }

  async events(url) {
    const source = validDateKey(url.searchParams.get("start"));
    const end = validDateKey(url.searchParams.get("end"));
    if (!source || !end || source >= end) return json({ error: "Use start and end as YYYY-MM-DD." }, 400);
    const requested = url.searchParams.getAll("calendar");
    const calendars = await this.readableCalendarMap();
    const names = requested.length ? requested : PLAN_CALENDARS;
    const result = [];
    for (const name of names) {
      const calendar = calendars.get(name);
      if (!calendar) {
        result.push({ calendar: name, found: false, events: [] });
        continue;
      }
      const events = await this.listEvents(calendar.id, source, end);
      result.push({ calendar: name, found: true, events: events.map(publicEvent) });
    }
    return json({ start: source, end, calendars: result });
  }

  async deleteExactDuplicate(request) {
    const body = await readJson(request);
    const calendarName = typeof body.calendar === "string" ? body.calendar : "";
    const start = validDateKey(body.start);
    const end = validDateKey(body.end);
    if (!PLAN_CALENDARS.includes(calendarName) || !start || !end || start >= end || !body.event) {
      return json({ error: "calendar, start, end, and event are required." }, 400);
    }
    const calendar = (await this.planCalendarMap()).get(calendarName);
    if (!calendar) return json({ error: `Calendar not found: ${calendarName}` }, 404);
    const key = eventKey(body.event);
    const matches = (await this.listEvents(calendar.id, start, end)).filter((event) => eventKey(event) === key);
    if (matches.length !== 2) {
      return json({ error: "Deletion requires exactly two identical events.", matches: matches.map(publicEvent) }, 409);
    }
    const duplicate = matches[1];
    await this.google(`/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(duplicate.id)}`, { method: "DELETE" });
    const remaining = (await this.listEvents(calendar.id, start, end)).filter((event) => eventKey(event) === key);
    if (remaining.length !== 1) throw new Error(`Duplicate deletion verification failed: expected 1 remaining, found ${remaining.length}.`);
    return json({ deleted: publicEvent(duplicate), remaining: remaining.length, calendar: calendarName });
  }

  async previewCopy(request) {
    const body = await readJson(request);
    const source = validDateKey(body.source);
    const target = validDateKey(body.target);
    if (!source || !target) return json({ error: "source and target must be YYYY-MM-DD." }, 400);
    if (source === target) return json({ error: "source and target must differ." }, 400);
    const preview = await this.buildCopyPreview(source, target);
    const confirmationId = randomId();
    await this.state.storage.put(`confirmation:${confirmationId}`, {
      preview,
      expiresAt: Date.now() + CONFIRMATION_TTL_MS,
      consumed: false,
    });
    return json({ ...preview, confirmationId, confirmationExpiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString(), writeRequiresExplicitConfirmation: true });
  }

  async confirmCopy(request) {
    const body = await readJson(request);
    const confirmationId = typeof body.confirmationId === "string" ? body.confirmationId : "";
    if (!confirmationId) return json({ error: "confirmationId is required." }, 400);
    const record = await this.state.storage.get(`confirmation:${confirmationId}`);
    if (!record || record.expiresAt < Date.now()) return json({ error: "Confirmation expired. Create a fresh preview." }, 409);
    if (record.consumed) return json({ error: "Confirmation already used." }, 409);
    if (record.preview.conflicts.length && body.allowConflicts !== true) {
      return json({ error: "Target conflicts exist. Confirm again with allowConflicts: true only after reviewing them.", conflicts: record.preview.conflicts }, 409);
    }

    const maxEvents = Number.isInteger(body.maxEvents) && body.maxEvents > 0 ? Math.min(body.maxEvents, 25) : 25;
    record.consumed = true;
    await this.state.storage.put(`confirmation:${confirmationId}`, record);
    const result = await this.copyPreviewEvents(record.preview, maxEvents);
    return json({ ...result, source: record.preview.source, target: record.preview.target, confirmationId, maxEvents });
  }

  async buildCopyPreview(source, target) {
    const calendars = await this.planCalendarMap();
    const shiftMs = dateAtBangkok(target).getTime() - dateAtBangkok(source).getTime();
    const plans = [];
    const conflicts = [];
    let sourceCount = 0;
    let duplicates = 0;
    let ready = 0;

    for (const name of PLAN_CALENDARS) {
      const calendar = calendars.get(name);
      if (!calendar) {
        plans.push({ calendar: name, found: false, source: 0, ready: 0, duplicates: 0, events: [] });
        continue;
      }
      const sourceEvents = await this.listEvents(calendar.id, source, addDays(source, 7));
      const targetEvents = await this.listEvents(calendar.id, target, addDays(target, 7));
      const targetKeys = new Set(targetEvents.map(eventKey));
      const events = [];
      let calendarReady = 0;
      let calendarDuplicates = 0;
      for (const event of sourceEvents) {
        const shifted = shiftEvent(event, shiftMs);
        const duplicate = targetKeys.has(eventKey(shifted));
        const overlap = targetEvents.filter((targetEvent) => overlaps(shifted, targetEvent) && eventKey(shifted) !== eventKey(targetEvent));
        if (duplicate) calendarDuplicates += 1;
        else calendarReady += 1;
        if (overlap.length) conflicts.push({ calendar: name, event: publicEvent(shifted), overlaps: overlap.map(publicEvent) });
        events.push({ sourceEvent: publicEvent(event), shiftedEvent: copyPayload(shifted), duplicate, conflictCount: overlap.length });
      }
      sourceCount += sourceEvents.length;
      duplicates += calendarDuplicates;
      ready += calendarReady;
      plans.push({ calendar: name, found: true, calendarId: calendar.id, source: sourceEvents.length, ready: calendarReady, duplicates: calendarDuplicates, events });
    }
    return { mode: "preview", source, target, sourceCount, ready, duplicates, conflicts, calendars: plans };
  }

  async copyPreviewEvents(preview, maxEvents) {
    let created = 0;
    let skipped = 0;
    const createdByCalendar = [];
    for (const plan of preview.calendars) {
      if (!plan.found || created >= maxEvents) continue;
      const current = await this.listEvents(plan.calendarId, preview.target, addDays(preview.target, 7));
      const currentKeys = new Set(current.map(eventKey));
      const pending = [];
      let calendarSkipped = 0;
      for (const item of plan.events) {
        const key = eventKey(item.shiftedEvent);
        if (currentKeys.has(key)) {
          skipped += 1;
          calendarSkipped += 1;
          continue;
        }
        if (created + pending.length >= maxEvents) break;
        // Reserve before dispatch so equivalent source events cannot be posted twice.
        currentKeys.add(key);
        pending.push(item);
      }
      // Calendar writes are deliberately throttled to stay below Google per-user limits.
      await mapWithConcurrency(pending, 1, async (item) => {
        await this.google(`/calendars/${encodeURIComponent(plan.calendarId)}/events`, {
          method: "POST",
          body: JSON.stringify(copyPayload(item.shiftedEvent)),
        });
      });
      const calendarCreated = pending.length;
      created += calendarCreated;
      createdByCalendar.push({ calendar: plan.calendar, created: calendarCreated, skipped: calendarSkipped });
    }
    return { mode: "executed", created, skipped, calendars: createdByCalendar };
  }

  // Every domain tap is a switch, including a second tap on the domain already
  // running. The Watch and paired PWA both use this one transaction.
  async startBlock(request, fromPath) {
    // A query parameter keeps the Shortcut to a URL and one header. Building a JSON
    // body by hand on a phone is where this gets fiddly, so accept either.
    const fromQuery = fromPath ?? new URL(request.url).searchParams.get("domain");
    const body = fromQuery ? {} : (await readJson(request)) || {};
    const domain = resolveDomain(decodeURIComponent(fromQuery ?? body.domain ?? ""));
    if (!domain) {
      return json({ error: `Unknown domain. Use one of: ${LD8.map((item) => item.code).join(", ")}` }, 400);
    }

    const calendar = await this.actualCalendar();
    if (!calendar) return json({ error: `Calendar not found: ${ACTUAL_CALENDARS[0]}` }, 404);

    const now = new Date();
    const requestedBlockId = typeof body.blockId === "string" && body.blockId.trim() ? body.blockId.trim() : randomId();
    const activeEvents = await this.findActiveEvents(calendar.id, now);
    const existing = activeEvents.find((event) => privateProps(event).blockId === requestedBlockId);

    // Close every placeholder, not just the newest: the phone may have opened one
    // this side had not seen yet, and leaving it running duplicates the timeline.
    const closed = [];
    for (const stale of activeEvents) {
      if (stale === existing) continue;
      const result = await this.closeActiveEvent(calendar.id, stale, now);
      closed.push(result);
    }

    // A lost phone response can retry the exact same command. Keep its existing
    // active placeholder instead of creating a duplicate, while still closing any
    // older active block the retry discovers.
    if (existing) {
      return json({ started: domain.code, at: hhmm(now), active: appActiveEvent(existing), closed, retried: true });
    }

    const end = new Date(now.getTime() + ACTIVE_PLACEHOLDER_MINUTES * 60 * 1000);
    const created = await this.google(`/calendars/${encodeURIComponent(calendar.id)}/events`, {
      method: "POST",
      body: JSON.stringify({
        summary: `Active: ${domain.code}`,
        description: "Active block from TimeBlock Reality",
        start: { dateTime: now.toISOString(), timeZone: "Asia/Bangkok" },
        end: { dateTime: end.toISOString(), timeZone: "Asia/Bangkok" },
        extendedProperties: {
          private: { ld8: domain.id, source: "timeblock-reality", status: "active", blockId: requestedBlockId },
        },
      }),
    });

    return json({ started: domain.code, at: hhmm(now), active: appActiveEvent(created), closed });
  }

  async running() {
    const calendar = await this.actualCalendar();
    if (!calendar) return json({ error: `Calendar not found: ${ACTUAL_CALENDARS[0]}` }, 404);
    const now = new Date();
    const event = await this.resolveSingleActiveEvent(calendar.id, now);
    if (!event) return json({ running: null, message: "Nothing running" });
    const code = domainById(privateProps(event).ld8)?.code || event.summary?.replace("Active: ", "") || "?";
    const startedAt = new Date(event.start.dateTime);
    const minutes = Math.max(0, Math.round((now - startedAt) / 60000));
    return json({ running: code, since: hhmm(startedAt), minutes, message: `${code} ${formatSpan(minutes)}` });
  }

  async createPairing() {
    const code = base64Url(crypto.getRandomValues(new Uint8Array(12)));
    await this.state.storage.put(`pair:${code}`, { expiresAt: Date.now() + PAIRING_TTL_MS });
    return json({ code, expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString() });
  }

  async pair(request) {
    const body = await readJson(request);
    const code = typeof body.code === "string" ? body.code : "";
    const record = await this.state.storage.get(`pair:${code}`);
    await this.state.storage.delete(`pair:${code}`);
    if (!record || record.expiresAt < Date.now()) return json({ error: "Pairing code expired" }, 401);
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    await this.state.storage.put(`pwa:${await sha256Base64Url(token)}`, { createdAt: Date.now() });
    return json({ token });
  }

  async appBootstrap(request) {
    if (!(await this.validPwaToken(request))) return json({ error: "Pair this device first" }, 401);
    const calendar = await this.actualCalendar();
    if (!calendar) return json({ error: `Calendar not found: ${ACTUAL_CALENDARS[0]}` }, 404);
    const today = new Date().toISOString().slice(0, 10);
    const actualEvents = await this.listEvents(calendar.id, addDays(today, -14), addDays(today, 7));
    const activeEvent = await this.resolveSingleActiveEvent(calendar.id, new Date());
    const planMap = await this.planCalendarMap();
    const planEvents = [];
    for (const domain of LD8) {
      const plan = planMap.get(domain.code);
      if (!plan) continue;
      const events = await this.listEvents(plan.id, today, addDays(today, 7));
      planEvents.push(...events.map((event) => appPlanEvent(event, domain.id)).filter(Boolean));
    }
    return json({
      actual: actualEvents.filter((event) => privateProps(event).status !== "active").map(appActualEvent).filter(Boolean),
      active: activeEvent ? appActiveEvent(activeEvent) : null,
      plan: planEvents.sort((a, b) => new Date(a.start) - new Date(b.start)),
      syncedAt: new Date().toISOString(),
    });
  }

  async validPwaToken(request) {
    const value = request.headers.get("authorization") || "";
    if (!value.startsWith("Bearer ")) return false;
    return Boolean(await this.state.storage.get(`pwa:${await sha256Base64Url(value.slice(7))}`));
  }

  async findActiveEvents(calendarId, now) {
    // The placeholder can have been opened well before today, so look back a little.
    const from = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const events = await this.listEvents(calendarId, from, to);
    return events
      .filter((event) => privateProps(event).status === "active" && event.start?.dateTime)
      .sort((a, b) => new Date(b.start.dateTime) - new Date(a.start.dateTime));
  }

  async findActiveEvent(calendarId, now) {
    return (await this.findActiveEvents(calendarId, now))[0] || null;
  }

  async resolveSingleActiveEvent(calendarId, now) {
    const activeEvents = await this.findActiveEvents(calendarId, now);
    if (activeEvents.length < 2) return activeEvents[0] || null;

    // A newer tap is always intentional, even when it is the same LD8 domain.
    // Close older placeholders at that timestamp so old app/watch races become
    // ordinary completed actual blocks instead of running in parallel.
    const keep = activeEvents[0];
    const switchedAt = new Date(keep.start.dateTime);
    for (const stale of activeEvents.slice(1)) {
      await this.closeActiveEvent(calendarId, stale, switchedAt);
    }
    return keep;
  }

  async closeActiveEvent(calendarId, event, now) {
    const startedAt = new Date(event.start.dateTime);
    const props = privateProps(event);
    const code = domainById(props.ld8)?.code || event.summary?.replace("Active: ", "") || "?";
    const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`;

    // Same rule as the app: a block under a minute is a mistap, not real time.
    if (now - startedAt < MIN_BLOCK_MS) {
      await this.google(path, { method: "DELETE" });
      return { discarded: code };
    }

    const updated = await this.google(path, {
      method: "PATCH",
      body: JSON.stringify({
        summary: `Actual: ${code}`,
        end: { dateTime: now.toISOString(), timeZone: "Asia/Bangkok" },
        extendedProperties: { private: { ...props, status: "actual" } },
      }),
    });
    return { domain: code, minutes: Math.round((now - startedAt) / 60000), block: appActualEvent(updated) };
  }

  async actualCalendar() {
    const calendars = await this.readableCalendarMap();
    for (const name of ACTUAL_CALENDARS) {
      const found = calendars.get(name);
      if (found) return found;
    }
    return null;
  }

  async planCalendarMap() {
    const calendars = await this.readableCalendarMap();
    return new Map([...calendars].filter(([summary]) => PLAN_CALENDARS.includes(summary)));
  }

  async readableCalendarMap() {
    const data = await this.google("/users/me/calendarList?minAccessRole=reader");
    const readableNames = new Set([...PLAN_CALENDARS, ...ACTUAL_CALENDARS]);
    return new Map((data.items || []).filter((item) => readableNames.has(item.summary)).map((item) => [item.summary, item]));
  }

  async listEvents(calendarId, start, end) {
    const params = new URLSearchParams({ timeMin: dateAtBangkok(start).toISOString(), timeMax: dateAtBangkok(end).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "2500" });
    const data = await this.google(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    return (data.items || []).filter((event) => event.status !== "cancelled");
  }

  async google(path, init = {}) {
    const token = await this.accessToken();
    const response = await fetch(`${CALENDAR_API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(`Google Calendar API ${response.status}: ${data?.error?.message || "request failed"}`);
    return data;
  }

  async accessToken() {
    const token = await this.loadToken();
    if (!token?.refresh_token) throw new Error("Google Calendar is not connected. Open /oauth/start first.");
    if (token.access_token && token.expires_at > Date.now() + 60_000) return token.access_token;
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET, refresh_token: token.refresh_token, grant_type: "refresh_token" }),
    });
    const refreshed = await response.json();
    if (!response.ok || !refreshed.access_token) throw new Error("Google Calendar connection expired. Reconnect OAuth.");
    const next = { ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token, expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000 };
    await this.storeToken(next);
    return next.access_token;
  }

  async loadToken() {
    const encrypted = await this.state.storage.get("google-token");
    return encrypted ? decryptJson(encrypted, this.env.TOKEN_ENCRYPTION_KEY) : null;
  }

  async storeToken(token) {
    const next = { ...token, expires_at: Date.now() + (token.expires_in || 3600) * 1000 };
    await this.state.storage.put("google-token", await encryptJson(next, this.env.TOKEN_ENCRYPTION_KEY));
  }
}

function withInternalPath(request, pathname) {
  const url = new URL(request.url);
  const publicOrigin = url.origin;
  url.hostname = "calendar-credential.internal";
  url.pathname = pathname;
  const headers = new Headers(request.headers);
  headers.set("x-calendar-public-origin", publicOrigin);
  return new Request(url, { method: request.method, headers, body: request.body, redirect: request.redirect });
}

function isAuthorized(request, env) {
  const value = request.headers.get("authorization") || "";
  return timingSafeEqual(value, `Bearer ${env.HERMES_API_TOKEN}`);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

// A Shortcut menu sends whatever the button was labelled, so accept the code, the
// short id, or just the number.
function resolveDomain(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  return LD8.find((item) => {
    const code = item.code.toLowerCase();
    return text === code || text === item.id || text === code.slice(2) || text === code.slice(0, 1);
  }) || null;
}

function domainById(id) {
  return LD8.find((item) => item.id === id) || null;
}

function privateProps(event) {
  return event?.extendedProperties?.private || {};
}

function hhmm(date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function formatSpan(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function validDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function dateAtBangkok(key) {
  return new Date(`${key}T00:00:00+07:00`);
}

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftEvent(event, shiftMs) {
  if (event.start?.date) {
    const days = Math.round(shiftMs / 86_400_000);
    return { ...event, start: { date: addDays(event.start.date, days) }, end: { date: addDays(event.end.date, days) } };
  }
  return {
    ...event,
    start: { dateTime: new Date(new Date(event.start.dateTime).getTime() + shiftMs).toISOString(), timeZone: "Asia/Bangkok" },
    end: { dateTime: new Date(new Date(event.end.dateTime).getTime() + shiftMs).toISOString(), timeZone: "Asia/Bangkok" },
  };
}

function eventKey(event) {
  const start = canonicalDateTime(event.start?.dateTime) || event.start?.date || "";
  const end = canonicalDateTime(event.end?.dateTime) || event.end?.date || "";
  return [event.summary || "", start, end, Boolean(event.start?.date)].join("|");
}

function canonicalDateTime(value) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : String(value);
}

async function mapWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(workers);
}

function overlaps(first, second) {
  if (first.start?.date || second.start?.date) return eventKey(first) === eventKey(second);
  const firstStart = new Date(first.start.dateTime).getTime();
  const firstEnd = new Date(first.end.dateTime).getTime();
  const secondStart = new Date(second.start.dateTime).getTime();
  const secondEnd = new Date(second.end.dateTime).getTime();
  return firstStart < secondEnd && secondStart < firstEnd;
}

function copyPayload(event) {
  const payload = {
    summary: event.summary || "",
    description: event.description || "",
    location: event.location || "",
    start: event.start,
    end: event.end,
  };
  if (event.transparency) payload.transparency = event.transparency;
  return payload;
}

function publicEvent(event) {
  return { summary: event.summary || "(untitled)", start: event.start, end: event.end, allDay: Boolean(event.start?.date) };
}

function appActualEvent(event) {
  if (!event?.start?.dateTime || !event?.end?.dateTime) return null;
  const props = privateProps(event);
  return {
    id: props.blockId || `gcal-actual-${event.id}`,
    categoryId: props.ld8 || resolveDomain(event.summary || "")?.id || "mm",
    note: event.description || "",
    start: event.start.dateTime,
    end: event.end.dateTime,
    googleEventId: event.id,
    source: "timeblock-reality",
    syncStatus: "synced",
  };
}

function appActiveEvent(event) {
  const props = privateProps(event);
  return {
    id: props.blockId || `gcal-active-${event.id}`,
    categoryId: props.ld8 || resolveDomain(event.summary || "")?.id || "mm",
    note: event.description || "",
    start: event.start.dateTime,
    googleEventId: event.id,
    status: "active",
  };
}

function appPlanEvent(event, categoryId) {
  if (!event?.start?.dateTime || !event?.end?.dateTime) return null;
  return {
    id: `gcal-plan-${categoryId}-${event.id}`,
    categoryId,
    note: event.summary || "",
    start: event.start.dateTime,
    end: event.end.dateTime,
    source: "gcal-plan",
    googleEventId: event.id,
  };
}

function appCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", PWA_ORIGIN);
  headers.set("access-control-allow-headers", "authorization, content-type");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

function randomId() {
  return crypto.randomUUID();
}

function randomVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return base64Url(bytes);
}

async function sha256Base64Url(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function keyBytes(secret) {
  const bytes = decodeBase64Url(secret);
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte base64url value.");
  return bytes;
}

async function encryptJson(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes(secret), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: base64Url(iv), ciphertext: base64Url(new Uint8Array(encrypted)) };
}

async function decryptJson(value, secret) {
  const key = await crypto.subtle.importKey("raw", keyBytes(secret), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(value.iv) }, key, decodeBase64Url(value.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function oauthPage(title, message, status = 200) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:34rem;margin:20vh auto;padding:0 1.25rem"><h1>${escapeHtml(title)}</h1><p>${message}</p></body>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}
