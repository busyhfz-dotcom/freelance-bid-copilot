import type { ProjectPayload } from "./types";

const BLOCKED_CLIENT_COUNTRY = /\b(?:pakistan(?:i)?|bangladesh(?:i)?|india(?:n)?)\b|پاکستان|بنگلادش|هندوستان|هند(?:ی)?/iu;

export function clientCountryText(project: Partial<ProjectPayload>) {
  return [project.country, project.clientCountry, project.employerCountry, project.location, project.clientLocation, project.employerLocation, project.clientInfo]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

export function comesFromBlockedCountry(project: Partial<ProjectPayload>) {
  return BLOCKED_CLIENT_COUNTRY.test(clientCountryText(project));
}

export function canonicalProjectUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|tracking|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

export function projectFingerprint(project: Pick<Partial<ProjectPayload>, "site" | "title">) {
  const site = String(project.site || "").toLowerCase().trim();
  const title = String(project.title || "").toLowerCase()
    .replace(/[\u200c\u200f\u202a-\u202e]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title ? `${site}:${title}` : "";
}
