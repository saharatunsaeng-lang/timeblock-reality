import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = ['forgotTimeValid', 'renderRelabelSheet', 'chooseRelabelDomain', 'correctActiveStart'];
const source = names.map(name => {
  const match = html.match(new RegExp(`      (?:async )?function ${name}\\(`));
  return html.slice(match.index).split(/\n      (?:async )?function /)[0];
}).join('\n');

function setup({ worker = false, response, actual = [] } = {}) {
  const originalStart = new Date(Date.now() - 3600000).toISOString();
  const earlier = new Date(Date.now() - 7200000);
  const buttons = ['fn', 'cm'].map(category => ({ dataset: { category }, classList: { toggle() {} } }));
  const calls = [];
  const ctx = vm.createContext({
    Date, AbortSignal, URLSearchParams,
    state: { active: { id: 'b1', categoryId: 'fn', start: originalStart }, actual, google: { connected: false } },
    relabelMode: 'forgot', relabelPickedAt: earlier, localActionInFlight: false, localActiveSeq: 0,
    thirtyMinuteSignalMs: 1800000, calendarWorkerUrl: 'https://worker.test',
    els: { relabelGrid: { children: buttons }, relabelHint: {} },
    isCaptureLocked: () => ctx.localActionInFlight,
    categoryShortLabel: x => x, formatTime: x => String(x), readableError: error => error.message,
    hasPairedWatchWorker: () => worker, workerDeviceToken: () => 'test-token', getPushInstallationId: () => 'test-installation',
    async fetch(url, init) { calls.push(JSON.parse(init.body)); return response; },
    startQuickBlock: (category, at) => calls.push({ switch: category, at }),
    relabelActiveBlock: category => calls.push({ relabel: category }),
    closeRelabelSheet() { ctx.closed = true; },
    saveState() {}, logAction() {}, render() {}, syncHomeScreenBadge() {}, syncBackgroundPushState() {}, scheduleActiveSignal() {}, updateSyncStatus() {},
  });
  vm.runInContext(source, ctx);
  return { ctx, buttons, calls, earlier, originalStart };
}

test('earlier time enables only the running domain and corrects its existing block', async () => {
  const { ctx, buttons, earlier } = setup();
  vm.runInContext('renderRelabelSheet()', ctx);
  assert.equal(buttons[0].disabled, false);
  assert.equal(buttons[1].disabled, true);
  await vm.runInContext('chooseRelabelDomain("fn")', ctx);
  assert.equal(ctx.state.active.id, 'b1');
  assert.equal(ctx.state.active.start, earlier.toISOString());
  assert.equal(ctx.state.actual.length, 0);
  assert.equal(ctx.closed, true);
});

test('later time can still split into the same domain', () => {
  const { ctx, calls } = setup();
  ctx.relabelPickedAt = new Date(Date.now() - 1800000);
  vm.runInContext('chooseRelabelDomain("fn")', ctx);
  assert.equal(calls[0].switch, 'fn');
  assert.equal(calls[0].at, ctx.relabelPickedAt);
});

test('wrong tap keeps the current domain disabled', () => {
  const { ctx, buttons } = setup();
  ctx.relabelMode = 'wrong';
  vm.runInContext('renderRelabelSheet()', ctx);
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].disabled, false);
});

test('future times and local history overlaps do not allow a correction', () => {
  const { ctx, buttons } = setup({ actual: [{ start: new Date(Date.now() - 10800000), end: new Date(Date.now() - 5400000) }] });
  vm.runInContext('renderRelabelSheet()', ctx);
  assert.ok(buttons.every(button => button.disabled));
  ctx.relabelPickedAt = new Date(Date.now() + 60000);
  assert.equal(vm.runInContext('forgotTimeValid(relabelPickedAt)', ctx), false);
});

test('paired save failure leaves the original start and sheet open for retry', async () => {
  const { ctx, originalStart } = setup({ worker: true, response: { ok: false, json: async () => ({ error: 'Overlap from another device' }) } });
  await vm.runInContext('chooseRelabelDomain("fn")', ctx);
  assert.equal(ctx.state.active.start, originalStart);
  assert.equal(ctx.closed, undefined);
  assert.match(ctx.els.relabelHint.textContent, /Overlap/);
  assert.equal(ctx.localActionInFlight, false);
});

test('an older worker response cannot claim an unsaved correction succeeded', async () => {
  const { ctx, originalStart } = setup({ worker: true });
  ctx.fetch = async () => ({ ok: true, json: async () => ({ active: { id: 'b1', start: originalStart } }) });
  await vm.runInContext('chooseRelabelDomain("fn")', ctx);
  assert.equal(ctx.state.active.start, originalStart);
  assert.match(ctx.els.relabelHint.textContent, /not confirmed/);
});

test('paired correction sends the existing id and saves the acknowledged start', async () => {
  const { ctx, earlier, calls } = setup({ worker: true });
  ctx.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ active: { id: 'b1', start: earlier.toISOString() } }) };
  };
  await vm.runInContext('chooseRelabelDomain("fn")', ctx);
  assert.deepEqual(calls[0], { blockId: 'b1', domain: 'fn', start: earlier.toISOString() });
  assert.equal(ctx.state.active.start, earlier.toISOString());
  assert.equal(ctx.closed, true);
});

test('direct Calendar correction verifies the active identity and patches only start', async () => {
  const { ctx, earlier, originalStart } = setup();
  ctx.state.google = { connected: true, actualCalendarId: 'actual' };
  ctx.state.active.googleEventId = 'ev1';
  ctx.ensureGoogleReady = async () => {};
  const requests = [];
  ctx.gcalFetch = async (path, init = {}) => {
    requests.push({ path, ...init });
    if (init.method === 'PATCH') return { start: { dateTime: earlier.toISOString() } };
    if (path.includes('/events?')) return { items: [] };
    return { id: 'ev1', start: { dateTime: originalStart }, extendedProperties: { private: { status: 'active', blockId: 'b1', ld8: 'fn' } } };
  };
  await vm.runInContext('chooseRelabelDomain("fn")', ctx);
  assert.equal(ctx.state.active.start, earlier.toISOString());
  assert.equal(requests.length, 3);
  assert.deepEqual(JSON.parse(requests[2].body), { start: { dateTime: earlier.toISOString(), timeZone: 'Asia/Bangkok' } });
});

test('direct Calendar correction cannot rewrite a block closed on another device', async () => {
  const { ctx, originalStart } = setup();
  ctx.state.google = { connected: true, actualCalendarId: 'actual' };
  ctx.state.active.googleEventId = 'ev1';
  ctx.ensureGoogleReady = async () => {};
  ctx.gcalFetch = async () => ({ id: 'ev1', extendedProperties: { private: { status: 'actual', blockId: 'b1', ld8: 'fn' } } });
  await vm.runInContext('chooseRelabelDomain("fn")', ctx);
  assert.equal(ctx.state.active.start, originalStart);
  assert.equal(ctx.closed, undefined);
  assert.match(ctx.els.relabelHint.textContent, /block changed/);
});
