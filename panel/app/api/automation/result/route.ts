import { NextRequest, NextResponse } from "next/server";
import { isWorkerAuthorized } from "@/lib/auth";
import { createReport } from "@/lib/reports";
import { finishBidSubmission, saveReport } from "@/lib/store";
import { sendSubmissionResult } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req)) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.id || !["submitted", "failed"].includes(body.status)) return NextResponse.json({ error: "Invalid result" }, { status: 400 });
  const approval = await finishBidSubmission(String(body.id), body.status, String(body.error || "").slice(0, 1000));
  if (!approval) return NextResponse.json({ error: "Submission claim not found" }, { status: 409 });
  const delivery = await sendSubmissionResult(approval).catch(() => null);
  const submitted = approval.status === "submitted";
  await saveReport(createReport({
    category: delivery ? "telegram" : "bid",
    eventType: "submission_result",
    level: submitted ? "success" : "error",
    title: submitted ? "بید با موفقیت ثبت شد" : "ثبت بید ناموفق بود",
    message: delivery?.text || (submitted
      ? `بید پروژه «${approval.project.title}» ثبت و تأیید شد.`
      : `ثبت بید پروژه «${approval.project.title}» ناموفق بود: ${approval.lastError || "خطای نامشخص"}`),
    site: approval.site,
    workerId: approval.claimedBy,
    approvalId: approval.id,
    projectId: approval.projectId,
    projectTitle: approval.project.title,
    status: approval.status,
    metadata: {
      telegramDelivered: Boolean(delivery),
      telegramMessageId: delivery?.messageId || null
    }
  }));
  return NextResponse.json({ approval });
}
