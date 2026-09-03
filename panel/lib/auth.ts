import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const COPILOT_SESSION_COOKIE = "bid_copilot_session";

const SESSION_VERSION = 2;
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
export const REMEMBERED_SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;

function safeEqual(value: string, expected: string) {
  const actualBuffer = Buffer.from(value || "", "utf8");
  const expectedBuffer = Buffer.from(expected || "", "utf8");
  return actualBuffer.length === expectedBuffer.length
    && actualBuffer.length > 0
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function copilotKey() {
  const value = process.env.COPILOT_KEY || "";
  return value !== "change-me" && value.length >= 24 ? value : "";
}

function panelUsername() {
  return (process.env.PANEL_USERNAME || "").trim();
}

function panelPassword() {
  const value = process.env.PANEL_PASSWORD || "";
  return value.length >= 12 ? value : "";
}

function panelSessionSecret() {
  const value = process.env.PANEL_SESSION_SECRET || "";
  return value.length >= 32 ? value : "";
}

function sessionSignature(payload: string) {
  const secret = panelSessionSecret();
  return secret ? createHmac("sha256", secret).update(payload).digest("base64url") : "";
}

export function panelAuthConfigured() {
  return Boolean(panelUsername() && panelPassword() && panelSessionSecret());
}

export function isPanelCredentials(username: string, password: string) {
  if (!panelAuthConfigured()) return false;
  return safeEqual(username.trim(), panelUsername()) && safeEqual(password, panelPassword());
}

export function createPanelSessionToken(remember: boolean) {
  if (!panelAuthConfigured()) return "";
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + (remember ? REMEMBERED_SESSION_DURATION_SECONDS : SESSION_DURATION_SECONDS);
  const payload = Buffer.from(JSON.stringify({ v: SESSION_VERSION, iat: issuedAt, exp: expiresAt }), "utf8").toString("base64url");
  return `${payload}.${sessionSignature(payload)}`;
}

export function isPanelSessionToken(token: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !panelAuthConfigured()) return false;
  if (!safeEqual(signature, sessionSignature(payload))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: number; iat?: number; exp?: number };
    const now = Math.floor(Date.now() / 1000);
    return parsed.v === SESSION_VERSION
      && Number.isInteger(parsed.iat)
      && Number.isInteger(parsed.exp)
      && Number(parsed.iat) <= now + 60
      && Number(parsed.exp) > now;
  } catch {
    return false;
  }
}

export function isCopilotKey(value: string) {
  return safeEqual(value, copilotKey());
}

export function isAuthorized(req: NextRequest) {
  const supplied = req.headers.get("x-copilot-key") || "";
  return isCopilotKey(supplied)
    || isPanelSessionToken(req.cookies.get(COPILOT_SESSION_COOKIE)?.value || "");
}

export function readsRequireAuthorization() {
  return process.env.COPILOT_PROTECT_READS !== "false";
}

export function isWorkerAuthorized(req: NextRequest) {
  const expected = process.env.WORKER_KEY || "";
  const supplied = req.headers.get("x-worker-key") || "";
  return expected.length >= 24 && safeEqual(supplied, expected);
}
