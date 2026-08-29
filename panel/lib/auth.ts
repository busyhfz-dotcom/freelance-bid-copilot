import type { NextRequest } from "next/server";

export function isAuthorized(req: NextRequest) {
  const expected = process.env.COPILOT_KEY || "change-me";
  const supplied = req.headers.get("x-copilot-key") || "";
  return supplied.length > 0 && supplied === expected;
}

export function readsRequireAuthorization() {
  return process.env.COPILOT_PROTECT_READS !== "false";
}

export function isWorkerAuthorized(req: NextRequest) {
  const expected = process.env.WORKER_KEY || "";
  const supplied = req.headers.get("x-worker-key") || "";
  return expected.length >= 24 && supplied === expected;
}
