import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createDeadManMonitor } from '../worker/src/dead-man-monitor.mjs';
import { createRecovery } from '../worker/src/recovery.mjs';
import { createAtomicWriter } from '../worker/src/durable-state.mjs';
import { blockedRetryDelayMs, describeWorkerError } from '../worker/src/runtime-policy.mjs';
import { projectSeenKeys } from '../worker/src/candidate-policy.mjs';

const workerDir = fileURLToPath(new URL('../worker/src/', import.meta.url));
const original = await fs.readFile(path.join(workerDir, 'index.mjs'), 'utf8');
const source = original.slice(0, original.indexOf('main().catch'))
  .replace(/^import .*;\r?\n/gm, '')
  .replace('import.meta.dirname', JSON.stringify(workerDir));

function harness(dir, fetchImpl) {
  let elapsed = 0;
  let healthHandler;
  const exits = [];
  const calls = [];
  const fakeBrowser = { close: async () => {} };
  const sandbox = {
    fs, path, Buffer, AbortController, setTimeout, clearTimeout,
    http: { createServer(handler) { healthHandler = handler; return { listen() {} }; } },
    setInterval: () => 1, clearInterval: () => {},
    process: { env: { BROWSER_DATA_DIR: dir, PANEL_URL: 'http://127.0.0.1',
      WORKER_KEY: 'test-worker-key-at-least-24-chars', COPILOT_KEY: 'test' },
      once() {}, memoryUsage: () => ({ heapUsed: 0, heapTotal: 0, rss: 0, external: 0 }),
      exit: code => exits.push(code) },
    console: { log() {}, error() {} },
    chromium: { launch: async () => fakeBrowser },
    blockedRetryDelayMs, describeWorkerError, projectSeenKeys,
    createAtomicWriter,
    createDeadManMonitor: options => createDeadManMonitor({ ...options, now: () => elapsed }),
    createRecovery: options => createRecovery({ ...options, exit: code => exits.push(code), log() {} }),
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body || '{}') });
      if (fetchImpl) return fetchImpl(url, options);
      return { ok: true, json: async () => ({ created: true }) };
    }
  };
  const api = vm.runInNewContext(source + `\n({ main, guardedScanCycle, enqueuePendingNotifications,
    flushPendingNotifications, requestWorkerRecycle, enforceScanWatchdog, persistContext,
    readPersistedArray, snapshot: () => deadMan.snapshot(),
    setScanSite: value => { scanSite = value; },
    seed: () => { stateLoaded = true; },
    setContext: (site, context) => contexts.set(site, context),
    idle: () => !scanBusy,
    setPrevious: value => { lastRestart = value; },
    state: () => ({ stopping, lastScanAt, pendingNotifications, lastRestart })
  })`, sandbox);
  return { ...api, calls, exits, advance: ms => { elapsed += ms; }, health() {
    let status;
    let body;
    healthHandler({ url: '/health' }, { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } });
    return { status, body };
  } };
}

async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worker-integration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const project = { site: 'kaya', title: 'Example project', url: 'https://kaya.ir/projects/example' };

test('real scan cycles distinguish empty successes, blocks, errors and scheduler stalls', async t => {
  const h = harness(await temporary(t));
  h.setScanSite(async site => ({ candidates: [], successful: site === 'kaya' }));
  await h.guardedScanCycle();
  const successfulAt = h.snapshot().lastSuccessfulScanAt;
  assert.ok(successfulAt);
  assert.equal(h.health().status, 200);
  h.advance(900_000);
  h.setScanSite(async site => {
    if (site === 'kaya') throw new Error('listing failed');
    return { candidates: [], successful: false };
  });
  await h.guardedScanCycle();
  assert.equal(h.snapshot().lastSuccessfulScanAt, successfulAt);
  assert.equal(h.snapshot().reason, 'scan_success_stale');
  assert.equal(h.health().status, 503);
  assert.equal(h.health().body.lastSuccessfulScanAt, successfulAt);
  assert.equal(h.health().body.deadMan.timeoutMs, 900_000);
  await h.enforceScanWatchdog();
  assert.deepEqual(h.exits, [1]);
  const count = h.calls.length;
  await h.guardedScanCycle();
  assert.equal(h.calls.length, count);
});

test('recycle retains durable outbox and last good auth when browser state fails', async t => {
  const dir = await temporary(t);
  const auth = path.join(dir, 'auth/kaya.storage-state.json');
  await fs.mkdir(path.dirname(auth), { recursive: true });
  await fs.writeFile(auth, '{"cookies":["last-good"]}');
  const h = harness(dir);
  h.seed();
  await h.enqueuePendingNotifications([project]);
  h.setContext('kaya', { storageState: async () => { throw new Error('browser unavailable'); } });
  await h.requestWorkerRecycle('scan_success_stale');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'state/pending-notifications.json'))), [project]);
  assert.equal(await fs.readFile(auth, 'utf8'), '{"cookies":["last-good"]}');
  assert.deepEqual(h.exits, [1]);
  assert.equal(h.calls.filter(c => c.url.endsWith('/api/reports')).length, 1);
  assert.equal(h.calls.some(c => /telegram/i.test(c.url)), false);

  const restarted = harness(dir);
  restarted.setScanSite(async () => ({ candidates: [], successful: true }));
  await restarted.main();
  while (!restarted.idle()) await new Promise(resolve => setImmediate(resolve));
  assert.equal(restarted.calls.filter(c => c.url.endsWith('/api/automation/candidates')).length, 1);
  assert.equal(restarted.state().pendingNotifications.length, 0);
  await restarted.requestWorkerRecycle('scan_success_stale');
  assert.equal(restarted.calls.filter(c => c.body.eventType === 'worker_recycle').length, 0);
});

test('an in-flight delivery acknowledged during recovery remains retryable', async t => {
  let acknowledge;
  const h = harness(await temporary(t), async url => {
    if (url.endsWith('/api/automation/candidates')) await new Promise(resolve => { acknowledge = resolve; });
    return { ok: true, json: async () => ({ created: true }) };
  });
  h.seed();
  await h.enqueuePendingNotifications([project]);
  const flush = h.flushPendingNotifications();
  await h.requestWorkerRecycle('OOM');
  acknowledge();
  await flush;
  assert.equal(h.state().pendingNotifications.length, 1);
});

test('corrupt outbox is rejected rather than overwritten as empty', async t => {
  const dir = await temporary(t);
  const file = path.join(dir, 'state/pending-notifications.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '[corrupt');
  const h = harness(dir);
  await assert.rejects(h.main(), /Cannot restore notification outbox/);
  await h.requestWorkerRecycle('startup failure');
  assert.equal(await fs.readFile(file, 'utf8'), '[corrupt');
});
