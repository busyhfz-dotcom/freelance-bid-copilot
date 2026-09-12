const BLOCKED_COUNTRIES = [
  /\bpakistan(?:i)?\b/i, /\bbangladesh(?:i)?\b/i, /\bindia(?:n)?\b/i,
  /پاکستان/u, /بنگلادش/u, /هندوستان/u, /هند(?:ی)?/u
];

export function canonicalProjectUrl(value = "") {
  try {
    const url = new URL(String(value));
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|tracking|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return String(value || "").trim(); }
}

export function projectFingerprint(project = {}) {
  const site = String(project.site || "").toLowerCase().trim();
  const title = String(project.title || "").toLowerCase()
    .replace(/[\u200c\u200f\u202a-\u202e]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  return title ? `fingerprint:${site}:${title}` : "";
}

export function projectSeenKeys(project = {}) {
  return [canonicalProjectUrl(project.url), projectFingerprint(project)].filter(Boolean);
}

export function blockedCountry(project = {}) {
  const value = [project.country, project.clientCountry, project.clientLocation, project.clientInfo].filter(Boolean).join(" ");
  return BLOCKED_COUNTRIES.some((pattern) => pattern.test(value));
}
