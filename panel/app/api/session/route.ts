import { NextRequest, NextResponse } from "next/server";
import {
  COPILOT_SESSION_COOKIE,
  REMEMBERED_SESSION_DURATION_SECONDS,
  createPanelSessionToken,
  isAuthorized,
  isPanelCredentials,
  panelAuthConfigured
} from "@/lib/auth";

export const runtime = "nodejs";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  priority: "high" as const
};
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
const failedAttempts = new Map<string, { count: number; startedAt: number }>();

function clientAddress(req: NextRequest) {
  return (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}

function isRateLimited(address: string) {
  const attempt = failedAttempts.get(address);
  if (!attempt) return false;
  if (Date.now() - attempt.startedAt >= ATTEMPT_WINDOW_MS) {
    failedAttempts.delete(address);
    return false;
  }
  return attempt.count >= MAX_ATTEMPTS;
}

function recordFailure(address: string) {
  const current = failedAttempts.get(address);
  if (!current || Date.now() - current.startedAt >= ATTEMPT_WINDOW_MS) {
    failedAttempts.set(address, { count: 1, startedAt: Date.now() });
    return;
  }
  failedAttempts.set(address, { ...current, count: current.count + 1 });
}

export async function GET(req: NextRequest) {
  const authorized = isAuthorized(req);
  return NextResponse.json({ authorized, configured: panelAuthConfigured() }, { status: authorized ? 200 : 401 });
}

export async function POST(req: NextRequest) {
  if (!panelAuthConfigured()) {
    return NextResponse.json({ error: "Panel login is not configured" }, { status: 503 });
  }
  const address = clientAddress(req);
  if (isRateLimited(address)) {
    return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });
  }
  const body = await req.json().catch(() => null) as { username?: string; password?: string; remember?: boolean } | null;
  const username = typeof body?.username === "string" ? body.username.slice(0, 128) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 512) : "";
  if (!isPanelCredentials(username, password)) {
    recordFailure(address);
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  failedAttempts.delete(address);
  const remember = body?.remember === true;
  const response = NextResponse.json({ authorized: true, remembered: remember });
  response.cookies.set(COPILOT_SESSION_COOKIE, createPanelSessionToken(remember), {
    ...COOKIE_OPTIONS,
    ...(remember ? { maxAge: REMEMBERED_SESSION_DURATION_SECONDS } : {})
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authorized: false });
  response.cookies.set(COPILOT_SESSION_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
