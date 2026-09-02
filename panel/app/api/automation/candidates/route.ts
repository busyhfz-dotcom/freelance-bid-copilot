import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, isWorkerAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { approvalGuardReasons, approvalId, canQueueForApproval, createApprovalToken } from "@/lib/approval-policy";
import { createReport } from "@/lib/reports";
import { attachTelegramMessage, discardUnsentApproval, listBidApprovals, queueBidApproval, saveReport } from "@/lib/store";
import { sendApprovalRequest } from "@/lib/telegram";
import type { BidApprovalRecord, ProjectRecord } from "@/lib/types";
import { countApprovalsForDay } from "@/lib/daily-approval-policy";

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
    return NextResponse.json({ error: "Project did not pass automation guard", reasons: project ? approvalGuardReasons(project, minimumScore) : ["missing_project"] }, { status: 422 });
  }
  const pendingLimit = integerEnv("AUTOMATION_MAX_PENDING", 10, 5, 25);
  const approvals = await listBidApprovals(100);
  const dailyLimit = integerEnv("AUTOMATION_DAILY_TELEGRAM_LIMIT", 10, 5, 10);
  if (countApprovalsForDay(approvals) >= dailyLimit) {
    return NextResponse.json({ error: "Daily Telegram approval limit reached" }, { status: 429 });
  }
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
    const attached = await attachTelegramMessage(record.id, message.chatId, message.messageId);
    await saveReport(createReport({
      category: "telegram",
      eventType: "approval_sent",
      level: "success",
      title: `ارسال آگهی برای تأیید: ${record.title}`,
      message: message.text,
      site: record.site,
      approvalId: record.id,
      projectId: record.projectId,
      projectTitle: record.title,
      status: "pending",
      metadata: {
        telegramMessageId: message.messageId,
        score: record.score,
        budget: record.project.budget || "نامشخص",
        recommendedPrice: record.project.recommendedPrice || "نامشخص"
      }
    }));
    return NextResponse.json({ approval: attached || record, created: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram delivery failed";
    await saveReport(createReport({
      category: "telegram",
      eventType: "approval_delivery_failed",
      level: "error",
      title: `ارسال تلگرام ناموفق: ${record.title}`,
      message,
      site: record.site,
      approvalId: record.id,
      projectId: record.projectId,
      projectTitle: record.title,
      status: "failed"
    })).catch(() => undefined);
    await discardUnsentApproval(record.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
