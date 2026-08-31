export type DomainKey = "web_ui" | "wordpress" | "branding" | "graphic" | "development" | "content" | "marketing" | "video" | "architecture" | "data";
export type DomainGate = "allowed" | "related" | "blocked" | "unknown" | "profile_missing";

type DomainDef = { label: string; intent: RegExp[]; strong: string[]; weak: string[] };

export const DOMAIN_DEFS: Record<DomainKey, DomainDef> = {
  web_ui: {
    label: "Web / UI-UX",
    intent: [/\bui\s*\/?\s*ux\b/i, /رابط\s*کاربری|تجربه\s*کاربری/i, /landing\s*page|homepage|dashboard/i, /لندینگ(?:\s*پیج)?|هوم\s*پیج|داشبورد/i, /طراحی\s+(?:وب|وب\s*سایت|وبسایت|سایت|صفحه\s*(?:وب|سایت))/i, /\bui\s*(?:design|redesign)\b|web\s*(?:ui\s*)?design|website\s*(?:ui\s*)?(?:design|redesign)/i],
    strong: ["ui/ux", "ui ux", "رابط کاربری", "تجربه کاربری", "طراحی وب", "طراحی سایت", "web design", "landing page", "لندینگ", "homepage", "هوم پیج", "dashboard", "داشبورد", "responsive design", "فرانت اند", "frontend"],
    weak: ["figma", "html", "css", "responsive", "وب سایت", "وبسایت", "website"]
  },
  wordpress: { label: "WordPress / CMS", intent: [/wordpress|وردپرس|elementor|المنتور|woocommerce|ووکامرس|\bcms\b/i], strong: ["wordpress", "وردپرس", "elementor", "المنتور", "woocommerce", "ووکامرس", "cms"], weak: [] },
  branding: { label: "Logo / Branding", intent: [/\blogo\b|لوگو|logotype|لوگوتایپ|brand\s*identity|هویت\s*بصری|برندینگ|آرم|نشان\s*تجاری/i], strong: ["logo", "لوگو", "logotype", "لوگوتایپ", "branding", "برندینگ", "brand identity", "هویت بصری", "آرم", "نشان تجاری"], weak: [] },
  graphic: { label: "Graphic Design", intent: [/پوستر|\bposter\b|بنر|\bbanner\b|بروشور|brochure|کاتالوگ|catalog|packaging|بسته\s*بندی|پست\s*اینستاگرام|social\s*media\s*design/i], strong: ["graphic design", "طراحی گرافیک", "پوستر", "poster", "بنر", "banner", "بروشور", "brochure", "کاتالوگ", "catalog", "packaging", "بسته بندی", "social media design", "پست اینستاگرام"], weak: ["illustrator", "photoshop", "فتوشاپ"] },
  development: { label: "Software Development", intent: [/react|next\.?js|javascript|typescript|node\.?js|backend|بک\s*اند|\bapi\b|python|php|laravel|برنامه\s*نویسی|programming|اپلیکیشن|android|\bios\b/i], strong: ["react", "next.js", "nextjs", "javascript", "typescript", "node.js", "backend", "بک اند", "api", "python", "php", "laravel", "برنامه نویسی", "programming", "اپلیکیشن", "android", "ios"], weak: ["github", "git"] },
  content: { label: "Content / Translation", intent: [/تولید\s*محتوا|content\s*writing|copywriting|کپی\s*رایتینگ|مقاله|ترجمه|translation/i], strong: ["تولید محتوا", "content writing", "copywriting", "کپی رایتینگ", "مقاله", "ترجمه", "translation"], weak: [] },
  marketing: { label: "SEO / Marketing", intent: [/\bseo\b|سئو|marketing|بازاریابی|تبلیغات|google\s*ads|دیجیتال\s*مارکتینگ/i], strong: ["seo", "سئو", "marketing", "بازاریابی", "تبلیغات", "google ads", "دیجیتال مارکتینگ"], weak: [] },
  video: { label: "Video / Motion", intent: [/تدوین|video\s*editing|موشن\s*گرافیک|motion\s*graphics|after\s*effects|premiere/i], strong: ["تدوین", "video editing", "موشن گرافیک", "motion graphics", "after effects", "premiere"], weak: [] },
  architecture: { label: "Architecture / 3D", intent: [/معماری|autocad|اتوکد|revit|رویت|3ds\s*max|3d\s*max|طراحی\s*داخلی|interior\s*design/i], strong: ["معماری", "autocad", "اتوکد", "revit", "رویت", "3ds max", "3d max", "طراحی داخلی", "interior design"], weak: [] },
  data: { label: "Data / BI", intent: [/data\s*entry|ورود\s*اطلاعات|تحلیل\s*داده|data\s*analysis|power\s*bi|\bsql\b|اکسل|\bexcel\b/i], strong: ["data entry", "ورود اطلاعات", "تحلیل داده", "data analysis", "power bi", "sql", "اکسل", "excel"], weak: [] }
};

