const ENGINE_VERSION = "0.6.0";
const $ = (id) => document.getElementById(id);
function send(type, payload) { return chrome.runtime.sendMessage({ type, payload }); }
function status(t, k = "") { $("status").textContent = t; $("status").className = `status ${k}`; }
function busy(on) { document.querySelectorAll("button").forEach((b) => { b.disabled = on; }); }
let currentQueue = null;
let currentProjectUrl = "";
function cleanUrl(url = "") { try { const u = new URL(url); u.hash = ""; return u.toString(); } catch { return url; } }
function sameUrl(a, b) { return !!a && !!b && cleanUrl(a) === cleanUrl(b); }

function showGenerated(i) {
  if (!i?.bid) return;
  $("preview").dataset.ready = "1";
  $("preview").classList.remove("hidden");
  $("decision").textContent = i.decision || "MAYBE";
  $("decision").className = (i.decision || "MAYBE").toLowerCase();
  $("decisionReason").textContent = i.decisionReason || "";
  $("jobScore").textContent = Number.isFinite(i.jobScore) ? `${i.jobScore}%` : "—";
  $("matchScore").textContent = Number.isFinite(i.matchScore) ? `${i.matchScore}%` : "پروفایل؟";
  $("bidQuality").textContent = Number.isFinite(i.bidQualityScore) ? `${i.bidQualityScore}%` : "—";
  $("recommendedPrice").textContent = i.recommendedPrice || "—";
  $("recommendedDuration").textContent = i.recommendedDuration ? `${i.recommendedDuration} روز` : "—";
  $("competition").textContent = `Competition: ${i.competitionLevel || "unknown"}${Number.isFinite(i.proposalCount) ? ` • ${i.proposalCount} bids` : ""}${i.proposalCountSource === "visible_cards" ? " • cards" : i.proposalCountSource === "section_signals" ? " • section" : ""}`;
  $("guard").textContent = `Guard: ${i.guardReady ? "ready" : "review"}`;
  $("guard").className = i.guardReady ? "good" : "warn";
  const gateLabels = { allowed: "IN PROFILE", related: "RELATED DOMAIN", blocked: "OUT OF PROFILE", unknown: "DOMAIN UNKNOWN", profile_missing: "PROFILE MISSING" };
  const gateLabel = gateLabels[i.domainGate] || "";
  $("matchReason").textContent = `${gateLabel ? gateLabel + " • " : ""}${i.matchReason || ""}`;
  $("matchReason").classList.toggle("domainBlocked", i.domainGate === "blocked");
  const gaps = Array.isArray(i.skillGaps) ? i.skillGaps : [];
  $("skillGap").textContent = gaps.length ? `Skill Gap: ${gaps.join(" / ")}` : "";
  $("skillGap").classList.toggle("hidden", !gaps.length);
  $("bidPreview").textContent = i.bid;
  updatePageMode();
}

function queueDecisionClass(value = "") { return value.toLowerCase().replace(/[^a-z]/g, ""); }
function renderQueue(queue) {
  currentQueue = queue || null;
  if (!queue?.items?.length) { $("queue").classList.add("hidden"); return; }
  $("queue").classList.remove("hidden");
  $("queueMeta").textContent = `${queue.count} پروژه • رتبه‌بندی اولیه`;
  const host = $("queueItems"); host.textContent = "";
  queue.items.slice(0, 8).forEach((item, index) => {
    const row = document.createElement("div"); row.className = "queueItem";
    const top = document.createElement("div"); top.className = "qiTop";
    const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = `#${index + 1}`;
    const decision = document.createElement("span"); decision.className = `qDecision ${queueDecisionClass(item.queueDecision)}`; decision.textContent = item.queueDecision || "REVIEW";
    const score = document.createElement("strong"); score.textContent = `${item.scoutScore ?? "—"}%`;
    top.append(rank, decision, score);
    const title = document.createElement("div"); title.className = "qiTitle"; title.textContent = item.title || "بدون عنوان";
    const meta = document.createElement("div"); meta.className = "qiMeta";
    const pieces = [];
    if (Number.isFinite(item.matchScore)) pieces.push(`Match ${item.matchScore}%`);
    if (item.budget) pieces.push(item.budget);
    if (item.ageText) pieces.push(item.ageText);
    if (item.primaryDomain) pieces.push(item.primaryDomain);
    if (item.domainGate === "blocked") pieces.push("OUT OF PROFILE");
    else if (item.domainGate === "related") pieces.push("RELATED DOMAIN");
    else if (item.domainGate === "unknown") pieces.push("DOMAIN UNKNOWN");
    if (item.skillGaps?.length) pieces.push(`Gap: ${item.skillGaps.join("/")}`);
    if (item.priorStatus) pieces.push(`قبلاً: ${item.priorStatus}`);
    meta.textContent = pieces.join(" • ") || "اطلاعات محدود";
    const open = document.createElement("button"); open.className = "qiOpen"; open.textContent = "باز کن ↗";
    open.onclick = async () => { const r = await send("COPILOT_OPEN_SCAN_ITEM", { url: item.url }); if (!r?.ok) status(r?.reason || "پروژه باز نشد", "error"); };
    row.append(top, title, meta, open); host.append(row);
  });
  $("openBest").dataset.url = queue.items.find((x) => x.queueDecision === "OPEN" && !x.reviewedAt)?.url || queue.items.find((x) => x.queueDecision === "REVIEW" && !x.reviewedAt)?.url || "";
  updatePageMode();
}

