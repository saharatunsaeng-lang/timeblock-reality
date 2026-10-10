import assert from "node:assert/strict";
import test from "node:test";

import { CalendarCredential } from "../src/index.js";

function setup() {
  const values = new Map();
  const pushed = [];
  const env = {
    PUSH_SIGNAL: { fetch: async (url, init) => { pushed.push({ url, body: JSON.parse(init.body) }); return new Response("{}"); } },
  };
  const storage = { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) };
  const credential = new CalendarCredential({ storage }, env);
  credential.validPwaToken = async () => true;
  credential.actualCalendar = async () => ({ id: "actual" });
  credential.findActiveEvents = async () => [];
  credential.google = async (_path, init = {}) => ({ id: "ev-new", ...JSON.parse(init.body || "{}") });
  return { credential, pushed, values };
}

test("the phone's push installation is remembered and a Watch switch moves its check-in", async () => {
  const { credential, pushed } = setup();
  const phone = new Request("https://worker/app/bootstrap", { headers: { "x-push-installation": "11111111-2222-3333-4444-555555555555" } });
  assert.equal(await credential.appAuthorized(phone), true);

  // The Watch path carries no installation header.
  await credential.startBlock(new Request("https://worker/v1/s/bd", { method: "POST" }), "bd");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].url.endsWith("/v1/start"), true);
  assert.equal(pushed[0].body.installationId, "11111111-2222-3333-4444-555555555555");
  assert.equal(pushed[0].body.active.categoryId, "bd");
});

test("ignores a malformed installation id", async () => {
  const { credential, values } = setup();
  await credential.appAuthorized(new Request("https://worker/app/bootstrap", { headers: { "x-push-installation": "bad id!" } }));
  assert.equal(values.get("push:installations"), undefined);
});
