import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { enforceProposalStyle, parseBudget, recommendedPriceForBudget } from "../panel/lib/bid-utils.ts";
import { canonicalProjectUrl, comesFromBlockedCountry, projectFingerprint } from "../panel/lib/candidate-policy.ts";
import { createProjectFingerprint } from "../panel/lib/project-fingerprint.ts";
import { bidSimilarityScore, shouldRegenerateBid } from "../panel/lib/bid-similarity-guard.ts";
const bidSource = fs.readFileSync(path.resolve(import.meta.dirname, "../panel/lib/bid.ts"), "utf8");

const project = {
  site: "ponisha",
  url: "https://ponisha.ir/project/42",
  title: "طراحی رابط کاربری داشبورد فروش",
  description: "طراحی رابط کاربری داشبورد فروش با نمودارها و نسخه موبایل",
  budget: "۵ تا ۱۰ میلیون تومان"
};

test("panel parses Persian shorthand budgets and recommends a competitive in-range price", () => {
  assert.deepEqual(parseBudget(project.budget), { min: 5_000_000, max: 10_000_000, currency: "تومان" });
  const price = parseBudget(recommendedPriceForBudget(project.budget, "medium"));
  assert.ok(price.max >= 5_000_000 && price.max <= 10_000_000, `unexpected price ${price.max}`);
});

test("single advertised budget is treated as a ceiling and never exceeded", () => {
  const price = parseBudget(recommendedPriceForBudget("۱۰ میلیون تومان", "high"));
  assert.ok(price.max > 0 && price.max <= 10_000_000);
});

test("proposal post-processing removes generic openings, template headings and extra paragraphs", () => {
  const styled = enforceProposalStyle("با سلام، دوست عزیز\n\nTools & Software Stack\n\nخروجی داشبورد را ابتدا به‌صورت نسخه قابل بررسی آماده می‌کنم.\n\nجزئیات دوم.\n\nجزئیات سوم.\n\nجزئیات چهارم.");
  assert.doesNotMatch(styled, /با سلام|Tools & Software Stack/i);
  assert.ok(styled.split(/\n\s*\n/).length <= 4);
  assert.ok(styled.length <= 900);
  assert.match(styled, /داشبورد/);
});

test("a natural Persian greeting is preserved when the proposal itself is specific", () => {
  const styled = enforceProposalStyle("سلام وقت بخیر. اتصال endpointهای ووکامرس به جزئیات سفارش نیازمند کنترل permission هر مسیر است.");
  assert.match(styled, /^سلام وقت بخیر/);
});

test("country policy only reads client metadata", () => {
  assert.equal(comesFromBlockedCountry({ clientLocation: "Lahore, Pakistan", description: "German website" }), true);
  assert.equal(comesFromBlockedCountry({ clientLocation: "Berlin, Germany", description: "India travel portal" }), false);
});

test("panel canonical URL and title fingerprint suppress tracking variants and reposts", () => {
  assert.equal(canonicalProjectUrl("https://Ponisha.ir/project/42/?utm_source=email#bid"), "https://ponisha.ir/project/42");
  assert.equal(
    projectFingerprint({ site: "ponisha", title: " طراحی‌ رابط کاربری " }),
    projectFingerprint({ site: "ponisha", title: "طراحی رابط کاربری" })
  );
});

test("project fingerprint captures deliverable, domain, constraints, intent and unique signals", () => {
  const fp = createProjectFingerprint({ title: "طراحی داشبورد فروش", description: "نمودارهای فروش و نسخه موبایل با تحویل نمونه اولیه", skills: ["Figma"] });
  assert.equal(fp.domain, "design");
  assert.equal(fp.constraints[0], "Figma");
  assert.ok(fp.deliverable && fp.intent && fp.uniqueSignals.length > 0);
});

