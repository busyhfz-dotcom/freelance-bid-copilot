import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { listProjects, updateProjectStatus } from "@/lib/store";
import type { ProjectRecord } from "@/lib/types";

export const runtime = "nodejs";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Copilot-Key",
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS"
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET(req: NextRequest) {
  if (readsRequireAuthorization() && !isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized panel key" }, { status: 401, headers: cors() });
  }
  return NextResponse.json({ projects: await listProjects() }, { headers: cors() });
}

export async function PATCH(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized extension key" }, { status: 401, headers: cors() });

  const body = await req.json().catch(() => ({}));
  const allowed: ProjectRecord["status"][] = ["generated", "filled", "submitted", "error"];
  if (!body?.url || !allowed.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status update" }, { status: 400, headers: cors() });
  }
  return NextResponse.json({ project: await updateProjectStatus(body.url, body.status) }, { headers: cors() });
}
