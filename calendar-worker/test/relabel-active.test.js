import assert from "node:assert/strict";
import test from "node:test";

import { CalendarCredential } from "../src/index.js";

function setup(active, pages = [{ items: [] }]) {
  const calls = [];
  const credential = new CalendarCredential({ storage: {} }, {});
  credential.actualCalendar = async () => ({ id: "actual" });
  credential.findActiveEvents = async () => active;
  credential.google = async (path, init = {}) => {
    if (!init.method) {
      calls.push({ path, method: "GET" });
      return pages.shift() || { items: [] };
    }
    calls.push({ path, method: init.method, body: JSON.parse(init.body) });
    const target = active.find((event) => path.endsWith(`/${event.id}`));
    const body = JSON.parse(init.body);
    return { ...target, ...body };
  };
  const relabel = (payload) => credential.relabelActive(new Request("https://worker/app/relabel-active", {
    method: "POST",
    body: JSON.stringify(payload),
  }));
  return { calls, relabel };
}

const running = {
  id: "ev1",
  summary: "Active: 6 FN",
  start: { dateTime: "2026-10-08T20:30:00+07:00" },
  extendedProperties: { private: { ld8: "fn", source: "timeblock-reality", status: "active", blockId: "b1" } },
};

test("relabels the running block in place, keeping start and blockId", async () => {
  const { calls, relabel } = setup([running]);
  const result = await (await relabel({ blockId: "b1", domain: "cm" })).json();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].body.summary, "Active: 5 CM");
  assert.deepEqual(calls[0].body.extendedProperties.private, { ld8: "cm", source: "timeblock-reality", status: "active", blockId: "b1" });
  assert.equal(result.active.id, "b1");
  assert.equal(result.active.categoryId, "cm");
  assert.equal(result.active.start, "2026-10-08T20:30:00+07:00");
});

test("refuses a block that is no longer running", async () => {
  const { calls, relabel } = setup([running]);
  const response = await relabel({ blockId: "other", domain: "cm" });
  assert.equal(response.status, 409);
  assert.equal(calls.length, 0);
});

test("rejects an unknown domain", async () => {
  const { relabel } = setup([running]);
  assert.equal((await relabel({ blockId: "b1", domain: "zz" })).status, 400);
});

function recentRunning() {
  return { ...running, start: { dateTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() } };
}

test("Forgot to tap moves the same running block earlier and retries without duplicating it", async () => {
  const target = recentRunning();
  const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { calls, relabel } = setup([target]);
  const response = await relabel({ blockId: "b1", domain: "fn", start: at });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.active.id, "b1");
  assert.equal(result.active.start, at);
  assert.equal(result.active.categoryId, "fn");
  assert.deepEqual(calls.map(call => call.method), ["GET", "PATCH"]);
  assert.ok(calls[1].path.endsWith("/ev1"));
  target.start.dateTime = at;
  assert.equal((await relabel({ blockId: "b1", domain: "fn", start: at })).status, 200);
  assert.equal(calls.at(-1).method, "PATCH");
});

test("earlier start rejects invalid times, a later start, and a different domain without writing", async () => {
  for (const payload of [
    { start: "invalid" },
    { start: new Date(Date.now() + 60000).toISOString() },
    { start: new Date(Date.now() - 30 * 60000).toISOString() },
    { start: new Date(Date.now() - 13 * 3600000).toISOString() },
    { start: new Date(Date.now() - 2 * 3600000).toISOString(), domain: "cm" },
  ]) {
    const { calls, relabel } = setup([recentRunning()]);
    assert.equal((await relabel({ blockId: "b1", domain: "fn", ...payload })).status, 400);
    assert.equal(calls.length, 0);
  }
});

test("earlier start refuses an overlap found on a later Calendar page without writing", async () => {
  const { calls, relabel } = setup([recentRunning()], [
    { items: [], nextPageToken: "next-page" },
    { items: [{ id: "previous-actual" }] },
  ]);
  const response = await relabel({ blockId: "b1", domain: "fn", start: new Date(Date.now() - 2 * 3600000).toISOString() });
  assert.equal(response.status, 422);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.method === "GET"));
  assert.ok(calls[1].path.includes("pageToken=next-page"));
});
