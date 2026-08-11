import assert from "node:assert/strict";
import test from "node:test";

import { CalendarCredential } from "../src/index.js";

const before = {
  id: "sleep-1",
  summary: "Sleep",
  start: { dateTime: "2026-08-05T20:30:00+07:00", timeZone: "Asia/Bangkok" },
  end: { dateTime: "2026-08-06T04:30:00+07:00", timeZone: "Asia/Bangkok" },
};
const replacement = {
  start: "2026-08-05T21:00:00+07:00",
  end: "2026-08-06T04:30:00+07:00",
};

function fixture() {
  const values = new Map();
  const state = { storage: { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) } };
  const credential = new CalendarCredential(state, {});
  const events = [{ ...before, start: { ...before.start }, end: { ...before.end } }];
  credential.planCalendarMap = async () => new Map([["1 BD", { id: "calendar-1" }]]);
  credential.listEvents = async () => events;
  credential.google = async (path, init = {}) => {
    const id = path.split("/").at(-1);
    const event = events.find((candidate) => candidate.id === id);
    assert.ok(event, `missing event ${id}`);
    if (init.method === "PATCH") {
      const patch = JSON.parse(init.body);
      event.start = patch.start;
      event.end = patch.end;
    }
    return event;
  };
  return credential;
}

async function body(response) {
  return response.json();
}

test("updates exactly one Plan event only after a one-time confirmation and reads it back", async () => {
  const credential = fixture();
  const preview = await body(await credential.previewUpdatePlan(new Request("https://worker/v1/preview-update-plan", {
    method: "POST",
    body: JSON.stringify({
      calendar: "1 BD", summary: "Sleep",
      currentStart: before.start.dateTime, currentEnd: before.end.dateTime,
      replacementStart: replacement.start, replacementEnd: replacement.end,
    }),
  })));
  assert.equal(preview.mode, "update-plan");
  assert.equal(preview.current.start.dateTime, before.start.dateTime);
  assert.equal(preview.replacement.start.dateTime, replacement.start);
  assert.equal(preview.writeRequiresExplicitConfirmation, true);

  const confirmed = await body(await credential.confirmUpdatePlan(new Request("https://worker/v1/confirm-update-plan", {
    method: "POST", body: JSON.stringify({ confirmationId: preview.confirmationId }),
  })));
  assert.equal(confirmed.mode, "executed");
  assert.equal(confirmed.updated.start.dateTime, replacement.start);
  assert.equal(confirmed.updated.end.dateTime, replacement.end);

  const reused = await credential.confirmUpdatePlan(new Request("https://worker/v1/confirm-update-plan", {
    method: "POST", body: JSON.stringify({ confirmationId: preview.confirmationId }),
  }));
  assert.equal(reused.status, 409);
});

test("refuses a preview whose exact current event is ambiguous", async () => {
  const credential = fixture();
  credential.listEvents = async () => [{ ...before }, { ...before, id: "sleep-2" }];
  await assert.rejects(
    () => credential.previewUpdatePlan(new Request("https://worker/v1/preview-update-plan", {
      method: "POST",
      body: JSON.stringify({ calendar: "1 BD", summary: "Sleep", currentStart: before.start.dateTime, currentEnd: before.end.dateTime, replacementStart: replacement.start, replacementEnd: replacement.end }),
    })),
    /exactly one matching event; found 2/,
  );
});
