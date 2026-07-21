const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const PLAN_CALENDARS = ["1 BD", "2 SP", "3 MM", "4 RS", "5 CM", "6 FN", "7 CT", "8 LS"];
const STATE_TTL_MS = 10 * 60 * 1000;
const CONFIRMATION_TTL_MS = 30 * 60 * 1000;

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
    const calendars = await this.planCalendarMap();
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

    record.consumed = true;
    await this.state.storage.put(`confirmation:${confirmationId}`, record);
    const result = await this.copyPreviewEvents(record.preview);
    return json({ ...result, source: record.preview.source, target: record.preview.target, confirmationId });
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

  async copyPreviewEvents(preview) {
    let created = 0;
    let skipped = 0;
    const createdByCalendar = [];
    for (const plan of preview.calendars) {
      if (!plan.found) continue;
      const current = await this.listEvents(plan.calendarId, preview.target, addDays(preview.target, 7));
      const currentKeys = new Set(current.map(eventKey));
      let calendarCreated = 0;
      let calendarSkipped = 0;
      for (const item of plan.events) {
        if (currentKeys.has(eventKey(item.shiftedEvent))) {
          skipped += 1;
          calendarSkipped += 1;
          continue;
        }
        await this.google(`/calendars/${encodeURIComponent(plan.calendarId)}/events`, {
          method: "POST",
          body: JSON.stringify(copyPayload(item.shiftedEvent)),
        });
        currentKeys.add(eventKey(item.shiftedEvent));
        created += 1;
        calendarCreated += 1;
      }
      createdByCalendar.push({ calendar: plan.calendar, created: calendarCreated, skipped: calendarSkipped });
    }
    return { mode: "executed", created, skipped, calendars: createdByCalendar };
  }

  async planCalendarMap() {
    const data = await this.google("/users/me/calendarList?minAccessRole=reader");
    return new Map((data.items || []).filter((item) => PLAN_CALENDARS.includes(item.summary)).map((item) => [item.summary, item]));
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
  const start = event.start?.dateTime || event.start?.date || "";
  const end = event.end?.dateTime || event.end?.date || "";
  return [event.summary || "", start, end, Boolean(event.start?.date)].join("|");
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
