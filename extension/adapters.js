(() => {
  const core = globalThis.BidCopilotAdapterCore;
  if (!core) throw new Error("Bid Copilot adapter core was not loaded.");
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };

  const normalizeDigits = core.normalizeDigits;

  const common = {
    titleSelectors: [
      "h1",
      "[data-testid*='project'][data-testid*='title']",
      "[data-testid*='title']",
      ".project-title",
      ".project_title",
      "main h2"
    ],
    descriptionSelectors: [
      "[data-testid*='description']",
      "[class*='project-description']",
      "[class*='project_description']",
      "[class*='description']",
      "article",
      "main"
    ],
    budgetSelectors: [
      "[data-testid*='budget']",
      "[class*='budget']",
      "[class*='price']",
      "[class*='amount']"
    ],
    skillSelectors: [
      "[class*='skill']",
      "[class*='tag']",
      "[class*='chip']",
      "[class*='badge']"
    ],
    proposalSelectors: [
      "textarea[name*='proposal' i]",
      "textarea[name*='bid' i]",
      "textarea[name*='description' i]",
      "textarea[placeholder*='پیشنهاد']",
      "textarea[placeholder*='توضیحات']",
      "textarea[placeholder*='proposal' i]",
      "textarea[placeholder*='bid' i]"
    ],
    priceSelectors: [
      "input[name*='bid' i][type='number']",
      "input[name*='amount' i]",
      "input[name*='price' i]",
      "input[inputmode='numeric'][placeholder*='مبلغ']",
      "input[placeholder*='مبلغ']",
      "input[placeholder*='بودجه']",
      "input[placeholder*='price' i]"
    ],
    durationSelectors: [
      "input[name*='duration' i]",
      "input[name*='day' i]",
      "input[placeholder*='روز']",
      "input[placeholder*='مدت']",
      "input[placeholder*='days' i]"
    ],
    proposalOpenTexts: [
      "ارسال پیشنهاد",
      "ثبت پیشنهاد",
      "place bid",
      "send proposal"
    ],
    submitTexts: [
      "ارسال پیشنهاد",
      "ثبت پیشنهاد",
      "ارسال بید",
      "ثبت بید",
      "submit proposal",
      "place bid",
      "send proposal",
      "submit bid"
    ]
  };

  const siteAdapters = [
    {
      id: "kaya",
      match: (host) => host === "kaya.ir" || host.endsWith(".kaya.ir"),
      ...common,
      titleSelectors: ["main h1", "h1", ...common.titleSelectors],
      descriptionSelectors: ["main", ...common.descriptionSelectors],
      numericFallbackSelectors: ["input[type='number']", "input[inputmode='numeric']", "input[type='text']"]
    },
    {
      id: "ponisha",
      match: (host) => host === "ponisha.ir" || host.endsWith(".ponisha.ir"),
      ...common,
      titleSelectors: ["h1", "[class*='project'] h1", ...common.titleSelectors]
    },
    { id: "generic", match: () => true, ...common }
  ];

  function adapter() {
    return siteAdapters.find((a) => a.match(location.hostname)) || siteAdapters.at(-1);
  }

  function canonicalUrl() {
    try {
      const u = new URL(location.href);
      u.hash = "";
      for (const key of [...u.searchParams.keys()]) {
        if (/^utm_/i.test(key) || /^(ref|source)$/i.test(key)) u.searchParams.delete(key);
      }
      return u.toString();
    } catch {
      return location.href;
    }
  }

  function explicitProposalCount(bodyText = "") {
    return core.explicitProposalCountFromText(bodyText);
  }

  function proposalListHeading() {
    const phrase = /فریلنسرهایی\s*که\s*در\s*این\s*پروژه\s*پیشنهاد\s*ارسال\s*کرده/i;
    // Never scan every div: on long Ponisha pages, reading text/layout for every
    // nested wrapper turns this into an O(n²)-like renderer stall.
    const selectors = "h1,h2,h3,h4,h5,h6,[role='heading'],strong,p,[class*='heading'],[class*='title']";
    const candidates = [];
    for (const el of document.querySelectorAll(selectors)) {
      const t = text(el).replace(/[\u200c\u200f\u202a-\u202e]/g, " ").replace(/\s+/g, " ").trim();
      if (t.length <= 220 && phrase.test(t) && visible(el)) candidates.push({ el, t });
      if (candidates.length >= 12) break;
    }
    if (!candidates.length) return null;
    const tagRank = (el) => /^H[1-6]$/.test(el.tagName) || el.getAttribute("role") === "heading" ? 0 : /^(STRONG|P|SPAN)$/.test(el.tagName) ? 1 : 2;
    candidates.sort((a, b) => tagRank(a.el) - tagRank(b.el) || a.t.length - b.t.length);
    return candidates[0].el;
  }

  function looksLikeProposalCard(el) {
    const t = normalizeDigits(text(el));
    if (t.length < 35 || t.length > 1100) return false;
    if (!/زمان\s*تحویل/i.test(t) || !/ارسال\s*پیشنهاد\s*در/i.test(t)) return false;
    if (/(تعداد\s*پیشنهاد\s*مورد\s*نیاز|پیشنهاد\s*ویژه|ظرفیت)/i.test(t)) return false;
    return true;
  }

  function visibleProposalCards() {
    const heading = proposalListHeading();
    if (!heading) return null;
    const headingBottom = heading.getBoundingClientRect().bottom;
    let best = null;
    let scope = heading.parentElement;

    for (let depth = 0; scope && depth < 6; depth += 1, scope = scope.parentElement) {
      // Count repeated textual signals first. This handles generic div-based cards
      // without forcing layout across the entire page.
      const scopeText = normalizeDigits(text(scope));
      const deliverySignals = (scopeText.match(/زمان\s*تحویل/g) || []).length;
      const sentSignals = (scopeText.match(/ارسال\s*پیشنهاد\s*در/g) || []).length;
      const signalCount = Math.min(deliverySignals, sentSignals);
      if (signalCount >= 2 && signalCount <= 200 && (!best || signalCount > best.count)) {
        best = { count: signalCount, source: "section_signals" };
      }

      const matching = [];
      const raw = scope.querySelectorAll("article,li,[class*='card'],[class*='proposal'],[class*='freelancer'],[class*='item']");
      for (const el of raw) {
        if (!looksLikeProposalCard(el) || !visible(el)) continue;
        if (el.getBoundingClientRect().top >= headingBottom - 12) matching.push(el);
        if (matching.length >= 200) break;
      }

      // Keep the smallest matching DOM node for each card; large wrappers often contain several cards.
      const leaves = matching.filter((el) => !matching.some((other) => other !== el && el.contains(other)));
      if (leaves.length >= 2 && (!best || leaves.length > best.count)) {
        best = { count: leaves.length, source: "visible_cards" };
      }

      // Stop once we have a useful list-sized container; climbing farther can include unrelated page content.
      if (best?.count >= 2 && depth >= 1) break;
    }
    return best;
  }

  function competitionLevel(count) {
    if (!Number.isFinite(count)) return "unknown";
    if (count <= 8) return "low";
    if (count <= 30) return "medium";
    return "high";
  }

  function competitionSnapshot(bodyText = "") {
    const explicit = explicitProposalCount(bodyText);
    if (Number.isFinite(explicit)) return { count: explicit, level: competitionLevel(explicit), source: "explicit", confidence: "high" };
    const visibleCards = visibleProposalCards();
    if (visibleCards && Number.isFinite(visibleCards.count)) {
      return { count: visibleCards.count, level: competitionLevel(visibleCards.count), source: visibleCards.source, confidence: "medium" };
    }
    return { count: null, level: "unknown", source: "unknown", confidence: "low" };
  }

  function firstVisible(selectors, requireText = false) {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (visible(el) && (!requireText || text(el))) return el;
      }
    }
    return null;
  }

  function cleanProjectTitle(value = "") {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s*(?:[|\-–—]\s*)?(?:(?:گروه\s*)?کایا|Kaya(?:\s*Group)?)\s*$/i, "")
      .trim();
  }

  function meaningfulProjectTitle(value = "") {
    const title = cleanProjectTitle(value);
    if (title.length < 5 || !/[\p{L}\p{N}]/u.test(title)) return "";
    if (/^(?:\|?\s*گروه|پروژه.?ها|projects?|کایا|kaya)$/i.test(title)) return "";
    return title;
  }

  function projectTitle(a) {
    const visibleTitle = text(firstVisible(a.titleSelectors, true));
    const metadata = [
      document.querySelector("meta[property='og:title']")?.getAttribute("content"),
      document.querySelector("meta[name='twitter:title']")?.getAttribute("content"),
      document.querySelector("meta[itemprop='name']")?.getAttribute("content")
    ];
    const candidates = [visibleTitle, ...metadata, document.title].map(meaningfulProjectTitle).filter(Boolean);
    return candidates[0] || "";
  }

  function contextualProjectText(a) {
    const titleEl = firstVisible(a.titleSelectors, true);
    if (!titleEl) return "";
    const title = text(titleEl);
    const candidates = [];
    let el = titleEl;
    for (let depth = 0; el && depth < 9; depth += 1, el = el.parentElement) {
      if (!visible(el)) continue;
      let t = text(el);
      if (!t.includes(title) || t.length < title.length + 20) continue;
      const offersMarker = t.indexOf("فریلنسرهایی که در این پروژه پیشنهاد ارسال کرده");
      if (offersMarker > 0) t = t.slice(0, offersMarker).trim();
      if (t.length > 80 && t.length < 6000) {
        const hasBudget = /(?:تومان|ریال|بودجه|از\s*[۰-۹٠-٩0-9,.٬]+\s*تا)/i.test(t);
        const hasProposalCta = /ارسال پیشنهاد|ثبت پیشنهاد/i.test(t);
        candidates.push({ t, score: t.length + (hasBudget ? 700 : 0) + (hasProposalCta ? 500 : 0) });
      }
    }
    candidates.sort((x, y) => x.score - y.score);
    return candidates[0]?.t || "";
  }

  function bestDescription(a, contextual = contextualProjectText(a)) {
    if (contextual.length >= 80) return contextual;

    const candidates = [];
    for (const selector of a.descriptionSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const t = text(el);
        if (t.length < 100 || t.length > 18000) continue;
        const penalty = /ورود|ثبت نام|منو|دسته.?بندی|footer|copyright/i.test(t.slice(0, 150)) ? 0.6 : 1;
        candidates.push({ t, score: Math.min(t.length, 7000) * penalty });
      }
    }
    candidates.sort((x, y) => y.score - x.score);
    return candidates[0]?.t || "";
  }

  function findBudget(a, bodyText = "", contextual = contextualProjectText(a)) {
    const budgetEl = firstVisible(a.budgetSelectors, true);
    const samples = [contextual, text(budgetEl), bodyText].filter(Boolean);
    for (const sample of samples) {
      const budget = core.extractBudget(sample);
      if (budget) return budget;
    }
    return "";
  }

  function skills(a) {
    const out = new Set();
    for (const selector of a.skillSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const t = text(el);
        if (t.length >= 2 && t.length <= 50 && !/بودجه|مبلغ|project|پروژه/i.test(t)) out.add(t);
        if (out.size >= 14) break;
      }
      if (out.size >= 14) break;
    }
    return [...out].slice(0, 12);
  }

  function clientInfo() {
    const candidates = [...document.querySelectorAll("[class*='client'], [class*='employer'], [data-testid*='client']")]
      .filter(visible).map(text).filter((x) => x.length > 5 && x.length < 700);
    return candidates.sort((a, b) => b.length - a.length)[0] || "";
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    descriptor?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clickableByTexts(texts) {
    const clickable = [...document.querySelectorAll("button, a, input[type='submit'], [role='button']")].filter(visible);
    for (const el of clickable) {
      const label = `${text(el)} ${el.getAttribute("value") || ""}`.toLowerCase();
      if (texts.some((x) => label.includes(x.toLowerCase()))) return el;
    }
    return null;
  }

  function findProposalOpener(a) {
    if (firstVisible(a.proposalSelectors)) return null;
    return clickableByTexts(a.proposalOpenTexts);
  }

  function proposalScope(proposal) {
    if (!proposal) return null;
    const direct = proposal.closest("form") || proposal.closest("[role='dialog']");
    if (direct) return direct;
    let el = proposal.parentElement;
    for (let depth = 0; el && depth < 9; depth += 1, el = el.parentElement) {
      const t = text(el);
      const numeric = el.querySelectorAll("input[type='number'],input[inputmode='numeric'],input[type='text']").length;
      if (numeric >= 2 && /(ثبت\s*پیشنهاد|ارسال\s*پیشنهاد|توضیحات)/i.test(t) && /(روز|زمان\s*تحویل|مدت)/i.test(t)) return el;
    }
    return proposal.parentElement;
  }

  function nearbyText(el) {
    const chunks = [];
    let n = el;
    for (let i = 0; n && i < 3; i += 1, n = n.parentElement) chunks.push(text(n));
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    if (prev) chunks.push(text(prev));
    if (next) chunks.push(text(next));
    return chunks.join(" ").slice(0, 1400);
  }

  function fieldIdentityText(el) {
    const chunks = [
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("placeholder") || "",
      el.getAttribute("aria-label") || ""
    ];
    for (const label of el.labels || []) chunks.push(text(label));
    const labelledBy = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    for (const id of labelledBy) chunks.push(text(document.getElementById(id)));
    const parentText = text(el.parentElement);
    if (parentText.length <= 240) chunks.push(parentText);
    if (el.previousElementSibling) chunks.push(text(el.previousElementSibling));
    return chunks.join(" ").replace(/\s+/g, " ").trim();
  }

  function lockedField(a, proposal, kind) {
    const scope = proposalScope(proposal);
    if (!scope) return null;
    const selectors = [...(kind === "price" ? a.priceSelectors : a.durationSelectors), ...(a.numericFallbackSelectors || [])];
    const candidates = new Map();
    for (const selector of selectors) {
      for (const el of scope.querySelectorAll(selector)) {
        if (!visible(el) || el === proposal) continue;
        const metadata = { identity: fieldIdentityText(el), context: nearbyText(el) };
        const score = core.fieldRoleScore(kind, metadata);
        const previous = candidates.get(el);
        if (!previous || score > previous.score) candidates.set(el, { el, score });
      }
    }
    const ranked = [...candidates.values()].sort((x, y) => y.score - x.score);
    return ranked[0]?.score > 0 ? ranked[0].el : null;
  }

  function findSubmit(a) {
    const proposal = firstVisible(a.proposalSelectors);
    if (!proposal) return null;
    const scope = proposalScope(proposal);
    if (!scope) return null;
    const local = [...scope.querySelectorAll("button, input[type='submit'], [role='button']")].filter(visible);
    for (const el of local) {
      const label = `${text(el)} ${el.getAttribute("value") || ""}`.toLowerCase();
      if (a.submitTexts.some((x) => label.includes(x.toLowerCase()))) return el;
    }
    return null;
  }

  async function expandDetailsIfAvailable(a) {
    if (a.id !== "ponisha") return;
    const el = clickableByTexts(["توضیحات بیشتر"]);
    if (!el) return;
    el.click();
    await sleep(250);
  }


  function budgetFromText(value = "") {
    return core.extractBudget(value);
  }

  function ageFromText(value = "") {
    const t = normalizeDigits(value).replace(/\s+/g, " ");
    const patterns = [
      /((?:[0-9]{1,3})\s*(?:دقیقه|ساعت|روز)\s*پیش)/i,
      /((?:[0-9]{1,3})\s*(?:minutes?|hours?|days?)\s*ago)/i,
      /(لحظاتی\s*پیش|همین\s*الان|just\s*now)/i
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) return m[1];
    }
    return "";
  }

  function smallestProjectCard(anchor, readText = text, isVisible = visible) {
    let best = anchor.parentElement;
    let el = anchor.parentElement;
    for (let depth = 0; el && depth < 8; depth += 1, el = el.parentElement) {
      if (!isVisible(el)) continue;
      const t = readText(el);
      if (t.length < 35 || t.length > 3500) continue;
      const hasMoney = /(?:تومان|ریال|بودجه|مبلغ|\$|€|£|USD|EUR|GBP)/i.test(t);
      const hasProjectSignal = /(?:پروژه|مهارت|زمان|ارسال پیشنهاد|بودجه|project|budget|proposal)/i.test(t);
      if (hasMoney || hasProjectSignal) best = el;
      if (hasMoney && t.length <= 1800) return el;
    }
    return best || anchor;
  }

  function cleanListSnippet(raw = "", title = "", budget = "") {
    let value = raw.replace(/\s+/g, " ").trim();
    if (title) value = value.replace(title, " ");
    if (budget) value = value.replace(budget, " ");
    value = value
      .replace(/(?:ارسال|ثبت)\s+(?:پیشنهاد|بید)/gi, " ")
      .replace(/(?:send|submit|place)\s+(?:proposal|bid)/gi, " ")
      .replace(/\b(?:open|closed)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return value.slice(0, 760);
  }

  function projectLinkScore(anchor, cardText, readText = text) {
    const href = anchor.href || "";
    const label = readText(anchor);
    if (!href || !label || label.length < 5 || label.length > 220) return -99;
    let u;
    try { u = new URL(href, location.href); } catch { return -99; }
    if (!core.isMarketplaceProjectDetailUrl(location.hostname, u.href) || u.href === location.href) return -99;
    if (/^(?:javascript:|mailto:|tel:)/i.test(href)) return -99;
    const navNoise = /^(?:خانه|پروژه.?ها|ثبت(?:\s*سریع)?\s*پروژه|پروژه\s*جدید|فریلنسر|کارفرما|راهنما|ورود|ثبت.?نام|پروفایل|پیام|اعلان|home|projects?|post\s*project|new\s*project|freelancers?|login|register)$/i;
    if (navNoise.test(label.trim())) return -99;
    let score = 0;
    const pathSignal = /(?:project|projects|job|jobs|task|work|پروژه)/i.test(`${u.pathname} ${label}`);
    if (pathSignal) score += 7;
    if (/(?:\/create(?:\/|$)|\/new(?:\/|$)|\/post(?:\/|$)|ثبت-?پروژه)/i.test(u.pathname)) score -= 10;
    const classSignal = `${anchor.className || ""} ${anchor.parentElement?.className || ""}`;
    if (/(?:skill|tag|chip|badge|category|دسته)/i.test(classSignal)) score -= 5;
    if (anchor.querySelector("h1,h2,h3,h4,h5,h6") || anchor.closest("h1,h2,h3,h4,h5,h6")) score += 3;
    if (/(?:تومان|ریال|بودجه|مبلغ|\$|€|£|USD|EUR|GBP)/i.test(cardText)) score += 5;
    if (/(?:مهارت|زمان|دقیقه پیش|ساعت پیش|روز پیش|budget|skill|ago)/i.test(cardText)) score += 2;
    if (cardText.length >= 70 && cardText.length <= 2400) score += 2;
    if (/ارسال\s*پیشنهاد\s*در|زمان\s*تحویل/i.test(cardText)) score -= 8; // competitor card, not a project-list item
    if (/فریلنسرهایی\s*که\s*در\s*این\s*پروژه/i.test(cardText)) score -= 8;
    return score;
  }

  function scanProjectList() {
    const a = adapter();
    const found = new Map();
    const textCache = new WeakMap();
    const visibilityCache = new WeakMap();
    const readText = (el) => {
      if (!el) return "";
      if (!textCache.has(el)) textCache.set(el, text(el));
      return textCache.get(el);
    };
    const isVisible = (el) => {
      if (!el) return false;
      if (!visibilityCache.has(el)) visibilityCache.set(el, visible(el));
      return visibilityCache.get(el);
    };
    const anchors = [...document.querySelectorAll("a[href]")].slice(0, 1200).filter(isVisible);
    for (const anchor of anchors) {
      const card = smallestProjectCard(anchor, readText, isVisible);
      const raw = readText(card);
      const linkScore = projectLinkScore(anchor, raw, readText);
      if (linkScore < 9) continue;
      const title = meaningfulProjectTitle(readText(anchor));
      if (!title) continue;
      const budget = budgetFromText(raw);
      const ageText = ageFromText(raw);
      const snippet = cleanListSnippet(raw, title, budget);
      const url = (() => { try { const u = new URL(anchor.href, location.href); u.hash = ""; return u.toString(); } catch { return anchor.href; } })();
      const skillSet = new Set();
      for (const el of card.querySelectorAll("[class*='skill'],[class*='tag'],[class*='chip'],[class*='badge']")) {
        if (!isVisible(el)) continue;
        const st = readText(el);
        if (st.length >= 2 && st.length <= 45 && !/باز|بسته|open|closed|ویژه/i.test(st)) skillSet.add(st);
        if (skillSet.size >= 8) break;
      }
      const item = { site: a.id, url, title, budget, ageText, snippet, skills: [...skillSet], sourceScore: linkScore };
      const old = found.get(url);
      const richness = (budget ? 3 : 0) + Math.min(5, Math.floor(snippet.length / 120)) + skillSet.size;
      const oldRichness = old ? (old.budget ? 3 : 0) + Math.min(5, Math.floor((old.snippet || "").length / 120)) + (old.skills?.length || 0) : -1;
      if (!old || richness > oldRichness) found.set(url, item);
    }
    const items = [...found.values()]
      .filter((x) => x.title.length >= 5)
      .sort((x, y) => y.sourceScore - x.sourceScore || (y.snippet?.length || 0) - (x.snippet?.length || 0))
      .slice(0, 40);
    return { ok: true, site: a.id, pageUrl: canonicalUrl(), count: items.length, items };
  }

  window.BidCopilotAdapter = {
    scanList() { return scanProjectList(); },

    async inspect() {
      const a = adapter();
      await expandDetailsIfAvailable(a);
      const bodyText = document.body?.innerText || "";
      const contextual = contextualProjectText(a);
      const proposal = firstVisible(a.proposalSelectors);
      const comp = competitionSnapshot(bodyText);
      const price = proposal ? lockedField(a, proposal, "price") : null;
      const duration = proposal ? lockedField(a, proposal, "duration") : null;
      return {
        site: a.id,
        url: canonicalUrl(),
        title: projectTitle(a),
        description: bestDescription(a, contextual).slice(0, 10000),
        budget: findBudget(a, bodyText, contextual),
        skills: skills(a),
        clientInfo: clientInfo(),
        proposalCount: comp.count,
        competitionLevel: comp.level,
        proposalCountSource: comp.source,
        competitionConfidence: comp.confidence,
        detected: {
          proposal: !!proposal,
          price: !!price,
          duration: !!duration,
          openForm: !!findProposalOpener(a),
          submit: !!findSubmit(a)
        }
      };
    },

    openProposalForm() {
      const a = adapter();
      if (firstVisible(a.proposalSelectors)) return { ok: true, alreadyOpen: true };
      const opener = findProposalOpener(a);
      if (!opener) return { ok: false, reason: "Proposal form opener was not detected." };
      opener.scrollIntoView({ behavior: "smooth", block: "center" });
      opener.click();
      return { ok: true, opened: true };
    },

    fill({ bid, price, duration }) {
      const a = adapter();
      const proposal = firstVisible(a.proposalSelectors);
      if (!proposal) return { ok: false, reason: "Proposal textarea was not detected on this page." };
      const priceEl = lockedField(a, proposal, "price");
      const durationEl = lockedField(a, proposal, "duration");
      if (price && !priceEl) return { ok: false, reason: "Locked bid-price field was not detected; no numeric field was changed." };
      if (duration && !durationEl) return { ok: false, reason: "Locked delivery-days field was not detected; no numeric field was changed." };
      setNativeValue(proposal, bid);
      if (price) setNativeValue(priceEl, String(price).replace(/[^\d.]/g, ""));
      if (duration) setNativeValue(durationEl, String(duration).replace(/[^\d]/g, ""));
      proposal.scrollIntoView({ behavior: "smooth", block: "center" });
      proposal.focus();
      return { ok: true, locked: true, filled: { proposal: true, price: !!priceEl, duration: !!durationEl } };
    },

    submit() {
      const a = adapter();
      const submit = findSubmit(a);
      if (!submit) return { ok: false, reason: "Final submit button was not detected inside the proposal form." };
      submit.scrollIntoView({ behavior: "smooth", block: "center" });
      submit.click();
      return { ok: true };
    }
  };
})();