export const DOMAIN_KEYS = Object.keys(DOMAIN_DEFS) as DomainKey[];
const DOMAIN_ALIASES: Record<string, DomainKey> = {
  "web/ui": "web_ui",
  "web ui": "web_ui",
  "web / ui ux": "web_ui",
  "ui/ux": "web_ui",
  "wordpress/cms": "wordpress",
  "wordpress / cms": "wordpress"
};
const GENERIC_TOKENS = new Set(["طراحی", "design", "designer", "پروژه", "project", "انجام", "کار", "برای", "the", "and", "with", "یک", "ساخت", "ایجاد", "توسعه", "خدمات", "فروش", "حرفه", "حرفه ای", "نیاز", "مورد", "صفحه", "page", "سایت", "site", "وب", "web", "فروشگاه", "فروشگاهی", "اینترنتی"]);
const DOMAIN_ADJACENCY: Record<string, number> = {
  "web_ui|wordpress": 0.82, "wordpress|web_ui": 0.82,
  "web_ui|development": 0.55, "development|web_ui": 0.55,
  "wordpress|development": 0.50, "development|wordpress": 0.50,
  "branding|graphic": 0.55, "graphic|branding": 0.55,
  "web_ui|graphic": 0.22, "graphic|web_ui": 0.22
};

