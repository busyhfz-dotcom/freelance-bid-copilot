importScripts("domain-engine.js", "guard-policy.js");

const ENGINE_VERSION = "0.7.5";

const DEFAULTS = {
  panelUrl: "https://www.freelancerpanel.ir",
  copilotKey: "change-me",
  autoSubmit: true,
  defaultDuration: "",
  freelancerProfile: "",
  preferredDomains: [],
  minMatchScore: 70,
  minJobScore: 65
};

async function settings() { return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) }; }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error("No active tab"); return tab; }
function supportedMarketplace(url = "") { try { const h = new URL(url).hostname.toLowerCase(); return h === "kaya.ir" || h.endsWith(".kaya.ir") || h === "ponisha.ir" || h.endsWith(".ponisha.ir"); } catch { return false; } }
function isMissingReceiver(error) { return /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error || "")); }
async function injectContent(tab) { if (!supportedMarketplace(tab.url)) throw new Error("افزونه را روی صفحه پروژه یا لیست پروژه‌ها در کایا یا پونیشا باز کن."); await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["adapter-core.js", "adapters.js", "content.js"] }); }
async function contentReady(tab) { try { const pong = await chrome.tabs.sendMessage(tab.id, { type: "PING" }); return pong?.ok && pong.version === ENGINE_VERSION; } catch { return false; } }
async function ensureContent(tab) { if (!supportedMarketplace(tab.url)) throw new Error("افزونه را روی صفحه پروژه یا لیست پروژه‌ها در کایا یا پونیشا باز کن."); if (await contentReady(tab)) return; await injectContent(tab); if (!(await contentReady(tab))) throw new Error("ارتباط افزونه با صفحه برقرار نشد؛ صفحه را یک‌بار Refresh کن."); }
async function tabMessage(type, payload) { const tab = await activeTab(); await ensureContent(tab); try { return await chrome.tabs.sendMessage(tab.id, { type, payload }); } catch (e) { if (!isMissingReceiver(e)) throw e; await injectContent(tab); return chrome.tabs.sendMessage(tab.id, { type, payload }); } }

async function recordWake(reason) { await chrome.storage.local.set({ extensionRuntime: { version: ENGINE_VERSION, reason, awakeAt: new Date().toISOString() } }); }
chrome.runtime.onInstalled.addListener(() => { void recordWake("installed"); });
chrome.runtime.onStartup.addListener(() => { void recordWake("startup"); });
void recordWake("service-worker");

async function ensureProposalForm() {
  let inspected = await tabMessage("INSPECT");
  if (inspected?.ok && inspected.project?.detected?.proposal) return inspected.project;
  const opened = await tabMessage("OPEN_FORM");
  if (!opened?.ok) throw new Error(opened?.reason || "فرم پیشنهاد پیدا نشد.");
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    inspected = await tabMessage("INSPECT").catch(() => null);
    if (inspected?.ok && inspected.project?.detected?.proposal) return inspected.project;
  }
  throw new Error("فرم باز شد اما فیلد پیشنهاد تشخیص داده نشد.");
}

