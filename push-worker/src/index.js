import webpush from "web-push";

const appOrigin = "https://saharatunsaeng-lang.github.io";
const checkinIntervalMs = 30 * 60 * 1000;
const categoryCodes = {
  bd: "1 BD", sp: "2 SP", mm: "3 MM", rs: "4 RS",
  cm: "5 CM", fn: "6 FN", ct: "7 CT", ls: "8 LS",
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return corsResponse(origin);
    if (origin && origin !== appOrigin) return json({ error: "Origin not allowed" }, 403, origin);

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/config") {
      return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY || "" }, 200, origin);
    }
    if (request.method !== "POST" || !url.pathname.startsWith("/v1/")) {
      return json({ error: "Not found" }, 404, origin);
    }

    const body = await readJson(request, origin);
    if (body.error) return body.error;
    const installationId = body.value.installationId;
    if (!isInstallationId(installationId)) return json({ error: "Invalid installation" }, 400, origin);

    const id = env.TIMEBLOCK_SIGNAL.idFromName(installationId);
    const target = new URL(request.url);
    target.hostname = "timeblock-signal.internal";
    return env.TIMEBLOCK_SIGNAL.get(id).fetch(new Request(target, {
      method: "POST",
      headers: { "content-type": "application/json", "x-timeblock-origin": origin || "" },
      body: JSON.stringify(body.value),
    }));
  },
};

export class TimeBlockSignal {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const origin = request.headers.get("x-timeblock-origin");
    const body = await readJson(request, origin);
    if (body.error) return body.error;
    const url = new URL(request.url);

    if (url.pathname === "/v1/register") return this.register(body.value, origin);
    if (url.pathname === "/v1/start") return this.start(body.value, origin);
    if (url.pathname === "/v1/end") return this.end(body.value, origin);
    if (url.pathname === "/v1/test") return this.test(origin);
    return json({ error: "Not found" }, 404, origin);
  }

  async register({ subscription }, origin) {
    if (!isSubscription(subscription)) return json({ error: "Invalid subscription" }, 400, origin);
    const subscriptions = await this.state.storage.get("subscriptions") || [];
    const next = [
      ...subscriptions.filter((item) => item.endpoint !== subscription.endpoint),
      subscription,
    ];
    await this.state.storage.put("subscriptions", next);
    return json({ ok: true }, 200, origin);
  }

  async start({ active }, origin) {
    if (!isActiveBlock(active)) return json({ error: "Invalid active block" }, 400, origin);
    const current = await this.state.storage.get("active");
    const reminderCount = current?.id === active.id ? current.reminderCount || 0 : 0;
    const next = { id: active.id, categoryId: active.categoryId, start: active.start, reminderCount };
    await this.state.storage.put("active", next);
    await this.scheduleNextCheckin(next);
    return json({ ok: true, reminderCount }, 200, origin);
  }

  async end({ activeId }, origin) {
    const current = await this.state.storage.get("active");
    if (!activeId || !current || current.id === activeId) {
      await this.state.storage.delete("active");
      await this.state.storage.deleteAlarm();
    }
    return json({ ok: true }, 200, origin);
  }

  async test(origin) {
    const delivered = await this.sendPush({
      title: "TimeBlock test alert",
      body: "Notifications are reaching this iPhone.",
      tag: `timeblock-test-${Date.now()}`,
      data: { type: "test" },
    });
    return json({ ok: true, delivered }, 200, origin);
  }

  async alarm() {
    const active = await this.state.storage.get("active");
    if (!active) return;

    const elapsed = Date.now() - new Date(active.start).getTime();
    const dueCount = Math.floor(elapsed / checkinIntervalMs);
    if (!Number.isFinite(elapsed) || dueCount <= active.reminderCount) {
      await this.scheduleNextCheckin(active);
      return;
    }

    await this.sendCheckin(active, dueCount);
    const next = { ...active, reminderCount: dueCount };
    await this.state.storage.put("active", next);
    await this.scheduleNextCheckin(next);
  }

  async scheduleNextCheckin(active) {
    const startedAt = new Date(active.start).getTime();
    if (!Number.isFinite(startedAt)) return;
    const nextCount = Math.max(1, (active.reminderCount || 0) + 1);
    const nextAt = Math.max(Date.now() + 1000, startedAt + nextCount * checkinIntervalMs);
    await this.state.storage.setAlarm(nextAt);
  }

  async sendCheckin(active, reminderCount) {
    const subscriptions = await this.state.storage.get("subscriptions") || [];
    if (!subscriptions.length) return;
    await this.sendPush({
      title: `${categoryCodes[active.categoryId] || active.categoryId} · ${reminderCount * 30} minutes`,
      body: `Check-in ${reminderCount}: continue, switch, or end this block.`,
      tag: `timeblock-${active.id}-${reminderCount}`,
      badge: reminderCount,
      data: { activeId: active.id, reminderCount },
    });
  }

  async sendPush(payload) {
    const subscriptions = await this.state.storage.get("subscriptions") || [];
    if (!subscriptions.length) return 0;
    webpush.setVapidDetails(
      this.env.VAPID_SUBJECT,
      this.env.VAPID_PUBLIC_KEY,
      this.env.VAPID_PRIVATE_KEY,
    );
    const deadEndpoints = [];

    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) deadEndpoints.push(subscription.endpoint);
        else throw error;
      }
    }));

    if (deadEndpoints.length) {
      await this.state.storage.put("subscriptions", subscriptions.filter((item) => !deadEndpoints.includes(item.endpoint)));
    }
    return subscriptions.length - deadEndpoints.length;
  }
}

function isInstallationId(value) {
  return typeof value === "string" && /^[a-z0-9-]{16,80}$/i.test(value);
}

function isActiveBlock(value) {
  return value && typeof value.id === "string" && typeof value.categoryId === "string"
    && typeof value.start === "string" && Number.isFinite(new Date(value.start).getTime());
}

function isSubscription(value) {
  return value && typeof value.endpoint === "string" && value.endpoint.startsWith("https://")
    && typeof value.keys?.p256dh === "string" && typeof value.keys?.auth === "string";
}

async function readJson(request, origin) {
  try {
    return { value: await request.json() };
  } catch (error) {
    return { error: json({ error: "Invalid JSON" }, 400, origin) };
  }
}

function corsResponse(origin) {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

function corsHeaders(origin) {
  return origin === appOrigin
    ? { "access-control-allow-origin": appOrigin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" }
    : {};
}
