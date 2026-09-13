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
  return normalize(text).split(/[،,.\n؛]/).map((item) => item.trim()).filter((item) => item.length > 12).slice(0, 6);
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
    constraints: (input.skills || []).map(normalize).filter(Boolean),
    intent: source.slice(0, 300),
    uniqueSignals: extractSignals(source)
  };
}

export function fingerprintInstruction(fingerprint: ProjectFingerprint) {
  return `Use this project fingerprint as the only basis for the proposal. The bid must be specific to these signals and must not be reusable for another project.\n\nDeliverable: ${fingerprint.deliverable}\nDomain: ${fingerprint.domain}\nConstraints: ${fingerprint.constraints.join(" | ")}\nIntent: ${fingerprint.intent}\nUnique signals: ${fingerprint.uniqueSignals.join(" | ")}`;
}
