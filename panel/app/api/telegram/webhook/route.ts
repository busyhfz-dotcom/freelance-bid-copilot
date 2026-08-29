import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hashApprovalToken, parseTelegramDecision } from "@/lib/approval-policy";
import { decideBidApproval } from "@/lib/store";
import { answerCallback, markTelegramDecision } from "@/lib/telegram";

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
  const decided = await decideBidApproval(parsed.approvalId, parsed.decision, hashApprovalToken(parsed.token), chatId);
  if (!decided) {
    await answerCallback(String(callback.id), "این تأیید منقضی یا قبلاً استفاده شده است.", true).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }
  const approved = parsed.decision === "approve";
  await Promise.allSettled([
    answerCallback(String(callback.id), approved ? "تأیید شد؛ Worker فوراً ثبت را آغاز می‌کند." : "پیشنهاد رد شد."),
    markTelegramDecision(chatId, Number(callback.message.message_id), approved)
  ]);
  return NextResponse.json({ ok: true });
}