function normalizeText(value = "") {
  return String(value || "").toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[\u200c\u200f]/g, " ").replace(/[^\p{L}\p{N}+#./]+/gu, " ").replace(/\s+/g, " ").trim();
}
function normalizeDomainKey(value: unknown): DomainKey | "" {
  if (typeof value !== "string") return "";
  if (DOMAIN_KEYS.includes(value as DomainKey)) return value as DomainKey;
  return DOMAIN_ALIASES[normalizeText(value).replace(/-/g, " ")] || "";
}
function phraseText(value = "") { return normalizeText(value).replace(/[./]+/g, " ").replace(/\s+/g, " ").trim(); }
function hasPhrase(text: string, phrase: string) { return ` ${phraseText(text)} `.includes(` ${phraseText(phrase)} `); }
function specialistTokens(value = "") { return new Set(phraseText(value).split(" ").filter((x) => x.length >= 3 && !GENERIC_TOKENS.has(x))); }
function domainScores(parts: { value: string; weight: number }[]) {
  const scores = {} as Partial<Record<DomainKey, number>>;
  for (const [key, def] of Object.entries(DOMAIN_DEFS) as [DomainKey, DomainDef][]) {
    let score = 0;
    for (const part of parts) {
      for (const term of new Set(def.strong.map(phraseText))) if (hasPhrase(part.value, term)) score += 2 * part.weight;
      for (const term of new Set(def.weak.map(phraseText))) if (hasPhrase(part.value, term)) score += 0.5 * part.weight;
    }
    if (score > 0) scores[key] = score;
  }
  return scores;
}
function primaryIntent(title = ""): DomainKey | "" {
  const order: DomainKey[] = ["branding", "graphic", "video", "architecture", "content", "marketing", "data", "wordpress", "development", "web_ui"];
  const normalizedTitle = phraseText(title);
  const matched = order.filter((key) => DOMAIN_DEFS[key].intent.some((re) => re.test(title) || re.test(normalizedTitle)));
  if (matched.includes("branding") && matched.length > 1) {
    const text = phraseText(title);
    const brandingDeliverable = [
      /\b(?:design|create|redesign|refresh|develop|make)\s+(?:(?:a|an|the|new|modern|company|business|complete)\s+){0,3}(?:logo|logotype|brand identity|visual identity|branding)\b/i,
      /\b(?:logo|logotype|brand identity|visual identity|branding)\s+(?:design|redesign|creation|refresh)\b/i,
      /\b(?:new|original|custom)\s+(?:logo|logotype|brand identity|visual identity|branding)\b/i,
      /(?:لوگو|لوگوتایپ|هویت\s*بصری|برندینگ)(?:ی)?\s+(?:جدید|اختصاصی)/i,
      /(?:طراحی|ساخت|ایجاد|بازطراحی|اصلاح)\s+(?:یک\s+)?(?:لوگو|لوگوتایپ|هویت\s*بصری|برندینگ)/i
    ].some((re) => re.test(text));
    const brandingContext = [
      /\b(?:existing|current|provided)\s+(?:logo|logotype|brand identity|visual identity|branding)\b/i,
      /\b(?:logo|logotype|brand identity|visual identity|branding)\s+(?:is\s+)?(?:existing|current|provided)\b/i,
      /\b(?:using|use|with)\b(?:\s+\w+){0,5}\s+(?:existing|current|provided)\s+(?:logo|logotype|brand identity|visual identity|branding)\b/i,
      /\b(?:based on|according to|matching)\b(?:\s+\w+){0,5}\s+(?:logo|logotype|brand identity|visual identity|branding)\b/i,
      /(?:بر\s*اساس|مطابق|هماهنگ\s*با|با\s*استفاده\s*از)(?:\s+\S+){0,5}\s+(?:لوگو|لوگوتایپ|هویت\s*بصری|برندینگ)/i,
      /(?:لوگو|لوگوتایپ|هویت\s*بصری|برندینگ)(?:ی)?\s+(?:موجود|فعلی|کنونی|ارائه\s*شده)/i
    ].some((re) => re.test(text));
    if (brandingContext && !brandingDeliverable) return matched.find((key) => key !== "branding") || "branding";
  }
  if (matched.length) return matched[0];
  return "";
}
function dominantDomains(scores: Partial<Record<DomainKey, number>>, minScore = 2) {
  const entries = (Object.entries(scores) as [DomainKey, number][]).sort((a, b) => b[1] - a[1]);
  if (!entries.length || entries[0][1] < minScore) return [];
  const top = entries[0][1];
  return entries.filter(([, value]) => value >= minScore && value >= top * 0.42).map(([key, score]) => ({ key, score, label: DOMAIN_DEFS[key].label }));
}
export function inferAllowedDomains(profile = "") {
  const scores = domainScores([{ value: profile, weight: 1 }]);
  return (Object.entries(scores) as [DomainKey, number][])
    .filter(([key, score]) => DOMAIN_DEFS[key].strong.some((term) => hasPhrase(profile, term)) || DOMAIN_DEFS[key].weak.filter((term) => hasPhrase(profile, term)).length >= 2 || score >= 2)
    .sort((a, b) => b[1] - a[1]).map(([key]) => key);
}
function resolveAllowedDomains(profile = "", explicit: unknown = []) {
  const values = Array.isArray(explicit) ? explicit : [];
  const valid = values.map(normalizeDomainKey).filter((key): key is DomainKey => Boolean(key));
  return valid.length ? [...new Set(valid)] : inferAllowedDomains(profile);
}
function alignment(projectKey: DomainKey | "", allowed: DomainKey[]) {
  if (!projectKey) return 0;
  if (allowed.includes(projectKey)) return 1;
  let best = 0;
  for (const key of allowed) best = Math.max(best, DOMAIN_ADJACENCY[`${projectKey}|${key}`] || 0);
  return best;
}

export function localDomainMatch(input: { title: string; skills?: string[]; description?: string; freelancerProfile?: string; preferredDomains?: string[] }) {
  const profile = input.freelancerProfile || "";
  const explicit = Array.isArray(input.preferredDomains) ? input.preferredDomains : [];
  if (!profile.trim() && !explicit.length) return { score: null as number | null, domainGate: "profile_missing" as DomainGate, primaryDomain: "", primaryDomainKey: "" as DomainKey | "", allowedDomains: [] as DomainKey[], allowedDomainLabels: [] as string[], skillGaps: [] as string[], reason: "پروفایل یا حوزه کاری تنظیم نشده است.", overlap: 0 };
  const allowed = resolveAllowedDomains(profile, explicit);
  const title = input.title || "";
  const skills = Array.isArray(input.skills) ? input.skills : [];
  const description = input.description || "";
  const scores = domainScores([{ value: title, weight: 4 }, { value: skills.join(" "), weight: 3 }, { value: description, weight: 1 }]);
  const primaryKey = primaryIntent(title) || dominantDomains(scores, 2)[0]?.key || "";
  const primaryDomain = primaryKey ? DOMAIN_DEFS[primaryKey].label : "";
  const a = alignment(primaryKey, allowed);
  const domainGate: DomainGate = !primaryKey ? "unknown" : allowed.includes(primaryKey) ? "allowed" : a >= 0.5 ? "related" : "blocked";
  const cap = domainGate === "allowed" ? 96 : domainGate === "related" ? 60 : domainGate === "blocked" ? 35 : 60;
  const core = specialistTokens(`${title} ${skills.join(" ")}`);
  const extra = specialistTokens(description);
  const profileTokens = specialistTokens(profile);
  let coreOverlap = 0, extraOverlap = 0;
  for (const token of core) if (profileTokens.has(token)) coreOverlap++;
  for (const token of extra) if (!core.has(token) && profileTokens.has(token)) extraOverlap++;
  const coreRatio = core.size ? coreOverlap / Math.max(1, Math.min(core.size, 7)) : 0;
  const extraRatio = extra.size ? extraOverlap / Math.max(4, Math.min(extra.size, 18)) : 0;
  let score = 40;
  if (domainGate === "allowed") score = Math.round(70 + coreRatio * 18 + Math.min(6, coreOverlap * 2) + Math.min(4, extraRatio * 10));
  else if (domainGate === "related") score = Math.round(38 + a * 16 + coreRatio * 8 + Math.min(4, coreOverlap));
  else if (domainGate === "blocked") score = Math.round(20 + coreRatio * 8 + Math.min(4, coreOverlap) + Math.min(3, extraRatio * 8));
  else score = Math.round(40 + coreRatio * 14 + Math.min(6, coreOverlap * 2));
  score = Math.max(18, Math.min(cap, score));
  const evidence = dominantDomains(scores, 2).map((d) => d.key);
  if (primaryKey && !evidence.includes(primaryKey)) evidence.unshift(primaryKey);
  const skillGaps: string[] = [];
  if ((domainGate === "blocked" || domainGate === "related") && primaryDomain) skillGaps.push(primaryDomain);
  for (const key of evidence) {
    const label = DOMAIN_DEFS[key].label;
    if (!allowed.includes(key) && !skillGaps.includes(label)) skillGaps.push(label);
    if (skillGaps.length >= 2) break;
  }
  const gateFa = domainGate === "allowed" ? "داخل پروفایل" : domainGate === "related" ? "حوزه نزدیک، نیازمند بررسی" : domainGate === "blocked" ? "خارج از پروفایل" : "حوزه نامشخص";
  const reason = primaryDomain ? `حوزه اصلی: ${primaryDomain} • ${gateFa}${coreOverlap ? ` • ${coreOverlap} هم‌پوشانی تخصصی مستقیم` : ""}` : `حوزه اصلی از عنوان با اطمینان تشخیص داده نشد • ${gateFa}`;
  return { score, domainGate, primaryDomain, primaryDomainKey: primaryKey, allowedDomains: allowed, allowedDomainLabels: allowed.map((key) => DOMAIN_DEFS[key].label), skillGaps: skillGaps.filter(Boolean).slice(0, 2), reason, overlap: coreOverlap + extraOverlap };
}
