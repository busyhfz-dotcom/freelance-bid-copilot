import assert from "node:assert/strict";
import test from "node:test";
import { parseAI } from "../panel/lib/bid.ts";

test("parseAI accepts fenced JSON", () => {
  const parsed = parseAI('```json\\n{"proposal":"برای checkout، validation سمت سرور و state خطا را جدا بررسی می‌کنم.","durationDays":"4"}\\n```');
  assert.equal(parsed?.durationDays, "4");
  assert.match(parsed?.proposal || "", /checkout/);
});

test("parseAI extracts embedded JSON and alternate duration key", () => {
  const parsed = parseAI('Here is the result:\\n{"proposal":"برای اتصال درگاه، callback و idempotency پرداخت را جدا بررسی می‌کنم.","duration_days":5}\\nDone.');
  assert.equal(parsed?.durationDays, 5);
  assert.match(parsed?.proposal || "", /callback/);
});

test("parseAI accepts a plain grounded proposal body", () => {
  const parsed = parseAI("برای صفحه محصول، state موجودی و قیمت را از داده واقعی جدا می‌کنم تا افزودن به سبد بدون ریدایرکت ناخواسته اجرا شود.");
  assert.match(parsed?.proposal || "", /سبد/);
});

test("parseAI does not accept analysis-only output", () => {
  assert.equal(parseAI("Reasoning: I should think about the user request before producing the proposal."), null);
});
