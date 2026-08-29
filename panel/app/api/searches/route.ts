import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { listSearches, saveSearch } from "@/lib/store";
import type { SearchRecord, SearchResultItem } from "@/lib/types";

export const runtime = "nodejs";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Copilot-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET(req: NextRequest) {
  if (readsRequireAuthorization() && !isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized panel key" }, { status: 401, headers: cors() });
  }
  return NextResponse.json({ searches: await listSearches() }, { headers: cors() });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized panel key" }, { status: 401, headers: cors() });
  }
  const body = await req.json().catch(() => null) as null | {
    site?: string;
    query?: string;
    pageUrl?: string;
    results?: SearchResultItem[];
  };
  if (!body?.site || !body.pageUrl || !Array.isArray(body.results)) {
    return NextResponse.json({ error: "Invalid search record" }, { status: 400, headers: cors() });
  }
  const searchedAt = new Date().toISOString();
  const id = createHash("sha1")
    .update(`${body.site}|${body.query || ""}|${body.pageUrl}|${searchedAt}`)
    .digest("hex")
    .slice(0, 18);
  const record: SearchRecord = {
    id,
    site: body.site,
    query: String(body.query || ""),
    pageUrl: body.pageUrl,
    resultCount: body.results.length,
    searchedAt,
    results: body.results.slice(0, 100)
  };
  await saveSearch(record);
  return NextResponse.json(record, { status: 201, headers: cors() });
}
