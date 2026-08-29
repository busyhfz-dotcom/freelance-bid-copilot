import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { generateBid } from "@/lib/bid";
import { saveProject } from "@/lib/store";
import type { ProjectPayload, ProjectRecord } from "@/lib/types";

export const runtime = "nodejs";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Copilot-Key",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized extension key" }, { status: 401, headers: cors() });
  }

  const project = (await req.json()) as ProjectPayload;
  if (!project?.title || !project?.url) {
    return NextResponse.json({ error: "Missing title or URL" }, { status: 400, headers: cors() });
  }
  project.description = project.description || "";

  const generated = await generateBid(project);
  const id = project.id || createHash("sha1").update(`${project.site}|${project.url}`).digest("hex").slice(0, 18);
  const record: ProjectRecord = {
    ...project,
    ...generated,
    id,
    capturedAt: project.capturedAt || new Date().toISOString(),
    status: "generated"
  };
  await saveProject(record);
  return NextResponse.json(record, { headers: cors() });
}
