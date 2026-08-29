import type { BidDecision, CompetitionLevel, ProjectPayload } from "./types";
import { localDomainMatch, type DomainGate } from "./domain";
import { decisionFor } from "./bid-policy";

export type BidResult = {
  bid: string;
  cleanedBrief: string;
  recommendedPrice: string;
  recommendedDuration: string;
  matchScore: number | null;
  matchReason: string;
  domainGate: DomainGate;
  primaryDomain: string;
  allowedDomains: string[];
  skillGaps: string[];
  budgetFitScore: number;
  briefQualityScore: number;
  competitionScore: number;
  competitionLevel: CompetitionLevel;
  bidQualityScore: number;
  jobScore: number;
  priceWithinBudget: boolean;
  riskFlags: string[];
  guardReady: boolean;
  decision: BidDecision;
  decisionReason: string;
};

const SYSTEM = `You are a freelance bid strategist. Return one concise, human, project-specific proposal.

Proposal rules:
- Usually 2 short paragraphs; never more than 4 short paragraphs.
- Do NOT start with greetings or generic phrases such as "I would love to help", "I would be thrilled", "با سلام", or "انجام می‌دهم".
- The first sentence must address the actual deliverable.
- Focus on the result, solution, and one concrete execution idea. Do not list tools unless the brief explicitly makes them relevant.
- Do not use headings, boilerplate sections, or AI-template labels. In particular never write sections such as "Tools & Software Stack", "Asset Libraries", "Project Roadmap", "Reassuring Facts", "مراحل پروژه", or "ابزارهای مورد استفاده".
- Prefer a fast first reviewable delivery for simple work. Do not promise an unrealistic deadline.
- Ask at most one targeted question. When scope is sufficiently clear, end with a concise request to confirm the milestone/scope so work can begin.
- Never repeat marketplace metadata such as category, remaining time, budget, URL, number of bids, employer username, UI labels, or "send proposal" text inside the proposal.
- Never quote chunks of the project brief back to the client.
- Do not invent experience, portfolio items, certifications, team size, guarantees, or facts about the freelancer.
- If the brief is sparse, keep the bid shorter and ask exactly one targeted question that unlocks the work.
- Match the project's language.

Return JSON only with keys: proposal, durationDays.
- durationDays: integer string such as "4".`;

