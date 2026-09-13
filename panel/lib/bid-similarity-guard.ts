export type BidMemoryItem = { proposal?: string; title?: string; createdAt?: string };

function normalizeText(value = "") {
  return String(value).toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const STOP_WORDS = new Set("این آن را که برای با در از به و یا یک روی تا می شود شده است پروژه کار انجام شما من ما اگر اما هم خیلی فقط بدون بعد قبل باید هست بود خواهد توانند کنیم کنم کنم کرد مورد نظر نیاز خروجی اولیه نسخه توضیحات the a an and or for with from to of in on this that project work will can would i we you your".split(/\s+/));

function tokens(value = "") {
  return normalizeText(value).split(/\s+/).filter((item) => item.length > 2 && !STOP_WORDS.has(item));
}

function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common += 1;
  return common / Math.max(a.size, b.size);
}

function ngrams(items: string[], size: number) {
  const result = new Set<string>();
  for (let index = 0; index <= items.length - size; index += 1) result.add(items.slice(index, index + size).join(" "));
  return result;
}

function withoutTitle(value: string, title = "") {
  const excluded = new Set(tokens(title));
  return tokens(value).filter((item) => !excluded.has(item));
}

export function bidSimilarityScore(current: string, previous: BidMemoryItem[], currentTitle = "") {
  const currentTokens = withoutTitle(current, currentTitle);
  let max = 0;
  for (const item of previous || []) {
    const oldTokens = withoutTitle(item.proposal || "", item.title || "");
    const words = overlap(new Set(currentTokens), new Set(oldTokens));
    const phrases = overlap(ngrams(currentTokens, 2), ngrams(oldTokens, 2));
    const openings = overlap(new Set(currentTokens.slice(0, 18)), new Set(oldTokens.slice(0, 18)));
    max = Math.max(max, words * 0.55 + phrases * 0.30 + openings * 0.15, openings * 0.9);
  }
  return Number(max.toFixed(3));
}

export function shouldRegenerateBid(current: string, previous: BidMemoryItem[], threshold = 0.62, currentTitle = "") {
  return bidSimilarityScore(current, previous, currentTitle) >= threshold;
}

export function buildUniqueBidInstruction(projectTitle: string, projectDescription: string) {
  return `Analyze this project independently. Do not reuse wording, structure, opening, or examples from previous bids. This proposal must be derived from this project's exact deliverables, constraints, and expected outcome.\n\nProject fingerprint:\nTitle: ${projectTitle}\nBrief: ${projectDescription.slice(0, 1200)}\n\nCreate a proposal that could not be sent unchanged to another project.`;
}
