import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hashApprovalToken, parseTelegramDecision } from "@/lib/approval-policy";
import { createReport } from "@/lib/reports";
import { attachBidTelegramMessage, decideBidApproval, decideProjectApproval, revertBidApprovalToProjectPending, saveReport } from "@/lib/store";
import { answerCallback, markTelegramDecision, sendBidApprovalRequest } from "@/lib/telegram";

export const runtime = "nodejs";

function safeEqual(a: string, b: string) {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  const suppliedSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!expectedSecret || !safeEqual(expectedSecret, suppliedSecret)) return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
  const update = await req.json().catch(() => ({}));
  const callback = update?.callback_query;
  if (!callback) return NextResponse.json({ ok: true });
  const allowedUser = process.env.TELEGRAM_ALLOWED_USER_ID?.trim();
  const allowedChat = process.env.TELEGRAM_CHAT_ID?.trim();
  const userId = String(callback.from?.id || "");
  const chatId = String(callback.message?.chat?.id || "");
  if (!allowedUser || !allowedChat || userId !== allowedUser || chatId !== allowedChat) {
    await answerCallback(String(callback.id), "این دکمه برای این حساب مجاز نیست.", true).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }
  const parsed = parseTelegramDecision(String(callback.data || ""));
  if (!parsed) {
    await answerCallback(String(callback.id), "این درخواست معتبر یا فعال نیست.", true).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }
  const tokenHash = hashApprovalToken(parsed.token);
  const telegramMessageId = Number(callback.message.message_id);
  const projectStage = parsed.decision === "project_approve" || parsed.decision === "project_reject";

  if (projectStage) {
    const approved = parsed.decision === "project_approve";
    const ttlMinutes = Math.min(180, Math.max(5, Number(process.env.APPROVAL_TTL_MINUTES) || 30));
    const renewedExpiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    const decided = await decideProjectApproval(parsed.approvalId, approved ? "approve" : "reject", tokenHash, chatId, renewedExpiresAt);
    if (!decided) {
      await answerCallback(String(callback.id), "این آگهی منقضی یا قبلاً بررسی شده است.", true).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (!approved) {
      await Promise.allSettled([
        answerCallback(String(callback.id), "آگهی رد شد."),
        markTelegramDecision(chatId, telegramMessageId, false)
      ]);
      await saveReport(createReport({
        category: "telegram", eventType: "project_rejected", level: "info", title: "آگهی در تلگرام رد شد",
        message: `آگهی «${decided.project.title}» رد شد و بیدی برای آن ارسال نخواهد شد.`,
        site: decided.site, approvalId: decided.id, projectId: decided.projectId,
        projectTitle: decided.project.title, status: decided.status, metadata: { telegramMessageId }
      }));
      return NextResponse.json({ ok: true });
    }
    try {
      const delivery = await sendBidApprovalRequest(decided, parsed.token);
      const attached = await attachBidTelegramMessage(decided.id, delivery.chatId, delivery.messageId);
      await Promise.allSettled([
        answerCallback(String(callback.id), "آگهی تأیید شد؛ بید برای تأیید نهایی ارسال شد."),
        markTelegramDecision(chatId, telegramMessageId, true)
      ]);
      await saveReport(createReport({
        category: "telegram", eventType: "bid_review_sent", level: "success", title: "بید برای تأیید نهایی ارسال شد",
        message: delivery.text, site: decided.site, approvalId: decided.id, projectId: decided.projectId,
        projectTitle: decided.project.title, status: attached?.status || decided.status,
        metadata: { projectTelegramMessageId: telegramMessageId, bidTelegramMessageId: delivery.messageId }
      }));
      return NextResponse.json({ ok: true });
    } catch (error) {
      await revertBidApprovalToProjectPending(decided.id, tokenHash).catch(() => undefined);
      const message = error instanceof Error ? error.message : "Bid approval delivery failed";
      await answerCallback(String(callback.id), "ارسال پیام بید ناموفق بود؛ دوباره تلاش کن.", true).catch(() => undefined);
      await saveReport(createReport({
        category: "telegram", eventType: "bid_review_delivery_failed", level: "error", title: "ارسال بید به تلگرام ناموفق بود",
        message, site: decided.site, approvalId: decided.id, projectId: decided.projectId,
        projectTitle: decided.project.title, status: "project_pending"
      })).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
  }

  const approved = parsed.decision === "bid_approve";
  const decided = await decideBidApproval(parsed.approvalId, approved ? "approve" : "reject", tokenHash, chatId);
  if (!decided) {
    await answerCallback(String(callback.id), "این بید منقضی یا قبلاً بررسی شده است.", true).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }
  await Promise.allSettled([
    answerCallback(String(callback.id), approved ? "تأیید نهایی ثبت شد؛ Worker ارسال را آغاز می‌کند." : "بید رد شد."),
    markTelegramDecision(chatId, telegramMessageId, approved)
  ]);
  await saveReport(createReport({
    category: "telegram",
    eventType: approved ? "bid_approved" : "bid_rejected",
    level: approved ? "success" : "info",
    title: approved ? "بید برای ارسال نهایی تأیید شد" : "بید در تلگرام رد شد",
    message: approved
      ? `بید پروژه «${decided.project.title}» تأیید نهایی شد و فقط اکنون در صف ارسال Worker قرار گرفت.`
      : `بید پروژه «${decided.project.title}» رد شد و برای کارفرما ارسال نمی‌شود.`,
    site: decided.site, approvalId: decided.id, projectId: decided.projectId,
    projectTitle: decided.project.title, status: decided.status, metadata: { telegramMessageId }
  }));
  return NextResponse.json({ ok: true });
}
