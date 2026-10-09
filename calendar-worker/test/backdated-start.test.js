import assert from "node:assert/strict";
import test from "node:test";

import { CalendarCredential } from "../src/index.js";

function setup(runningStart) {
  const calls = [];
  const running = {
    id: "ev-old",
    summary: "Active: 6 FN",
    start: { dateTime: runningStart.toISOString() },
    extendedProperties: { private: { ld8: "fn", source: "timeblock-reality", status: "active", blockId: "old" } },
  };
  const credential = new CalendarCredential({ storage: {} }, {});
  credential.actualCalendar = async () => ({ id: "actual" });
  credential.findActiveEvents = async () => [running];
  credential.google = async (path, init = {}) => {
    const body = JSON.parse(init.body || "{}");
    calls.push({ path, method: init.method, body });
    if (init.method === "PATCH") return { ...running, ...body };
    return { id: "ev-new", ...body };
  };
  const start = (payload) => credential.startBlock(new Request("https://worker/app/start-block", {
    method: "POST",
    body: JSON.stringify(payload),
  }));
  return { calls, start };
}

test("a back-dated switch closes the old block and starts the new one at that time", async () => {
  const now = Date.now();
  const { calls, start } = setup(new Date(now - 60 * 60 * 1000));
  const at = new Date(now - 20 * 60 * 1000).toISOString();
  const result = await (await start({ domain: "cm", blockId: "new", start: at })).json();
  const patch = calls.find((call) => call.method === "PATCH");
  const post = calls.find((call) => call.method === "POST");
  assert.equal(patch.body.end.dateTime, at);
  assert.equal(post.body.start.dateTime, at);
  assert.equal(result.active.categoryId, "cm");
  assert.equal(result.active.start, at);
});

test("refuses a back-dated start before the running block began", async () => {
  const now = Date.now();
  const { calls, start } = setup(new Date(now - 30 * 60 * 1000));
  const response = await start({ domain: "cm", blockId: "new", start: new Date(now - 40 * 60 * 1000).toISOString() });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("refuses a start in the future", async () => {
  const { start } = setup(new Date(Date.now() - 30 * 60 * 1000));
  const response = await start({ domain: "cm", blockId: "new", start: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
  assert.equal(response.status, 400);
});
