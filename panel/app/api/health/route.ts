import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { resolveAIProvider } from "@/lib/ai-provider";
import packageJson from "@/package.json";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized extension key" }, { status: 401 });
  const ai = resolveAIProvider();
  return NextResponse.json({
    ok: true,
    version: packageJson.version,
    aiConfigured: ai.configured,
    aiProvider: ai.provider,
    aiModel: ai.model || null
  }, { headers: { "Cache-Control": "no-store" } });
}
