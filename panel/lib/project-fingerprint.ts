export type ProjectFingerprint = {
  deliverable: string;
  domain: string;
  constraints: string[];
  intent: string;
  uniqueSignals: string[];
};

function normalize(value = "") {
  return String(value).replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim();
}

function extractSignals(text: string) {
  const segments = normalize(text).split(/[،,.\n؛]/).map((item) => item.trim()).filter((item) => item.length > 12);
  const specific = segments.filter((item) => /(?:api|ajax|history|endpoint|elementor|woocommerce|wordpress|وردپرس|ووکامرس|المنتور|درگاه|پنل|داشبورد|صفحه|ماژول|افزونه|ربات|اتصال|یکپارچه|فرمت|نمونه|تعداد|نسخه|خطا|باگ|طراحی|محتوا)/i.test(item));
  return [...new Set([...specific, ...segments])].slice(0, 8);
}

function extractConstraints(text: string, skills: string[]) {
  const explicit = normalize(text).split(/[،,.\n؛]/)
    .map((item) => item.trim())
    .filter((item) => /(?:باید|لازم|الزام|حداکثر|حداقل|تحویل|روز|ساعت|تعداد|نسخه|ریسپانسیو|واکنش.?گرا|سازگار|api|endpoint|فرمت|وردپرس|woocommerce|elementor|اختصاصی|from scratch|must|required|deadline|responsive|compatible)/i.test(item));
  return [...new Set([...skills.map(normalize), ...explicit])].filter(Boolean).slice(0, 10);
}

export function createProjectFingerprint(input: { title?: string; description?: string; skills?: string[] }): ProjectFingerprint {
  const source = normalize(`${input.title || ""} ${input.description || ""}`);
  let domain = "general";
  if (/طراحی|ui|ux|رابط|figma|گرافیک/i.test(source)) domain = "design";
  else if (/وردپرس|سایت|وب|api|برنامه|اپلیکیشن|کد/i.test(source)) domain = "development";
  else if (/محتوا|مقاله|ترجمه|نویسندگی/i.test(source)) domain = "content";
  return {
    deliverable: normalize(input.title || source.slice(0, 120)),
    domain,
    constraints: extractConstraints(source, input.skills || []),
    intent: normalize(input.description || input.title || "").slice(0, 600),
    uniqueSignals: extractSignals(source)
  };
}

export function fingerprintInstruction(fingerprint: ProjectFingerprint) {
  return `Use this project fingerprint as the only basis for the proposal. The bid must be specific to these signals and must not be reusable for another project.\n\nDeliverable: ${fingerprint.deliverable}\nDomain: ${fingerprint.domain}\nConstraints: ${fingerprint.constraints.join(" | ")}\nIntent: ${fingerprint.intent}\nUnique signals: ${fingerprint.uniqueSignals.join(" | ")}`;
}
