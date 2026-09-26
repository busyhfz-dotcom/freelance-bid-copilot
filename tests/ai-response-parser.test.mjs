import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import ts from "../panel/node_modules/typescript/lib/typescript.js";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "../panel/lib/bid.ts"), "utf8");
const parserSource = source.slice(source.indexOf("type ParsedAI ="), source.indexOf("function chatCompletionText"));
const compiled = ts.transpileModule(parserSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { looksLikeReasoningLeak, parseAI } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const good = JSON.stringify({
  proposal: "برای وب‌اپ مدیریت مشتری، اطلاعات مشتری و پیگیری فروش را در یک جریان روشن طراحی می‌کنم تا وضعیت هر سرنخ قابل مشاهده باشد. آیا نقش‌های کاربری و سطح دسترسی آنها مشخص شده است؟",
  durationDays: "7"
});

test("accepts only the agreed proposal JSON contract", () => {
  assert.match(parseAI(good)?.proposal || "", /پیگیری فروش/);
  assert.equal(parseAI("  " + good + "  ")?.durationDays, "7");
  assert.equal(parseAI("پیشنهاد: متن آماده برای کارفرما"), null);
  assert.equal(parseAI("Here is the result:\n" + good), null);
  assert.equal(parseAI(JSON.stringify({ proposal: "برای وب اپ مدیریت مشتری ساختار مشتری و فروش را پیاده می‌کنم.", duration_days: 7 })), null);
  assert.equal(parseAI(JSON.stringify({ proposal: "برای وب اپ مدیریت مشتری ساختار مشتری و فروش را پیاده می‌کنم.", durationDays: "7", analysis: "private" })), null);
});

test("rejects exposed reasoning even when followed by valid JSON", () => {
  const leaked = [
    "Here's a thinking process:",
    "1. **Analyze the Request:**",
    "- **Input:** A JSON object with project details from a freelance marketplace.",
    "- **Title:** ساخت وب اپلیکیشن مدیریت مشتری",
    "- **Brief:** The client provided almost no detail beyond the project title.",
    "- **Skills:** []",
    good
  ].join("\n");
  assert.equal(parseAI(leaked), null);
  assert.equal(looksLikeReasoningLeak(leaked), true);
  assert.equal(parseAI(JSON.stringify({ proposal: "Analysis: first parse the brief. " + JSON.parse(good).proposal, durationDays: "7" })), null);
  assert.equal(parseAI("<think>internal notes</think>\n" + good), null);
  for (const heading of ["Internal notes:", "## Analysis", "**Reasoning:**", "internal-notes:"]) {
    assert.equal(parseAI(JSON.stringify({ proposal: heading + "\n" + JSON.parse(good).proposal, durationDays: "7" })), null);
  }
  assert.equal(parseAI(JSON.stringify({ proposal: "**Title:** CRM. " + JSON.parse(good).proposal, durationDays: "7" })), null);
});
