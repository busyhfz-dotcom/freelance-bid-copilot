import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const COPILOT_SESSION_COOKIE = "bid_copilot_session";
const SESSION_CONTEXT = "bid-copilot-panel-session:v1";

function expectedKey() {
  const value = process.env.COPILOT_KEY || "";
  return value !== "change-me" && value.length >= 24 ? value : "";
}

function safeEqual(value: string, expected: string) {
  const actualBuffer = Buffer.from(value || "", "utf8");
  const expectedBuffer = Buffer.from(expected || "", "utf8");
  return actualBuffer.length === expectedBuffer.length
    && actualBuffer.length > 0
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isCopilotKey(value: string) {
  return safeEqual(value, expectedKey());
}

export function copilotSessionToken() {
  const key = expectedKey();
  return key ? createHmac("sha256", key).update(SESSION_CONTEXT).digest("base64url") : "";
}

export function isAuthorized(req: NextRequest) {
  const supplied = req.headers.get("x-copilot-key") || "";
  if (isCopilotKey(supplied)) return true;
  return safeEqual(req.cookies.get(COPILOT_SESSION_COOKIE)?.value || "", copilotSessionToken());
}

export function readsRequireAuthorization() {
  return process.env.COPILOT_PROTECT_READS !== "false";
}

export function isWorkerAuthorized(req: NextRequest) {
  const expected = process.env.WORKER_KEY || "";
  const supplied = req.headers.get("x-worker-key") || "";
  return expected.length >= 24 && supplied === expected;
}
