import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, isWorkerAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { approvalId, canQueueForApproval, createApprovalToken } from "@/lib/approval-policy";
import { attachTelegramMessage, discardUnsentApproval, listBidApprovals, queueBidApproval } from "@/lib/store";
import { sendApprovalRequest } from "@/lib/telegram";
import type { BidApprovalRecord, ProjectRecord } from "@/lib/types";

export const runtime = "nodejs";

function integerEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

export async function GET(req: NextRequest) {
  if (readsRequireAuthorization() && !isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ approvals: await listBidApprovals(150) });
}

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req)) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  const project = await req.json().catch(() => null) as ProjectRecord | null;
  const minimumScore = integerEnv("AUTOMATION_MIN_SCORE", 72, 65, 95);
  if (!project || !canQueueForApproval(project, minimumScore)) {
    return NextResponse.json({ error: "Project did not pass automation guard" }, { status: 422 });
  }
  const pendingLimit = integerEnv("AUTOMATION_MAX_PENDING", 10, 5, 25);
  const approvals = await listBidApprovals(100);
  if (approvals.filter((item) => item.status === "pending" || item.status === "approved").length >= pendingLimit) {
    return NextResponse.json({ error: "Approval queue is full" }, { status: 429 });
  }
  const { token, hash } = createApprovalToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + integerEnv("APPROVAL_TTL_MINUTES", 30, 5, 180) * 60_000).toISOString();
  const record: BidApprovalRecord = {
    id: approvalId(project), projectId: project.id, url: project.url, site: project.site, title: project.title,
    status: "pending", score: project.jobScore || 0, createdAt: now.toISOString(), expiresAt,
    updatedAt: now.toISOString(), approvalTokenHash: hash, attempts: 0, project
  };
  const queued = await queueBidApproval(record);
  if (!queued.created) return NextResponse.json({ approval: queued.record, created: false });
  try {
    const message = await sendApprovalRequest(record, token);
    const attached = await attachTelegramMessage(record.id, String(message.chat.id), message.message_id);
    return NextResponse.json({ approval: attached || record, created: true }, { status: 201 });
  } catch (error) {
    await discardUnsentApproval(record.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Telegram delivery failed" }, { status: 502 });
  }
}
