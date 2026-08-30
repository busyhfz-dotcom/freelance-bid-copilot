import test from "node:test";
import assert from "node:assert/strict";
import { blockedRetryDelayMs, describeWorkerError } from "../worker/src/runtime-policy.mjs";

test("Worker turns aborted requests into a clear timeout message", () => {
  assert.equal(describeWorkerError(new DOMException("This operation was aborted", "AbortError")), "Worker request timed out; the current operation stopped safely");
  assert.equal(describeWorkerError(new Error("ordinary failure")), "ordinary failure");
});

test("blocked marketplace retry delay is bounded", () => {
  assert.equal(blockedRetryDelayMs(undefined), 15 * 60_000);
  assert.equal(blockedRetryDelayMs(1), 5 * 60_000);
  assert.equal(blockedRetryDelayMs(999), 240 * 60_000);
});
