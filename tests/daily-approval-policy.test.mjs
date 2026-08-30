import test from "node:test";
import assert from "node:assert/strict";
import { approvalDayKey, countApprovalsForDay } from "../panel/lib/daily-approval-policy.ts";

test("daily Telegram approvals use the Tehran calendar boundary", () => {
  assert.notEqual(
    approvalDayKey("2026-08-29T20:29:59.000Z"),
    approvalDayKey("2026-08-29T20:30:00.000Z")
  );
  const approvals = [
    { createdAt: "2026-08-29T20:29:59.000Z" },
    { createdAt: "2026-08-29T20:30:00.000Z" },
    { createdAt: "2026-08-30T12:00:00.000Z" }
  ];
  assert.equal(countApprovalsForDay(approvals, "2026-08-30T10:00:00.000Z"), 2);
});
