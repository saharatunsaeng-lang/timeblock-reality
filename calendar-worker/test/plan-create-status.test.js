import assert from "node:assert/strict";
import test from "node:test";

import { CalendarCredential } from "../src/index.js";

const planEvent = {
  summary: "Deep work",
  start: { dateTime: "2026-08-10T09:00:00+07:00", timeZone: "Asia/Bangkok" },
  end: { dateTime: "2026-08-10T10:30:00+07:00", timeZone: "Asia/Bangkok" },
};

function fixture({ existing = [] } = {}) {
  const values = new Map();
  const state = {
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
    },
  };
  const credential = new CalendarCredential(state, {});
  const calendarEvents = [...existing];
  credential.planCalendarMap = async () => new Map([["3 MM", { id: "calendar-mm" }]]);
  credential.listEvents = async () => calendarEvents;
  credential.google = async (path, init = {}) => {
    if (init.method === "POST") {
      calendarEvents.push({ id: `created-${calendarEvents.length}`, ...JSON.parse(init.body) });
      return {};
    }
    return {};
  };
  return credential;
}

function statusRequest(confirmationId) {
  const url = new URL("https://worker/v1/plan-create-status");
  if (confirmationId !== undefined) url.searchParams.set("confirmationId", confirmationId);
  return url;
}

async function previewCreate(credential) {
  const response = await credential.previewCreatePlan(new Request("https://worker/v1/preview-create-plan", {
    method: "POST",
    body: JSON.stringify({ calendar: "3 MM", events: [planEvent] }),
  }));
  return response.json();
}

test("reports a confirmation as awaiting, then executed once it is used", async () => {
  const credential = fixture();
  const preview = await previewCreate(credential);

  const awaiting = await (await credential.planCreateStatus(statusRequest(preview.confirmationId))).json();
  assert.equal(awaiting.found, true);
  assert.equal(awaiting.state, "awaiting-confirmation");
  assert.equal(awaiting.calendar, "3 MM");
  assert.equal(awaiting.events, 1);

  await credential.confirmCreatePlan(new Request("https://worker/v1/confirm-create-plan", {
    method: "POST",
    body: JSON.stringify({ confirmationId: preview.confirmationId }),
  }));

  const executed = await (await credential.planCreateStatus(statusRequest(preview.confirmationId))).json();
  assert.equal(executed.state, "executed");
});

test("reports expiry without claiming the write happened", async () => {
  const credential = fixture();
  const preview = await previewCreate(credential);
  const record = await credential.state.storage.get(`confirmation:${preview.confirmationId}`);
  record.expiresAt = Date.now() - 1000;
  await credential.state.storage.put(`confirmation:${preview.confirmationId}`, record);

  const expired = await (await credential.planCreateStatus(statusRequest(preview.confirmationId))).json();
  assert.equal(expired.state, "expired");
  assert.notEqual(expired.state, "executed");
});

test("does not leak other confirmation kinds or unknown ids", async () => {
  const credential = fixture();
  const unknown = await credential.planCreateStatus(statusRequest("does-not-exist"));
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).state, "unknown");

  await credential.state.storage.put("confirmation:other-kind", {
    kind: "cleanup-birthdays",
    preview: { calendar: "3 MM" },
    expiresAt: Date.now() + 60_000,
    consumed: false,
  });
  const wrongKind = await credential.planCreateStatus(statusRequest("other-kind"));
  assert.equal(wrongKind.status, 404);
});

test("requires a confirmation id", async () => {
  const credential = fixture();
  const missing = await credential.planCreateStatus(statusRequest());
  assert.equal(missing.status, 400);
});
