export type BidMemoryItem = { proposal?: string; title?: string; createdAt?: string };

function normalizeText(value = "") {
  return String(value).toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(value = "") {
  return new Set(normalizeText(value).split(/\s+/).filter((item) => item.length > 2));
}

function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common += 1;
  return common / Math.max(a.size, b.size);
}

export function bidSimilarityScore(current: string, previous: BidMemoryItem[]) {
  const currentTokens = tokens(current);
  let max = 0;
  for (const item of previous || []) max = Math.max(max, overlap(currentTokens, tokens(item.proposal || "")));
  return Number(max.toFixed(3));
}

export function shouldRegenerateBid(current: string, previous: BidMemoryItem[], threshold = 0.72) {
  return bidSimilarityScore(current, previous) >= threshold;
}

export function buildUniqueBidInstruction(projectTitle: string, projectDescription: string) {
  return `Analyze this project independently. Do not reuse wording, structure, opening, or examples from previous bids. This proposal must be derived from this project's exact deliverables, constraints, and expected outcome.\n\nProject fingerprint:\nTitle: ${projectTitle}\nBrief: ${projectDescription.slice(0, 1200)}\n\nCreate a proposal that could not be sent unchanged to another project.`;
}
