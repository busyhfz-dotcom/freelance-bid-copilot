import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { BidGenerationError, generateBid } from "@/lib/bid";
import { listProjects, saveProject } from "@/lib/store";
import type { ProjectPayload, ProjectRecord } from "@/lib/types";
import { comesFromBlockedCountry } from "@/lib/candidate-policy";

export const runtime = "nodejs";
export const maxDuration = 120;

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
  if (comesFromBlockedCountry(project)) {
    return NextResponse.json({ error: "Projects from blocked client countries are not accepted" }, { status: 422, headers: cors() });
  }
  project.description = project.description || "";

  const previous = (await listProjects()).filter((item) => item.url !== project.url).slice(0, 30)
    .map((item) => ({ proposal: item.bid, title: item.title, createdAt: item.capturedAt }));
  const generationStartedAt = Date.now();
  let generated;
  try {
    generated = await generateBid(project, previous);
  } catch (error) {
    const code = error instanceof BidGenerationError ? error.code : "AI_GENERATION_FAILED";
    console.error("[bid-generation]", { code, site: project.site, durationMs: Date.now() - generationStartedAt });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bid generation failed", code }, { status: 503, headers: cors() });
  }
  const id = project.id || createHash("sha1").update(`${project.site}|${project.url}`).digest("hex").slice(0, 18);
  const record: ProjectRecord = {
    ...project,
    ...generated,
    id,
    capturedAt: project.capturedAt || new Date().toISOString(),
    status: "generated"
  };
  await saveProject(record);
  console.info("[bid-generation]", {
    outcome: "success",
    site: project.site,
    durationMs: Date.now() - generationStartedAt,
    decision: record.decision,
    quality: record.bidQualityScore
  });
  return NextResponse.json(record, { headers: cors() });
}
