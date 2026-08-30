import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWorkerAlert } from "../panel/lib/worker-alert-policy.ts";

const start = Date.parse("2026-08-30T10:00:00.000Z");
const cooldown = 30 * 60_000;
const blocked = {
  status: "blocked",
  currentSite: "ponisha",
  message: "ponisha: captcha; manual login or CAPTCHA action is required",
  sessionState: { ponisha: "captcha", kaya: "ready" }
};

test("identical Worker alerts are persisted and suppressed during cooldown", () => {
  const first = evaluateWorkerAlert(undefined, blocked, start, cooldown);
  assert.equal(first.action, "alert");
  const scanning = evaluateWorkerAlert(first.alertState, { ...blocked, status: "scanning" }, start + 60_000, cooldown);
  assert.equal(scanning.action, "none");
  const repeated = evaluateWorkerAlert(scanning.alertState, blocked, start + 2 * 60_000, cooldown);
  assert.equal(repeated.action, "none");
  const afterCooldown = evaluateWorkerAlert(repeated.alertState, blocked, start + cooldown, cooldown);
  assert.equal(afterCooldown.action, "alert");
});

test("a changed failure alerts immediately and a ready site recovers once", () => {
  const first = evaluateWorkerAlert(undefined, blocked, start, cooldown);
  const changed = evaluateWorkerAlert(first.alertState, { ...blocked, message: "ponisha: login_required" }, start + 60_000, cooldown);
  assert.equal(changed.action, "alert");
  const recovered = evaluateWorkerAlert(changed.alertState, {
    status: "scanning",
    currentSite: "ponisha",
    message: "ponisha: session ready",
    sessionState: { ponisha: "ready", kaya: "ready" }
  }, start + 2 * 60_000, cooldown);
  assert.equal(recovered.action, "recovered");
  const stable = evaluateWorkerAlert(recovered.alertState, {
    status: "idle",
    currentSite: "ponisha",
    sessionState: { ponisha: "ready", kaya: "ready" }
  }, start + 3 * 60_000, cooldown);
  assert.equal(stable.action, "none");
});
