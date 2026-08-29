function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean).slice(0, 20);
}

export function normalizeProjectInspection({ site, item = {}, inspected = {}, currentUrl = "" } = {}) {
  const listing = item && typeof item === "object" ? item : {};
  const detail = inspected && typeof inspected === "object" ? inspected : {};
  const detailSkills = cleanList(detail.skills);
  const listingSkills = cleanList(listing.skills);

  return {
    ...listing,
    ...detail,
    site: clean(detail.site) || clean(listing.site) || clean(site),
    url: clean(detail.url) || clean(listing.url) || clean(currentUrl),
    title: clean(detail.title) || clean(listing.title),
    description: clean(detail.description) || clean(listing.description) || clean(listing.snippet),
    budget: clean(detail.budget) || clean(listing.budget),
    skills: detailSkills.length ? detailSkills : listingSkills
  };
}
