import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, isWorkerAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { approvalId } from "@/lib/approval-policy";
import { createReport } from "@/lib/reports";
import { attachTelegramMessage, listBidApprovals, queueBidApproval, saveReport } from "@/lib/store";
import { sendProjectApprovalRequest } from "@/lib/telegram";
import type { BidApprovalRecord, ProjectRecord } from "@/lib/types";

export const runtime = "nodejs";

function identityText(value = "") {
  return String(value || "").toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function canonicalUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|ref|source|from|campaign|tracking|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return String(value || "").trim();
  }
}

function duplicateProject(a: ProjectRecord, b: ProjectRecord) {
  if (canonicalUrl(a.url) === canonicalUrl(b.url)) return true;
  return identityText(a.site) === identityText(b.site)
    && identityText(a.title).length >= 5
    && identityText(a.title) === identityText(b.title);
}

function blockedCountry(project: ProjectRecord) {
  const fields = project as ProjectRecord & Record<string, unknown>;
  const location = [
    fields.country,
    fields.clientCountry,
    fields.employerCountry,
    fields.location,
    fields.clientLocation,
    fields.employerLocation,
    fields.clientInfo
  ].filter(Boolean).join(" ");
  return /(?:^|[\s،,:;()\-])(پاکستان|بنگلادش|هند|pakistan|bangladesh|india|indian|pakistani|bangladeshi)(?=$|[\s،,:;()\-])/i.test(location);
}

export async function GET(req: NextRequest) {
  if (readsRequireAuthorization() && !isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ approvals: await listBidApprovals(150) });
}

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req)) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  const project = await req.json().catch(() => null) as ProjectRecord | null;
  if (!project?.url || !project.title || !project.site) {
    return NextResponse.json({ error: "Invalid project notification" }, { status: 422 });
  }

  if (blockedCountry(project)) return NextResponse.json({ created: false, skipped: "blocked_country" });

  const existing = (await listBidApprovals(250)).find((item) => duplicateProject(item.project, project));
  if (existing) return NextResponse.json({ approval: existing, created: false });

  const now = new Date();
  const record: BidApprovalRecord = {
    id: approvalId(project),
    projectId: project.id || project.url,
    url: project.url,
    site: project.site,
    title: project.title,
    status: "notified",
    score: project.jobScore || 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3650 * 24 * 60 * 60_000).toISOString(),
    updatedAt: now.toISOString(),
    approvalTokenHash: "notification-only",
    attempts: 0,
    project
  };

  try {
    const message = await sendProjectApprovalRequest(record, "");
    const queued = await queueBidApproval(record);
    const attached = await attachTelegramMessage(record.id, message.chatId, message.messageId);
    await saveReport(createReport({
      category: "telegram",
      eventType: "new_project_sent",
      level: "success",
      title: `ارسال آگهی جدید: ${record.title}`,
      message: message.text,
      site: record.site,
      approvalId: record.id,
      projectId: record.projectId,
      projectTitle: record.title,
      status: "notified",
      metadata: {
        telegramMessageId: message.messageId,
        budget: record.project.budget || "نامشخص"
      }
    }));
    return NextResponse.json({ approval: attached || queued.record, created: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram delivery failed";
    await saveReport(createReport({
      category: "telegram",
      eventType: "new_project_delivery_failed",
      level: "error",
      title: `ارسال آگهی جدید ناموفق: ${record.title}`,
      message,
      site: record.site,
      projectId: record.projectId,
      projectTitle: record.title,
      status: "failed"
    })).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
