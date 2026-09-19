import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDeadManMonitor } from "../worker/src/dead-man-monitor.mjs";
import { createRecovery } from "../worker/src/recovery.mjs";
import { createAtomicWriter } from "../worker/src/durable-state.mjs";

function fixture(options = {}) {
  let time = 0;
  let wall = 1_700_000_000_000;
  const monitor = createDeadManMonitor({ now: () => time, wallNow: () => wall, ...options });
  return { monitor, advance(ms) { time += ms; wall += ms; }, wall(ms) { wall = ms; } };
}

test("startup and idle scheduler stalls expire after fifteen minutes", () => {
  const f = fixture();
  f.advance(899_999);
  assert.equal(f.monitor.snapshot().stale, false);
  f.advance(1);
  assert.equal(f.monitor.snapshot().reason, "scan_progress_stale");
});

test("failed or blocked cycles cannot refresh successful scan time", () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) {
    f.monitor.startCycle();
    f.advance(120_000);
    f.monitor.completeCycle([]);
    f.monitor.endCycle();
  }
  assert.equal(f.monitor.snapshot().reason, "scan_success_stale");
  assert.equal(f.monitor.snapshot().lastSuccessfulScanAt, "");
});

test("empty successful scans and a single healthy marketplace reset success", () => {
  const f = fixture();
  f.advance(890_000);
  f.monitor.startCycle();
  f.monitor.completeCycle(["kaya"]);
  f.monitor.endCycle();
  assert.equal(f.monitor.snapshot().stale, false);
  assert.deepEqual(f.monitor.snapshot().successfulSites, ["kaya"]);
  assert.equal(f.monitor.snapshot().successAgeMs, 0);
});

test("a hung active cycle retains the earlier scan watchdog deadline", () => {
  const f = fixture();
  f.monitor.startCycle();
  f.advance(480_000);
  assert.equal(f.monitor.snapshot().reason, "scan_watchdog_restart");
});

test("slow configured polling has time for one full cycle", () => {
  const f = fixture({ scanIntervalMs: 3_600_000, cycleTimeoutMs: 480_000 });
  f.advance(900_000);
  assert.equal(f.monitor.snapshot().stale, false);
  assert.equal(f.monitor.snapshot().timeoutMs, 4_080_000);
});

test("wall clock jumps neither mask nor trigger a restart", () => {
  const f = fixture();
  f.wall(0);
  f.advance(900_000);
  assert.equal(f.monitor.snapshot().stale, true);
});

test("all watchdogs share one exit; persistence precedes reporting and close", async () => {
  const events = [];
  const recovery = createRecovery({
    persist: async () => { events.push("persist"); },
    report: async () => { events.push("report"); },
    close: async () => { events.push("close"); },
    onStart: () => events.push("start"), exit: code => events.push(code)
  });
  const first = recovery.request("dead-man");
  const second = recovery.request("OOM");
  assert.equal(first, second);
  await first;
  assert.deepEqual(events, ["start", "persist", "report", "close", 1]);
});

test("deadline is armed before hanging persistence and forces exit", async () => {
  let fire;
  const events = [];
  const recovery = createRecovery({
    schedule: callback => { fire = callback; events.push("armed"); return 1; },
    cancel: () => {}, persist: () => new Promise(() => {}),
    report: async () => {}, close: async () => {},
    onStart: () => events.push("start"), exit: code => events.push(code), log: () => {}
  });
  void recovery.request("hung disk");
  fire();
  assert.deepEqual(events, ["armed", "start", 1]);
  assert.equal(recovery.active, true);
});

test("hung reporting or browser close cannot defeat the exit deadline", async () => {
  let fire;
  const exits = [];
  const recovery = createRecovery({
    schedule: callback => { fire = callback; return 1; }, cancel: () => {},
    persist: async () => {}, report: () => new Promise(() => {}),
    close: () => new Promise(() => {}), exit: code => exits.push(code), log: () => {}
  });
  void recovery.request("hung browser");
  await new Promise(resolve => setImmediate(resolve));
  fire();
  assert.deepEqual(exits, [1]);
});

test("failed cleanup still exits and does not duplicate recovery", async () => {
  const exits = [];
  const fail = async () => { throw new Error("offline"); };
  const recovery = createRecovery({ persist: fail, report: fail, close: fail,
    exit: code => exits.push(code), log: () => {} });
  await recovery.request("failure");
  await recovery.request("again");
  assert.deepEqual(exits, [1]);
});

test("atomic state writer serializes concurrent snapshots and preserves private files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-state-"));
  try {
    const file = path.join(dir, "outbox.json");
    const write = createAtomicWriter();
    await Promise.all(Array.from({length: 20}, (_, n) => write(file, JSON.stringify([{ n }]))));
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), [{ n: 19 }]);
    assert.deepEqual(await fs.readdir(dir), ["outbox.json"]);
    if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await assert.rejects(write(file, undefined));
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), [{ n: 19 }]);
    await write(file, "[]");
    assert.equal(await fs.readFile(file, "utf8"), "[]");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
