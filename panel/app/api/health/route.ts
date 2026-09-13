import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import packageJson from "@/package.json";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized extension key" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    version: packageJson.version,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim())
  }, { headers: { "Cache-Control": "no-store" } });
}