async function panelRequest(path, options = {}) {
  const s = await settings();
  if (!/^https:\/\//i.test(s.panelUrl) && !/^http:\/\/localhost(?::\d+)?$/i.test(s.panelUrl)) throw new Error("آدرس پنل افزونه معتبر نیست.");
  if (!s.copilotKey || s.copilotKey === "change-me") throw new Error("ابتدا COPILOT_KEY را در تنظیمات افزونه وارد و اتصال را آزمایش کن.");
  const r = await fetch(`${s.panelUrl.replace(/\/$/, "")}${path}`, { ...options, headers: { "Content-Type": "application/json", "X-Copilot-Key": s.copilotKey, ...(options.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Panel error ${r.status}`);
  return d;
}
async function generate(project) { const s = await settings(); const data = await panelRequest("/api/generate", { method: "POST", body: JSON.stringify({ ...project, freelancerProfile: s.freelancerProfile || "", preferredDomains: s.preferredDomains || [], capturedAt: new Date().toISOString() }) }); if (self.CopilotGuard.unsafeBid(data.bid)) throw new Error("خروجی مدل قابل نمایش نیست؛ دوباره تلاش کن."); data.engineVersion = ENGINE_VERSION; await chrome.storage.local.set({ latestGenerated: data }); return data; }
async function markStatus(url, status) { try { await panelRequest("/api/projects", { method: "PATCH", body: JSON.stringify({ url, status }) }); } catch {} }

function keyFor(url = "") { try { const u = new URL(url); u.hash = ""; for (const key of [...u.searchParams.keys()]) if (/^(utm_.+|ref|source|from|campaign|tracking|fbclid|gclid)$/i.test(key)) u.searchParams.delete(key); u.pathname = u.pathname.replace(/\/+$/, "") || "/"; return u.toString(); } catch { return String(url || "").trim(); } }
function titleKey(item = {}) { return `${String(item.site || "").toLowerCase()}:${String(item.title || "").toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`; }
function blockedCountry(item = {}) { const location = [item.country, item.clientCountry, item.employerCountry, item.location, item.clientLocation, item.employerLocation, item.clientInfo].filter(Boolean).join(" "); return /(?:^|[\s،,:;()\-])(پاکستان|بنگلادش|هندوستان|هند|pakistan|bangladesh|india|indian|pakistani|bangladeshi)(?=$|[\s،,:;()\-])/i.test(location); }
async function history() { return (await chrome.storage.local.get({ bidHistory: {} })).bidHistory || {}; }
async function setHistory(item, status) { const h = await history(); const entry = { status, at: new Date().toISOString() }; h[keyFor(item.url)] = entry; if (titleKey(item)) h[titleKey(item)] = entry; await chrome.storage.local.set({ bidHistory: h }); }
async function duplicate(item) { const h = await history(); return h[keyFor(item.url)] || h[titleKey(item)] || null; }
async function resetGuard(item) { const h = await history(); delete h[keyFor(item.url)]; delete h[titleKey(item)]; await chrome.storage.local.set({ bidHistory: h }); }

function roughMatch(item, s) {
  return self.CopilotDomain.matchProject(item, s.freelancerProfile || "", s.preferredDomains || []);
}

function freshnessScore(ageText = "") {
  const t = ageText.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLowerCase();
  if (/لحظاتی|همین الان|just now/.test(t)) return 100;
  const n = Number(t.match(/\d+/)?.[0] || 0);
  if (/دقیقه|minute/.test(t)) return n <= 30 ? 100 : 94;
  if (/ساعت|hour/.test(t)) return n <= 3 ? 94 : n <= 8 ? 87 : n <= 24 ? 78 : 68;
  if (/روز|day/.test(t)) return n <= 1 ? 70 : n <= 2 ? 60 : n <= 5 ? 48 : 38;
  return 58;
}
function scanDecision(score, prior, matchScore, domainGate) {
  if (prior) return "DONE";
  if (domainGate === "blocked") return "SKIP";
  if (domainGate === "related" || domainGate === "unknown") return score >= 52 ? "REVIEW" : "SKIP";
  if (!Number.isFinite(matchScore)) return "REVIEW";
  if (matchScore < 55) return "SKIP";
  if (matchScore < 68) return "REVIEW";
  if (score >= 72) return "OPEN";
  if (score >= 58) return "REVIEW";
  return "SKIP";
}
async function rankScannedProjects(scan) {
  const s = await settings();
  const h = await history();
  const unique = new Map();
  for (const item of scan.items || []) {
    if (blockedCountry(item)) continue;
    const identity = titleKey(item) || keyFor(item.url);
    if (!unique.has(identity)) unique.set(identity, item);
  }
  const ranked = [...unique.values()].map((item) => {
    const match = roughMatch(item, s);
    const matchScore = Number.isFinite(match.score) ? match.score : 50;
    const fresh = freshnessScore(item.ageText || "");
    const brief = (item.snippet || "").length >= 180 ? 90 : (item.snippet || "").length >= 90 ? 78 : 58;
    const budget = item.budget ? 88 : 52;
    const prior = h[keyFor(item.url)] || h[titleKey(item)] || null;
    let scoutScore = Math.round(matchScore * 0.74 + fresh * 0.12 + brief * 0.07 + budget * 0.07);
    if (match.domainGate === "blocked") scoutScore = Math.min(scoutScore, 39);
    else if (match.domainGate === "related" || match.domainGate === "unknown") scoutScore = Math.min(scoutScore, 64);
    if (prior) scoutScore = Math.min(scoutScore, 35);
    const resolvedMatch = Number.isFinite(match.score) ? match.score : null;
    return { ...item, matchScore: resolvedMatch, matchOverlap: match.overlap, skillGaps: match.skillGaps || [], primaryDomain: match.primaryDomain || "", matchedDomain: match.matchedDomain || "", freshnessScore: fresh, scoutScore, priorStatus: prior?.status || "", domainGate: match.domainGate || "unknown", allowedDomains: match.allowedDomains || [], allowedDomainLabels: match.allowedDomainLabels || [], matchReason: match.matchReason || "", queueDecision: scanDecision(scoutScore, prior, resolvedMatch, match.domainGate), reviewedAt: item.reviewedAt || "", finalDecision: item.finalDecision || "" };
  }).sort((a, b) => {
    const aDone = a.queueDecision === "DONE" ? 1 : 0;
    const bDone = b.queueDecision === "DONE" ? 1 : 0;
    return aDone - bDone || b.scoutScore - a.scoutScore || b.freshnessScore - a.freshnessScore;
  });
  const queue = { engineVersion: ENGINE_VERSION, site: scan.site, pageUrl: scan.pageUrl, scannedAt: new Date().toISOString(), count: ranked.length, items: ranked.slice(0, 20) };
  await chrome.storage.local.set({ scanQueue: queue });
  return queue;
}

async function markQueueReviewed(url, result = {}) {
  const stored = await chrome.storage.local.get({ scanQueue: null });
  const queue = stored.scanQueue;
  if (!queue?.items?.length) return;
  const target = keyFor(url);
  queue.items = queue.items.map((item) => keyFor(item.url) === target ? {
    ...item,
    reviewedAt: new Date().toISOString(),
    finalDecision: result.decision || item.finalDecision || "",
    finalJobScore: Number.isFinite(result.jobScore) ? result.jobScore : item.finalJobScore,
    finalMatchScore: Number.isFinite(result.matchScore) ? result.matchScore : item.finalMatchScore
  } : item);
  await chrome.storage.local.set({ scanQueue: queue });
}

async function nextQueueItem(currentUrl = "") {
  const [{ scanQueue = null }, h] = await Promise.all([chrome.storage.local.get({ scanQueue: null }), history()]);
  if (!scanQueue?.items?.length) return null;
  const current = keyFor(currentUrl);
  const rank = { OPEN: 0, REVIEW: 1, SKIP: 2, DONE: 3 };
  const candidates = scanQueue.items
    .filter((item) => keyFor(item.url) !== current)
    .filter((item) => !item.reviewedAt && !h[keyFor(item.url)] && !h[titleKey(item)])
    .filter((item) => item.queueDecision === "OPEN" || item.queueDecision === "REVIEW")
    .sort((a, b) => (rank[a.queueDecision] ?? 9) - (rank[b.queueDecision] ?? 9) || (b.scoutScore || 0) - (a.scoutScore || 0));
  return candidates[0] || null;
}

function autoGuard(item, s, formProject, dup) {
  const reasons = [];
  if (dup) reasons.push("برای این پروژه قبلاً Fill/Submit ثبت شده است.");
  if (!s.freelancerProfile.trim() && !(s.preferredDomains || []).length) reasons.push("پروفایل یا حوزه کاری تنظیم نشده است.");
  if (item.domainGate !== "allowed") reasons.push("حوزه اصلی پروژه داخل حوزه‌های کاری مجاز نیست.");
  if (!Number.isFinite(item.matchScore) || item.matchScore < Number(s.minMatchScore || 70)) reasons.push(`Match باید حداقل ${s.minMatchScore || 70}% باشد.`);
  if (!Number.isFinite(item.jobScore) || item.jobScore < Number(s.minJobScore || 65)) reasons.push(`Job Score باید حداقل ${s.minJobScore || 65}% باشد.`);
  if (!item.priceWithinBudget) reasons.push("قیمت داخل بودجه قابل تأیید نیست.");
  if ((item.bidQualityScore || 0) < 70) reasons.push("کیفیت بید زیر حد امن است.");
  if (!item.recommendedPrice || !item.recommendedDuration) reasons.push("قیمت یا زمان تحویل مشخص نیست.");
  if (item.decision !== "BID") reasons.push(`تصمیم سیستم ${item.decision || "MAYBE"} است؛ Auto-submit فقط برای BID مجاز است.`);
  if (item.competitionLevel === "unknown" || item.proposalCountSource === "unknown" || !Number.isFinite(item.proposalCount)) reasons.push("رقابت پروژه با اطمینان تشخیص داده نشده است.");
  const d = formProject?.detected || {};
  if (!d.proposal || !d.price || !d.duration || !d.submit) reasons.push("همه فیلدهای فرم یا دکمه ثبت نهایی تشخیص داده نشده‌اند.");
  return reasons;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "COPILOT_INSPECT") { sendResponse(await tabMessage("INSPECT")); return; }
      if (message.type === "COPILOT_HEALTH") { await recordWake("health-check"); sendResponse({ ok: true, version: ENGINE_VERSION }); return; }
      if (message.type === "COPILOT_SCAN_LIST") {
        const scan = await tabMessage("SCAN_LIST");
        if (!scan?.ok) throw new Error(scan?.reason || "لیست پروژه‌ها خوانده نشد.");
        if (!scan.count) throw new Error("کارت پروژه‌ای روی این صفحه تشخیص داده نشد. صفحه لیست پروژه‌ها را باز کن.");
        sendResponse({ ok: true, queue: await rankScannedProjects(scan) }); return;
      }
      if (message.type === "COPILOT_GET_SCAN_QUEUE") { const { scanQueue = null } = await chrome.storage.local.get({ scanQueue: null }); if (scanQueue && scanQueue.engineVersion !== ENGINE_VERSION) { await chrome.storage.local.remove("scanQueue"); sendResponse({ ok: true, queue: null }); } else sendResponse({ ok: true, queue: scanQueue }); return; }
      if (message.type === "COPILOT_CLEAR_SCAN_QUEUE") { await chrome.storage.local.remove("scanQueue"); sendResponse({ ok: true }); return; }
      if (message.type === "COPILOT_OPEN_SCAN_ITEM") {
        const url = message.payload?.url;
        if (!url || !supportedMarketplace(url)) throw new Error("آدرس پروژه معتبر نیست.");
        await chrome.tabs.create({ url, active: true });
        sendResponse({ ok: true }); return;
      }
      if (message.type === "COPILOT_NEXT_SCAN_ITEM") {
        const tab = await activeTab();
        const next = await nextQueueItem(tab.url || "");
        if (!next) throw new Error("پروژه بررسی‌نشده دیگری در Quick Bid Queue باقی نمانده است.");
        await chrome.tabs.update(tab.id, { url: next.url, active: true });
        sendResponse({ ok: true, item: next }); return;
      }
      if (message.type === "COPILOT_GENERATE") {
        const i = await tabMessage("INSPECT");
        if (!i?.ok) throw new Error(i?.reason || "صفحه خوانده نشد");
        if (blockedCountry(i.project)) throw new Error("این پروژه به‌دلیل کشور کارفرما از صف بیدگذاری حذف شده است.");
        const result = await generate(i.project);
        await markQueueReviewed(i.project.url, result);
        sendResponse({ ok: true, result }); return;
      }
      if (message.type === "COPILOT_APPROVE_FILL") {
        const stored = await chrome.storage.local.get("latestGenerated"); const item = stored.latestGenerated;
        if (!item?.bid || item.engineVersion !== ENGINE_VERSION) throw new Error("اول با نسخه فعلی Analyze & Generate را بزن.");
        const fillBlock = self.CopilotGuard.fillBlockReason(item); if (fillBlock) throw new Error(fillBlock);
        const inspected = await tabMessage("INSPECT"); if (!inspected?.ok) throw new Error("صفحه پروژه خوانده نشد.");
        if (keyFor(item.url) !== keyFor(inspected.project.url)) throw new Error("بید تولیدشده مربوط به پروژه دیگری است.");
        const dup = await duplicate(item); if (dup) throw new Error("این پروژه قبلاً توسط افزونه Fill/Submit شده؛ اگر عمدی است Reset guard را بزن.");
        const s = await settings(); const formProject = await ensureProposalForm();
        const fill = await tabMessage("FILL", { bid: item.bid, price: item.recommendedPrice || "", duration: s.defaultDuration || item.recommendedDuration || "" });
        if (!fill?.ok) throw new Error(fill?.reason || "فرم پر نشد.");
        let submitted = false, autoBlocked = [];
        if (s.autoSubmit) { autoBlocked = autoGuard(item, s, formProject, null); if (!autoBlocked.length) { const sub = await tabMessage("SUBMIT"); if (!sub?.ok) throw new Error(sub?.reason || "ارسال نهایی انجام نشد."); submitted = true; } }
        await setHistory(item, submitted ? "submitted" : "filled"); await markStatus(item.url, submitted ? "submitted" : "filled");
        sendResponse({ ok: true, result: item, fill, submitted, autoBlocked }); return;
      }
      if (message.type === "COPILOT_RESET_GUARD") { const i = await tabMessage("INSPECT"); if (i?.ok) await resetGuard(i.project); sendResponse({ ok: true }); return; }
      sendResponse({ ok: false, reason: "Unknown action" });
    } catch (e) { sendResponse({ ok: false, reason: e?.message || String(e) }); }
  })();
  return true;
});
