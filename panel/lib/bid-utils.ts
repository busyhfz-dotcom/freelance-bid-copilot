import type { CompetitionLevel } from "./types";

export function normalizeDigits(value = "") {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
}

export function parseBudget(budget = "") {
  const normalized = normalizeDigits(budget);
  const multiplier = /میلیارد|billion/i.test(normalized) ? 1_000_000_000
    : /میلیون|million/i.test(normalized) ? 1_000_000
      : /هزار|thousand/i.test(normalized) ? 1_000 : 1;
  const nums = [...normalized.matchAll(/\d[\d\s,٬.]*/g)]
    .map((match) => Number(match[0].replace(/[\s,٬.]/g, "")))
    .filter((number) => Number.isFinite(number) && number > 0)
    .map((number) => number < 100_000 && multiplier > 1 ? number * multiplier : number);
  const currency = budget.match(/(USD|EUR|GBP|\$|€|£|تومان|ریال)/i)?.[0] || "";
  if (!nums.length) return { min: 0, max: 0, currency };
  return { min: Math.min(...nums), max: Math.max(...nums), currency };
}

function roundCompetitive(value: number) {
  const step = value >= 1_000_000 ? 50_000 : value >= 100_000 ? 10_000 : value >= 10_000 ? 1_000 : value >= 1000 ? 100 : 1;
  return Math.round(value / step) * step;
}

export function recommendedPriceForBudget(budget: string, competition: CompetitionLevel) {
  const { min, max, currency } = parseBudget(budget);
  if (!max) return "";
  const wideRange = min > 0 && max / min >= 3;
  let position = 0.56;
  if (competition === "low") position = wideRange ? 0.56 : 0.62;
  else if (competition === "medium") position = wideRange ? 0.45 : 0.55;
  else if (competition === "high") position = wideRange ? 0.34 : 0.44;

  const raw = min && max > min
    ? min + (max - min) * position
    : max * (competition === "high" ? 0.82 : competition === "medium" ? 0.86 : 0.90);
  const value = Math.max(min === max ? 1 : min, Math.min(max, roundCompetitive(raw)));
  return `${value.toLocaleString("en-US")} ${currency}`.trim();
}

const FORBIDDEN_HEADING = /^(?:Tools?\s*&\s*Software(?:\s*Stack)?|Asset Libraries|Project Roadmap|Reassuring Facts|Industry Standards|Production-Ready Quality|مراحل پروژه|ابزارهای مورد استفاده)\s*:?$/i;
const GENERIC_CLICHE = /(?:به.?نظرم نقطه حساس|خروجی این پروژه را می.?شود بدون رفت.?وبرگشت اضافه جلو برد|برای این کار پیشنهاد می.?کنم مستقیم سراغ بخش اصلی برویم|نسخه اولیه را زود روی میز بگذاریم|یک نسخه (?:کوتاه|اولیه).{0,30}قابل بررسی|پس از بررسی توضیحات پروژه.{0,35}(?:آماده|انجام)|با توجه به توضیحات پروژه.{0,35}(?:می.?توان|پیشنهاد)|the useful first step|i.?d start with the part|this can move quickly if we lock|i.?d go straight to the main deliverable)/i;

export function enforceProposalStyle(proposal: string, maxCharacters = 1400) {
  if (GENERIC_CLICHE.test(String(proposal || ""))) return "";
  const paragraphs = String(proposal || "")
    .replace(/\r/g, "")
    .split(/\n\s*\n+/)
    .map((part) => part.replace(/[ \t]+/g, " ").trim())
    .filter((part) => part && !FORBIDDEN_HEADING.test(part))
    .slice(0, 4);
  if (!paragraphs.length) return "";
  paragraphs[0] = paragraphs[0]
    .replace(/^(?:با سلام(?:،|,)?\s*(?:دوست عزیز|کارفرمای محترم)?)[،,.!?؟:\s-]*/i, "")
    .replace(/^(?:I would (?:love|be thrilled) to help(?: you)?(?: with| on)?|خوشحال می‌شوم(?: که)?|مایلم(?: که)?)\s*/i, "")
    .trim();
  return paragraphs.filter(Boolean).join("\n\n").slice(0, maxCharacters).trim();
}
