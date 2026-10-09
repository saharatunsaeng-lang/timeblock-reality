import assert from "node:assert/strict";
import test from "node:test";

import { CalendarCredential } from "../src/index.js";

function setup(runningStart) {
  const calls = [];
  const running = {
    id: "ev1",
    summary: "Active: 1 BD",
    start: { dateTime: runningStart.toISOString() },
    extendedProperties: { private: { ld8: "bd", source: "timeblock-reality", status: "active", blockId: "b1" } },
  };
  const credential = new CalendarCredential({ storage: {} }, {});
  credential.actualCalendar = async () => ({ id: "actual" });
  credential.findActiveEvents = async () => [running];
  credential.google = async (path, init = {}) => {
    const body = JSON.parse(init.body || "{}");
    calls.push({ path, method: init.method, body });
    return { ...running, ...body };
  };
  const stop = (payload) => credential.stopActive(new Request("https://worker/app/stop-active", {
    method: "POST",
    body: JSON.stringify(payload),
  }));
  return { calls, stop };
}

test("ends the running block at the given time and starts nothing", async () => {
  const now = Date.now();
  const { calls, stop } = setup(new Date(now - 60 * 60 * 1000));
  const end = new Date(now - 10 * 60 * 1000).toISOString();
  const result = await (await stop({ blockId: "b1", end })).json();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].body.end.dateTime, end);
  assert.equal(calls[0].body.extendedProperties.private.status, "actual");
  assert.equal(result.active, null);
  assert.equal(result.closed[0].block.categoryId, "bd");
});

test("refuses an end before the block started, or in the future", async () => {
  const now = Date.now();
  const { calls, stop } = setup(new Date(now - 30 * 60 * 1000));
  assert.equal((await stop({ blockId: "b1", end: new Date(now - 40 * 60 * 1000).toISOString() })).status, 400);
  assert.equal((await stop({ blockId: "b1", end: new Date(now + 60 * 1000).toISOString() })).status, 400);
  assert.equal(calls.length, 0);
});

test("refuses a block that is no longer running", async () => {
  const { stop } = setup(new Date(Date.now() - 30 * 60 * 1000));
  assert.equal((await stop({ blockId: "other", end: new Date().toISOString() })).status, 409);
});
