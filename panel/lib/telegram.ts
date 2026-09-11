import type { BidApprovalRecord, WorkerHeartbeat } from "./types";
import { callbackData } from "./approval-policy";

export type TelegramDelivery = {
  chatId: string;
  messageId: number;
  text: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function plainTelegramText(value: string) {
  return value
    .replace(/<a\s+[^>]*href="[^"]*"[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}

async function telegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !data.ok || !data.result) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

export async function sendProjectApprovalRequest(record: BidApprovalRecord, _token: string) {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not configured");
  const project = record.project;
  const text = [
    "<b>آگهی جدید</b>",
    "",
    `<b>${escapeHtml(project.title)}</b>`,
    `${escapeHtml(project.site)} · بودجه: ${escapeHtml(project.budget || "نامشخص")}`,
    project.skills?.length ? `مهارت‌ها: ${escapeHtml(project.skills.join("، "))}` : "",
    "",
    "برای بررسی و ارسال بید با اکستنشن، آگهی را باز کنید."
  ].filter(Boolean).join("\n");
  const result = await telegram<{ message_id: number; chat: { id: number | string } }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "🔗 باز کردن آگهی", url: project.url }]]
    }
  });
  return { chatId: String(result.chat.id), messageId: result.message_id, text: plainTelegramText(text) } satisfies TelegramDelivery;
}

export async function sendBidApprovalRequest(record: BidApprovalRecord, token: string) {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not configured");
  const project = record.project;
  const proposal = escapeHtml(project.bid).slice(0, 2600);
  const text = [
    "<b>بید آمادهٔ تأیید نهایی</b>",
    "",
    `<b>${escapeHtml(project.title)}</b>`,
    `مبلغ: <b>${escapeHtml(project.recommendedPrice)}</b> · زمان: ${escapeHtml(project.recommendedDuration)} روز`,
    "",
    proposal,
    "",
    "این بید فقط پس از تأیید نهایی شما برای کارفرما ارسال می‌شود.",
    `<a href="${escapeHtml(project.url)}">بازکردن آگهی</a>`
  ].join("\n");
  const result = await telegram<{ message_id: number; chat: { id: number | string } }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ تأیید نهایی و ارسال", callback_data: callbackData("bid_approve", record.id, token) },
        { text: "❌ رد بید", callback_data: callbackData("bid_reject", record.id, token) }
      ]]
    }
  });
  return { chatId: String(result.chat.id), messageId: result.message_id, text: plainTelegramText(text) } satisfies TelegramDelivery;
}

export async function answerCallback(callbackQueryId: string, text: string, showAlert = false) {
  return telegram<boolean>("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}

export async function markTelegramDecision(chatId: string, messageId: number, approved: boolean) {
  return telegram<boolean>("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] }
  });
}

export async function sendWorkerAlert(heartbeat: WorkerHeartbeat) {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) return null;
  const text = `⚠️ Worker ${escapeHtml(heartbeat.workerId)}: ${escapeHtml(heartbeat.message || heartbeat.status)}`;
  const result = await telegram<{ message_id: number; chat: { id: number | string } }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  });
  return { chatId: String(result.chat.id), messageId: result.message_id, text: plainTelegramText(text) } satisfies TelegramDelivery;
}

export async function sendWorkerRecovery(heartbeat: WorkerHeartbeat, site = "") {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) return null;
  const target = site ? `${escapeHtml(site)}: session ready; scanning resumed` : "connection recovered";
  const text = `✅ Worker ${escapeHtml(heartbeat.workerId)}: ${target}`;
  const result = await telegram<{ message_id: number; chat: { id: number | string } }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  });
  return { chatId: String(result.chat.id), messageId: result.message_id, text: plainTelegramText(text) } satisfies TelegramDelivery;
}

export async function sendSubmissionResult(record: BidApprovalRecord) {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) return null;
  const successful = record.status === "submitted";
  const text = successful
    ? `✅ بید «${escapeHtml(record.title)}» ثبت و نتیجه تأیید شد.`
    : `⚠️ ثبت بید «${escapeHtml(record.title)}» متوقف شد.\n${escapeHtml(record.lastError || "نیاز به بررسی دستی")}`;
  const result = await telegram<{ message_id: number; chat: { id: number | string } }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
  return { chatId: String(result.chat.id), messageId: result.message_id, text: plainTelegramText(text) } satisfies TelegramDelivery;
}