test("similarity guard detects repeated wording", () => {
  const previous = [{ proposal: "برای طراحی داشبورد ابتدا نسخه اولیه قابل بررسی آماده می‌کنم و بعد اصلاحات را اعمال می‌کنم." }];
  const repeated = "برای طراحی داشبورد ابتدا نسخه اولیه قابل بررسی آماده می‌کنم و بعد اصلاحات را اعمال می‌کنم.";
  assert.equal(shouldRegenerateBid(repeated, previous), true);
  assert.ok(bidSimilarityScore("یک پیشنهاد کاملاً متفاوت برای ترجمه مقاله آماده می‌کنم.", previous) < 0.72);
});

test("generic fallback phrases are rejected instead of being submitted", () => {
  assert.equal(enforceProposalStyle("به‌نظرم نقطه حساس این پروژه این است که نسخه اولیه را زود روی میز بگذاریم."), "");
});

test("bid generation fails closed while bounding provider failover latency", () => {
  assert.match(bidSource, /AI_NOT_CONFIGURED/);
  assert.match(bidSource, /resolveAIProviders/);
  assert.doesNotMatch(bidSource, /const apiKey = process\.env\.OPENAI_API_KEY/);
  assert.match(bidSource, /GENERATION_BUDGET_MS = 22_000/);
  assert.match(bidSource, /PROVIDER_TIMEOUT_MS = 9_000/);
  assert.match(bidSource, /OPENROUTER_FAILOVER_TIMEOUT_MS = 7_000/);
  assert.match(bidSource, /providerTimeout\(provider, remainingMs\)/);
  assert.match(bidSource, /provider\.fallbackModels\?\.length/);
  assert.match(bidSource, /provider\.fallbackModels\.slice\(0, 2\)/);
  assert.match(bidSource, /responsePreview/);
  assert.match(bidSource, /QUALITY_OPENROUTER_SYSTEM/);
  assert.match(bidSource, /sort: "latency"/);
  assert.match(bidSource, /max_tokens: provider\.provider === "openrouter" \? 700 : 650/);
  assert.match(bidSource, /attempt < 2/);
  assert.match(bidSource, /generationDeadline/);
  assert.match(bidSource, /lastFailure = "similarity_guard"/);
  assert.match(bidSource, /semantic_quality_guard/);\n  assert.match(bidSource, /proposalQualityAssessment/);\n  assert.match(bidSource, /qualityRetryNeeded/);
  assert.match(bidSource, /throw new BidGenerationError\("AI_GENERATION_REJECTED"/);
  assert.doesNotMatch(bidSource, /function fallbackProposal/);
});

test("extension settings verifies authenticated panel health and provider-aware AI readiness", () => {
  const options = fs.readFileSync(path.resolve(import.meta.dirname, "../extension/options.js"), "utf8");
  const health = fs.readFileSync(path.resolve(import.meta.dirname, "../panel/app/api/health/route.ts"), "utf8");
  const provider = fs.readFileSync(path.resolve(import.meta.dirname, "../panel/lib/ai-provider.ts"), "utf8");
  const instrumentation = fs.readFileSync(path.resolve(import.meta.dirname, "../panel/instrumentation.ts"), "utf8");
  assert.match(options, /\/api\/health/);
  assert.match(options, /health\.aiConfigured/);
  assert.match(health, /isAuthorized\(req\)/);
  assert.match(health, /resolveAIProvider/);
  assert.match(provider, /GROQ_API_KEY/);
  assert.match(provider, /openai\/gpt-oss-120b/);
  assert.match(provider, /provider === "custom" && \/openrouter\\\.ai\/i/);
  assert.match(provider, /nvidia\/nemotron-3-ultra-550b-a55b:free/);
  assert.match(provider, /poolside\/laguna-s-2\.1:free/);
  assert.match(provider, /inclusionai\/ling-3\.0-flash:free/);
  assert.match(provider, /OPENAI_FALLBACK_ENABLED/);
  assert.doesNotMatch(provider, /nex-agi\/nex-n2\.5-mini:free/);
  assert.doesNotMatch(instrumentation, /globalThis\.fetch\s*=/);
  assert.doesNotMatch(instrumentation, /nex-agi\/nex-n2\.5-mini:free/);
});