function clean(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

function bidTokens(value = "") {
  const normalized = String(value || "").toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[\u200c\u200f]/g, " ").replace(/[^\p{L}\p{N}+#./]+/gu, " ").replace(/\s+/g, " ").trim();
  return new Set(normalized.split(/\s+/).filter((x) => x.length >= 2));
}

function normalizeDigits(value = "") {
  return value
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanProjectBrief(project: ProjectPayload) {
  let value = clean(normalizeDigits(project.description || ""));
  const title = clean(normalizeDigits(project.title || ""));
  const budget = clean(normalizeDigits(project.budget || ""));

  if (title) value = value.replace(new RegExp(escapeRegExp(title), "gi"), " ");
  if (budget) value = value.replace(new RegExp(escapeRegExp(budget), "gi"), " ");

  const noise: RegExp[] = [
    /(?:ارسال|ثبت)\s+(?:پیشنهاد|بید)/gi,
    /(?:send|submit|place)\s+(?:proposal|bid)/gi,
    /توضیحات\s+بیشتر/gi,
    /زمان\s+باقی.?مانده\s+برای\s+ارسال\s+پیشنهاد/gi,
    /\d+\s*روز\s*(?:و\s*\d+\s*ساعت)?/gi,
    /از\s*[0-9][0-9,.]*\s*(?:تومان|ریال)?\s*تا\s*[0-9][0-9,.]*\s*(?:تومان|ریال)/gi,
    /[0-9][0-9,.]*\s*تا\s*[0-9][0-9,.]*\s*(?:تومان|ریال)/gi,
    /(?:بودجه|مبلغ)\s*[:：]?\s*[0-9][0-9,.]*(?:\s*(?:تومان|ریال))?/gi,
    /\S+\s+کارفرمای\s+این\s+پروژه\s+است\.?/gi,
    /فریلنسرهایی\s+که\s+در\s+این\s+پروژه\s+پیشنهاد\s+ارسال\s+کرده(?:اند|‌اند)?/gi,
    /تعداد\s+پیشنهاد\s+مورد\s+نیاز[^.،؛]*/gi,
    /پیشنهاد\s+ویژه[^.،؛]*/gi,
    /پیشنهادهای?\s+(?:ارسال|ثبت)\s+شده[^.،؛]*/gi,
    /توسعه\s+نرم.?افزار\s+و\s+آی.?تی/gi,
    /طراحی\s+و\s+خلاقیت/gi,
    /تولید\s+محتوا\s+و\s+ترجمه/gi,
    /بازاریابی\s+و\s+فروش/gi,
    /(?:open|closed|باز|بسته)/gi
  ];
  for (const pattern of noise) value = value.replace(pattern, " ");

  for (const skill of project.skills || []) {
    const s = clean(normalizeDigits(skill));
    if (s.length >= 3) value = value.replace(new RegExp(escapeRegExp(s), "gi"), " ");
  }

  value = clean(value.replace(/[|•]+/g, " ").replace(/\s*[-–—]\s*/g, " "));
  value = value.replace(/^(?:از|تا|در|برای)\s+/i, "").trim();
  if (/^(?:با\s*سلام[،,.!?؟\s]*)$/i.test(value)) return "";
  if (value.length < 60) return "";
  return value.slice(0, 7000);
}

export function parseBudget(budget = "") {
  const normalized = normalizeDigits(budget).replace(/,/g, "");
  const nums = [...normalized.matchAll(/\d+(?:\.\d+)?/g)]
    .map((m) => Number(m[0]))
    .filter((n) => Number.isFinite(n) && n > 0);
  const currency = budget.match(/(USD|EUR|GBP|\$|€|£|تومان|ریال)/i)?.[0] || "";
  if (!nums.length) return { min: 0, max: 0, currency };
  return { min: Math.min(...nums), max: Math.max(...nums), currency };
}

function roundCompetitive(value: number) {
  const step = value >= 1_000_000 ? 50_000 : value >= 100_000 ? 10_000 : value >= 10_000 ? 1_000 : value >= 1000 ? 100 : 1;
  return Math.round(value / step) * step;
}

export function recommendedPrice(project: ProjectPayload) {
  const { min, max, currency } = parseBudget(project.budget || "");
  if (!max) return "";

  // v0.1.8: price inside the employer range, but adapt its position to competition.
  // Wide budgets get a more conservative position because the upper bound is often aspirational.
  const comp = competition(project);
  const spreadRatio = min > 0 ? max / min : 1;
  const wideRange = min > 0 && spreadRatio >= 3;
  let position = 0.56;
  if (comp.level === "low") position = wideRange ? 0.56 : 0.62;
  else if (comp.level === "medium") position = wideRange ? 0.45 : 0.55;
  else if (comp.level === "high") position = wideRange ? 0.34 : 0.44;

  let value: number;
  if (min && max > min) value = min + (max - min) * position;
  else value = max * (comp.level === "high" ? 0.82 : comp.level === "medium" ? 0.86 : 0.90);

  value = Math.max(min || 0, Math.min(max, roundCompetitive(value)));
  return `${value.toLocaleString("en-US")} ${currency}`.trim();
}

export function recommendedDuration(project: ProjectPayload) {
  const haystack = `${project.title} ${cleanProjectBrief(project)}`.toLowerCase();
  if (/هوم\s*پیج|صفحه\s*اصلی|landing\s*page|homepage|ui\/?ux|رابط\s*کاربری/.test(haystack)) return "4";
  if (/لوگو|logo|بنر|banner|کاور|پوستر|poster/.test(haystack)) return "3";
  if (/وردپرس|wordpress|وب.?سایت|website|سایت/.test(haystack)) return "5";
  if (/اپلیکیشن|application|mobile|اندروید|ios|backend|api|ربات|bot/.test(haystack)) return "7";
  if (/ترجمه|translation|تایپ|data entry|ورود اطلاعات/.test(haystack)) return "3";
  return "5";
}

export function localMatch(project: ProjectPayload) {
  const match = localDomainMatch({
    title: project.title || "",
    skills: project.skills || [],
    description: cleanProjectBrief(project),
    freelancerProfile: project.freelancerProfile || "",
    preferredDomains: project.preferredDomains || []
  });
  return {
    score: match.score,
    reason: match.reason,
    domainGate: match.domainGate,
    primaryDomain: match.primaryDomain,
    allowedDomains: match.allowedDomains,
    skillGaps: match.skillGaps
  };
}

function budgetFit(budget: string, price: string) {
  const b = parseBudget(budget);
  const p = parseBudget(price).max;
  if (!b.max || !p) return { score: 50, within: false };
  const within = p >= (b.min || 0) && p <= b.max;
  if (!within) return { score: 10, within: false };
  if (b.min && b.max > b.min) {
    const position = (p - b.min) / (b.max - b.min);
    const score = position >= 0.35 && position <= 0.72 ? 94 : position < 0.2 ? 78 : 82;
    return { score, within: true };
  }
  return { score: 85, within: true };
}

function briefQuality(project: ProjectPayload, brief: string) {
  const len = brief.length;
  let score = len === 0 ? 42 : len < 120 ? 58 : len < 300 ? 72 : len < 1200 ? 88 : len < 3500 ? 82 : 72;
  if ((project.skills || []).length >= 2) score += 4;
  if (project.title.length >= 8) score += 3;
  return Math.min(95, score);
}

function competition(project: ProjectPayload) {
  const count = Number.isFinite(project.proposalCount) ? Number(project.proposalCount) : null;
  const confidence = project.competitionConfidence || "low";
  if (count === null) return { level: (project.competitionLevel || "unknown") as CompetitionLevel, score: 52, confidence };
  let score = 38;
  let level: CompetitionLevel = "high";
  if (count <= 3) { level = "low"; score = 96; }
  else if (count <= 8) { level = "low"; score = 86; }
  else if (count <= 15) { level = "medium"; score = 70; }
  else if (count <= 30) { level = "medium"; score = 54; }
  // Visible-card counts are a lower bound, so avoid over-rewarding them.
  if (["visible_cards", "section_signals"].includes(project.proposalCountSource || "")) score = Math.min(score, 84);
  return { level, score, confidence };
}

function bidQuality(project: ProjectPayload, proposal: string, brief: string) {
  const value = proposal.trim();
  if (!value) return 0;
  let score = 50;
  const paragraphs = value.split(/\n\s*\n/).filter(Boolean).length;
  if (value.length >= 130 && value.length <= 750) score += 16;
  else if (value.length <= 950) score += 8;
  if (paragraphs >= 2 && paragraphs <= 4) score += 12;
  if (!/^(سلام|با سلام|hello|hi\b|dear\b|i would love|i would be thrilled)/i.test(value)) score += 8;
  if (!/(زمان باقی.?مانده|بودجه|تعداد پیشنهاد|ارسال پیشنهاد|ثبت پیشنهاد|https?:\/\/)/i.test(value)) score += 7;
  if (/(Tools?\s*&\s*Software|Asset Librar|Project Roadmap|Reassuring Facts|مراحل پروژه|ابزارهای مورد استفاده)/i.test(value)) score -= 28;
  if ((value.match(/^[^\n]{2,40}:\s*$/gm) || []).length >= 2) score -= 14;
  const firstSentence = value.split(/[.!؟\n]/)[0] || "";
  const titleTokens = bidTokens(project.title);
  const firstTokens = bidTokens(firstSentence);
  let overlap = 0;
  for (const t of titleTokens) if (firstTokens.has(t)) overlap += 1;
  if (overlap >= 1) score += 5;
  if (!brief && /[؟?]/.test(value)) score += 4;
  return Math.max(0, Math.min(98, score));
}

function fallbackProposal(project: ProjectPayload, brief: string) {
  const persian = /[\u0600-\u06FF]/.test(`${project.title} ${brief}`);
  const haystack = `${project.title} ${brief}`.toLowerCase();
  const title = clean(project.title);

  if (persian && /هوم\s*پیج|صفحه\s*اصلی|landing\s*page|homepage/.test(haystack)) {
    return `برای ${title}، تمرکزم روی ساختار قابل‌اعتماد، نمایش واضح خدمات و مسیر مشخص برای اقدام کاربر خواهد بود. ابتدا نسخه اولیه را آماده می‌کنم تا جهت کلی طراحی تأیید شود و بعد از بازخورد شما نسخه نهایی را تکمیل می‌کنم.\n\nاگر لینک سایت فعلی و یک یا دو نمونه مرجع که سبکشان را می‌پسندید بفرستید، می‌توانم طراحی را دقیق‌تر و سریع‌تر شروع کنم.`;
  }

  if (persian) {
    const specific = brief && brief.length > 30 ? `برای ${title}، خروجی را بر اساس نیاز اصلی پروژه متمرکز می‌کنم` : `برای ${title}`;
    return `${specific} تا نسخه اولیه سریع قابل بررسی باشد و اصلاحات روی همان مسیر انجام شود.\n\nاگر یک نمونه مرجع یا مهم‌ترین محدودیت اجرایی را بفرستید، می‌توانم محدوده کار و تحویل را دقیق‌تر نهایی کنم.`;
  }

  const specific = brief && brief.length > 30 ? brief.slice(0, 180) : project.title;
  return `For ${project.title}, I’ll keep the work focused on the core deliverable and get an early reviewable version in front of you first so refinements stay targeted.\n\nIf you can share one reference and the most important constraint, I can lock the scope and delivery more precisely.`;
}

function extractResponseText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks: string[] = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) if (typeof content?.text === "string") chunks.push(content.text);
  }
  return chunks.join("\n").trim();
}

