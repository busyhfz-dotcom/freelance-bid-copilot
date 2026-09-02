const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(value = "") {
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

function currencyOf(value = "") {
  const normalized = String(value).toLowerCase();
  if (/ریال|\brial\b/.test(normalized)) return "rial";
  if (/تومان|\btoman\b/.test(normalized)) return "toman";
  return "unknown";
}

function multiplierFor(value = "") {
  if (/میلیارد|billion/i.test(value)) return 1_000_000_000;
  if (/میلیون|million/i.test(value)) return 1_000_000;
  if (/هزار|thousand/i.test(value)) return 1_000;
  return 1;
}

export function parseMoneyValues(value = "") {
  const normalized = normalizeDigits(value);
  const multiplier = multiplierFor(normalized);
  const values = [...normalized.matchAll(/\d[\d\s,٬.]*/g)]
    .map((match) => Number(match[0].replace(/[\s,٬.]/g, "")))
    .filter((number) => Number.isFinite(number) && number > 0)
    .map((number) => number < 100_000 && multiplier > 1 ? number * multiplier : number);
  const currency = currencyOf(normalized);
  return values.map((number) => currency === "rial" ? Math.round(number / 10) : number);
}

export function parseBudgetRange(value = "") {
  const values = parseMoneyValues(value);
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function budgetAllowsApprovedPrice(freshBudget = "", recommendedPrice = "") {
  const range = parseBudgetRange(freshBudget);
  const price = parseMoneyValues(recommendedPrice)[0];
  if (!range || !Number.isFinite(price)) return false;
  if (range.min === range.max) return price > 0 && price <= range.max;
  return price >= range.min && price <= range.max;
}
