import { NextRequest, NextResponse } from "next/server";
import { COPILOT_SESSION_COOKIE, copilotSessionToken, isAuthorized, isCopilotKey } from "@/lib/auth";

export const runtime = "nodejs";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/"
};

export async function GET(req: NextRequest) {
  const authorized = isAuthorized(req);
  return NextResponse.json({ authorized }, { status: authorized ? 200 : 401 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { key?: string } | null;
  if (!isCopilotKey(body?.key || "")) return NextResponse.json({ error: "Invalid access key" }, { status: 401 });
  const response = NextResponse.json({ authorized: true });
  response.cookies.set(COPILOT_SESSION_COOKIE, copilotSessionToken(), { ...COOKIE_OPTIONS, maxAge: 60 * 60 * 24 * 30 });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authorized: false });
  response.cookies.set(COPILOT_SESSION_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