function updatePageMode() {
  const scoutPage = !!currentQueue?.pageUrl && sameUrl(currentQueue.pageUrl, currentProjectUrl);
  const detailPage = !!currentProjectUrl && !!currentQueue?.items?.some((x) => sameUrl(x.url, currentProjectUrl));
  $("queue").classList.toggle("compact", detailPage && !scoutPage);
  $("openBest").classList.toggle("hidden", !scoutPage);
  $("nextBest").classList.toggle("hidden", !detailPage || scoutPage);
  $("project").classList.toggle("hidden", scoutPage);
  $("preview").classList.toggle("hidden", scoutPage || !$("preview").dataset.ready);
  $("actions").classList.toggle("hidden", scoutPage);
  $("mini").classList.toggle("hidden", scoutPage);
}

async function loadQueue() {
  try { const r = await send("COPILOT_GET_SCAN_QUEUE"); if (r?.ok) renderQueue(r.queue); return r?.queue || null; } catch { return null; }
}

async function inspect() {
  try {
    const r = await send("COPILOT_INSPECT");
    if (!r?.ok) throw new Error(r?.reason || "صفحه خوانده نشد.");
    const p = r.project;
    currentProjectUrl = p.url || "";
    $("site").textContent = `${p.site.toUpperCase()} • ${new URL(p.url).hostname}`;
    $("project").classList.remove("hidden");
    $("title").textContent = p.title || "عنوان تشخیص داده نشد";
    $("budget").textContent = p.budget || "بودجه تشخیص داده نشد";
    $("detected").innerHTML = Object.entries(p.detected || {}).map(([k, v]) => `<span class="${v ? "ok" : ""}">${k}: ${v ? "✓" : "—"}</span>`).join("");
    chrome.storage.local.get("latestGenerated", (s) => { if (s.latestGenerated?.engineVersion === ENGINE_VERSION && sameUrl(s.latestGenerated?.url, p.url)) showGenerated(s.latestGenerated); else updatePageMode(); });
    updatePageMode();
    return p;
  } catch (e) { status(e.message, "error"); return null; }
}

async function action(type, success) {
  busy(true); status("در حال انجام…");
  try {
    const r = await send(type);
    if (!r?.ok) throw new Error(r?.reason || "عملیات ناموفق بود");
    if (r.result) showGenerated(r.result);
    status(success(r), "ok"); await inspect();
  } catch (e) { status(e.message, "error"); } finally { busy(false); }
}

$("scanList").onclick = async () => {
  busy(true); status("در حال اسکن کارت‌های پروژه…");
  try {
    const r = await send("COPILOT_SCAN_LIST");
    if (!r?.ok) throw new Error(r?.reason || "اسکن انجام نشد.");
    renderQueue(r.queue);
    await inspect();
    const best = r.queue?.items?.[0];
    status(`${r.queue?.count || 0} پروژه اسکن شد${best ? ` • بهترین Scout ${best.scoutScore}%` : ""}`, "ok");
  } catch (e) { status(e.message, "error"); } finally { busy(false); }
};
$("openBest").onclick = async () => { const url = $("openBest").dataset.url; if (!url) return status("پروژه مناسب در صف پیدا نشد.", "error"); const r = await send("COPILOT_OPEN_SCAN_ITEM", { url }); if (!r?.ok) status(r?.reason || "پروژه باز نشد", "error"); };
$("nextBest").onclick = async () => { busy(true); status("در حال باز کردن پروژه بعدی…"); try { const r = await send("COPILOT_NEXT_SCAN_ITEM"); if (!r?.ok) throw new Error(r?.reason || "پروژه بعدی پیدا نشد."); status(`Next Best • Scout ${r.item?.scoutScore ?? "—"}%`, "ok"); } catch (e) { status(e.message, "error"); } finally { busy(false); } };
$("clearQueue").onclick = async () => { await send("COPILOT_CLEAR_SCAN_QUEUE"); renderQueue(null); status("صف Quick Bid پاک شد.", "ok"); };
$("inspect").onclick = () => inspect();
$("generate").onclick = () => action("COPILOT_GENERATE", (r) => `تحلیل آماده شد • Job ${r.result?.jobScore ?? "—"}% • Quality ${r.result?.bidQualityScore ?? "—"}%`);
$("approve").onclick = () => action("COPILOT_APPROVE_FILL", (r) => r.submitted ? "بید با گاردهای ایمنی ارسال شد." : r.autoBlocked?.length ? `فرم پر شد؛ Auto-submit متوقف شد: ${r.autoBlocked.join(" | ")}` : "فرم پر شد؛ ارسال نهایی با خودت است.");
$("reset").onclick = () => action("COPILOT_RESET_GUARD", () => "گارد پروژه فعلی ریست شد.");
chrome.storage.sync.get({ autoSubmit: false }, (s) => { $("submitSuffix").textContent = s.autoSubmit ? "→ Safe Submit" : ""; });
(async () => { await loadQueue(); await inspect(); })();
