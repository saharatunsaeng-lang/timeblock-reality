import assert from "node:assert/strict";
import test from "node:test";

import { CalendarCredential } from "../src/index.js";

function setup(active) {
  const calls = [];
  const credential = new CalendarCredential({ storage: {} }, {});
  credential.actualCalendar = async () => ({ id: "actual" });
  credential.findActiveEvents = async () => active;
  credential.google = async (path, init = {}) => {
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