function parseAI(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { return null; }
}

function scoreResult(project: ProjectPayload, bid: string, cleanedBrief: string, price: string, duration: string): BidResult {
  const match = localMatch(project);
  const budget = budgetFit(project.budget || "", price);
  const briefScore = briefQuality(project, cleanedBrief);
  const comp = competition(project);
  const quality = bidQuality(project, bid, cleanedBrief);
  const matchForScore = match.score ?? 55;
  const jobScore = Math.round(matchForScore * 0.45 + budget.score * 0.20 + comp.score * 0.20 + briefScore * 0.15);
  const competitionKnown = comp.level !== "unknown" && project.proposalCountSource !== "unknown";
  const budgetKnown = parseBudget(project.budget || "").max > 0;
  const verdict = decisionFor({ matchScore: match.score, domainGate: match.domainGate, jobScore, quality, budgetKnown, budgetWithin: budget.within, competitionKnown });
  const riskFlags: string[] = [];
  if (match.score === null) riskFlags.push("profile_missing");
  if (match.domainGate !== "allowed") riskFlags.push(`domain_${match.domainGate}`);
  if (!project.budget || !parseBudget(project.budget).max) riskFlags.push("budget_unverified");
  if (project.budget && !budget.within) riskFlags.push("price_outside_budget");
  if (quality < 70) riskFlags.push("bid_quality_low");
  if (!duration) riskFlags.push("duration_missing");
  if (!competitionKnown) riskFlags.push("competition_unknown");
  if (verdict.decision !== "BID") riskFlags.push(`decision_${verdict.decision.toLowerCase()}`);
  const guardReady = budget.within && quality >= 70 && !!duration && match.score !== null && match.domainGate === "allowed" && competitionKnown && verdict.decision === "BID";

  return {
    bid,
    cleanedBrief,
    recommendedPrice: price,
    recommendedDuration: duration,
    matchScore: match.score,
    matchReason: match.reason,
    domainGate: match.domainGate,
    primaryDomain: match.primaryDomain,
    allowedDomains: match.allowedDomains || [],
    skillGaps: match.skillGaps || [],
    budgetFitScore: budget.score,
    briefQualityScore: briefScore,
    competitionScore: comp.score,
    competitionLevel: comp.level,
    bidQualityScore: quality,
    jobScore,
    priceWithinBudget: budget.within,
    riskFlags,
    guardReady,
    decision: verdict.decision,
    decisionReason: verdict.reason
  };
}

export async function generateBid(project: ProjectPayload): Promise<BidResult> {
  const cleanedBrief = cleanProjectBrief(project);
  const price = recommendedPrice(project);
  const duration = recommendedDuration(project);
  const fallbackBid = fallbackProposal(project, cleanedBrief);
  const fallback = scoreResult(project, fallbackBid, cleanedBrief, price, duration);

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: SYSTEM }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify({
            marketplace: project.site,
            title: clean(project.title),
            brief: cleanedBrief || "The client provided almost no detail beyond the project title.",
            skills: project.skills || [],
            locallyRecommendedDurationDays: duration
          }) }] }
        ],
        max_output_tokens: 350
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const parsed = parseAI(extractResponseText(await response.json()));
    if (!parsed?.proposal || typeof parsed.proposal !== "string") return fallback;
    const aiDuration = /^\d{1,2}$/.test(String(parsed.durationDays || "")) ? String(parsed.durationDays) : duration;
    return scoreResult(project, parsed.proposal.trim(), cleanedBrief, price, aiDuration);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
