import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { normalizeProjectInspection } from "./project-normalizer.mjs";
import { blockedRetryDelayMs, describeWorkerError } from "./runtime-policy.mjs";
import { budgetAllowsApprovedPrice } from "./budget-policy.mjs";

const VERSION = "0.7.0";
const root = path.resolve(import.meta.dirname, "../..");
const dataDir = path.resolve(process.env.BROWSER_DATA_DIR || "/data");
const panelUrl = String(process.env.PANEL_URL || "").replace(/\/$/, "");
const copilotKey = process.env.COPILOT_KEY || "";
const workerKey = process.env.WORKER_KEY || "";
const workerId = process.env.WORKER_ID || "primary-worker";
const profile = process.env.FREELANCER_PROFILE || "";
const domains = String(process.env.PREFERRED_DOMAINS || "").split(",").map((value) => value.trim()).filter(Boolean);
const scanInterval = clamp(process.env.SCAN_INTERVAL_SECONDS, 300, 300, 3600) * 1000;
const approvalPoll = clamp(process.env.APPROVAL_POLL_SECONDS, 15, 15, 60) * 1000;
const inspectLimit = clamp(process.env.INSPECT_LIMIT_PER_SITE, 5, 1, 5);
const topPerCycle = clamp(process.env.TOP_BIDS_PER_CYCLE, 1, 1, 1);
const automationMinScore = clamp(process.env.AUTOMATION_MIN_SCORE, 72, 65, 95);
const blockedSiteRetry = blockedRetryDelayMs(process.env.BLOCKED_SITE_RETRY_MINUTES);
const port = clamp(process.env.PORT, 8080, 1, 65535);

const markets = {
  kaya: {
    listUrl: process.env.KAYA_LIST_URL || "https://kaya.ir/projects",
    statePath: process.env.KAYA_STORAGE_STATE_PATH || path.join(dataDir, "auth/kaya.storage-state.json"),
    stateBase64: process.env.KAYA_STORAGE_STATE_B64 || ""
  },
  ponisha: {
    listUrl: process.env.PONISHA_LIST_URL || "https://ponisha.ir/search/projects",
    statePath: process.env.PONISHA_STORAGE_STATE_PATH || path.join(dataDir, "auth/ponisha.storage-state.json"),
    stateBase64: process.env.PONISHA_STORAGE_STATE_B64 || ""
  }
};

let browser;
let stopping = false;
let approvalBusy = false;
let scanBusy = false;
let lastScanAt = "";
let status = "starting";
let statusMessage = "Worker is starting";
const contexts = new Map();
const locks = new Map();
const blockedUntil = new Map();
const sessionState = { kaya: "error", ponisha: "error" };
const seenFile = path.join(dataDir, "state/seen.json");
let seen = new Set();
let adapterBundle = "";

function clamp(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, value, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function initializeSensitiveState(market) {
  if (await fileExists(market.statePath)) {
    await fs.chmod(market.statePath, 0o600);
    return;
  }
  if (!market.stateBase64) return;
  const decoded = Buffer.from(market.stateBase64, "base64").toString("utf8");
  JSON.parse(decoded);
  await atomicWrite(market.statePath, decoded);
}

async function api(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 20_000);
  try {
    const response = await fetch(`${panelUrl}${pathname}`, {
      method: options.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.worker !== false ? { "X-Worker-Key": workerKey } : { "X-Copilot-Key": copilotKey })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${data.error || "request failed"}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function heartbeat(nextStatus = status, message = statusMessage, site = "") {
  status = nextStatus;
  statusMessage = message;
  await api("/api/automation/heartbeat", {
    body: { workerId, status, message, currentSite: site, lastSeenAt: new Date().toISOString(), lastScanAt, sessionState, version: VERSION }
  }).catch((error) => console.error("heartbeat:", error.message));
}

async function report(input) {
  return api("/api/reports", {
    body: {
      ...input,
      workerId,
      createdAt: new Date().toISOString()
    }
  }).catch((error) => {
    console.error("report:", error.message);
    return null;
  });
}

function hasBlock(text, url) {
  const value = `${url}\n${text}`.toLowerCase();
  if (/captcha|recaptcha|hcaptcha|verify you are human|من ربات نیستم|کپچا/.test(value)) return "captcha";
  if (/\/login|\/signin|ورود به حساب|وارد حساب|sign in|log in/.test(value)) return "login_required";
  return "";
}

async function pageBlock(page) {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return hasBlock(text.slice(0, 25_000), page.url());
}

async function injectAdapters(page) {
  await page.addScriptTag({ content: adapterBundle });
  const ready = await page.evaluate(() => Boolean(window.BidCopilotAdapter?.inspect && window.BidCopilotAdapter?.scanList));
  if (!ready) throw new Error("Marketplace adapter was not initialized");
}

async function contextFor(site) {
  if (contexts.has(site)) return contexts.get(site);
  const market = markets[site];
  await initializeSensitiveState(market);
  const exists = await fileExists(market.statePath);
  const context = await browser.newContext({
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    viewport: { width: 1440, height: 900 },
    storageState: exists ? market.statePath : undefined
  });
  contexts.set(site, context);
  sessionState[site] = exists ? "ready" : "login_required";
  return context;
}

async function persistContext(site) {
  const context = contexts.get(site);
  if (!context) return;
  try {
    await context.storageState({ path: markets[site].statePath });
    await fs.chmod(markets[site].statePath, 0o600);
  } catch {}
}

async function releaseContext(site) {
  const context = contexts.get(site);
  if (!context) return;
  await persistContext(site);
  contexts.delete(site);
  await context.close().catch(() => undefined);
}

async function withSiteLock(site, operation) {
  const previous = locks.get(site) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(site, current);
  try { return await current; } finally { if (locks.get(site) === current) locks.delete(site); }
}

async function scanSite(site) {
  return withSiteLock(site, async () => {
    const retryAt = blockedUntil.get(site) || 0;
    if (retryAt > Date.now()) return [];
    blockedUntil.delete(site);
    await heartbeat("scanning", `Scanning ${site}`, site);
    const context = await contextFor(site);
    const listingPage = await context.newPage();
    const candidates = [];
    try {
      await listingPage.goto(markets[site].listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const block = await pageBlock(listingPage);
      if (block) {
        sessionState[site] = block;
        blockedUntil.set(site, Date.now() + blockedSiteRetry);
        await heartbeat("blocked", `${site}: ${block}; manual login or CAPTCHA action is required`, site);
        return candidates;
      }
      sessionState[site] = "ready";
      await injectAdapters(listingPage);
      const listing = await listingPage.evaluate(() => window.BidCopilotAdapter.scanList());
      const freshItems = (listing?.items || []).filter((item) => item.url && !seen.has(item.url)).slice(0, inspectLimit);
      for (const item of freshItems) {
        const detailPage = await context.newPage();
        try {
          await detailPage.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          const projectBlock = await pageBlock(detailPage);
          if (projectBlock) {
            sessionState[site] = projectBlock;
            blockedUntil.set(site, Date.now() + blockedSiteRetry);
            await heartbeat("blocked", `${site}: ${projectBlock}; manual login or CAPTCHA action is required`, site);
            break;
          }
          await injectAdapters(detailPage);
          const inspected = normalizeProjectInspection({
            site,
            item,
            inspected: await detailPage.evaluate(() => window.BidCopilotAdapter.inspect()),
            currentUrl: detailPage.url()
          });
          if (!inspected.title || !inspected.url) throw new Error("Inspection missing title or URL after listing fallback");
          candidates.push({
            ...inspected,
            capturedAt: new Date().toISOString(),
            status: "generated",
            bid: "",
            jobScore: Number(item.score || 0),
            matchScore: Number(item.matchScore || item.score || 0)
          });
        } catch (error) {
          console.error(`inspect ${site} ${item.url}:`, error.message);
        } finally {
          await detailPage.close().catch(() => undefined);
        }
      }
      if (sessionState[site] === "ready") await heartbeat("scanning", `${site}: session ready`, site);
      return candidates;
    } finally {
      await listingPage.close().catch(() => undefined);
      await releaseContext(site);
    }
  });
}

async function scanCycle() {
  const candidates = [];
  let queuedCount = 0;
  let queueFailures = 0;
  for (const site of Object.keys(markets)) candidates.push(...await scanSite(site));
  const freshProjects = candidates;
  for (const project of freshProjects) {
    try {
      const result = await api("/api/automation/candidates", { body: project });
      if (result.created) queuedCount += 1;
      seen.add(project.url);
    } catch (error) {
      queueFailures += 1;
      console.error("queue candidate:", error.message);
    }
  }
  lastScanAt = new Date().toISOString();
  await atomicWrite(seenFile, JSON.stringify([...seen].slice(-5000)));
  await heartbeat("idle", `Scan complete; ${queuedCount} new project notification(s) sent`);
  await report({
    category: "scan",
    eventType: "scan_completed",
    level: queueFailures ? "warning" : "success",
    title: "اسکن دوره‌ای تکمیل شد",
    message: queuedCount
      ? `${queuedCount} آگهی جدید با لینک مستقیم به تلگرام ارسال شد.`
      : `${candidates.length} آگهی تازه بررسی شد؛ اعلان ارسال‌نشده‌ای باقی نماند.`,
    status: "idle",
    metadata: {
      candidateCount: candidates.length,
      selectedCount: freshProjects.length,
      queuedCount,
      failureCount: queueFailures,
      kayaSession: sessionState.kaya,
      ponishaSession: sessionState.ponisha
    }
  });
}

async function guardedScanCycle() {
  if (scanBusy) return;
  scanBusy = true;
  try { await scanCycle(); } finally { scanBusy = false; }
}

async function submitApproved(approval) {
  const site = String(approval.site || "").toLowerCase();
  if (!markets[site]) throw new Error("Unsupported marketplace in approval");
  return withSiteLock(site, async () => {
    await heartbeat("submitting", `Submitting approved bid ${approval.id}`, site);
    const context = await contextFor(site);
    const page = await context.newPage();
    try {
      await page.goto(approval.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const block = await pageBlock(page);
      if (block) throw new Error(`${site}: ${block}; submission stopped without bypass`);
      await injectAdapters(page);
      const inspected = normalizeProjectInspection({
        site,
        item: { ...(approval.project || {}), url: approval.url || approval.project?.url },
        inspected: await page.evaluate(() => window.BidCopilotAdapter.inspect()),
        currentUrl: page.url()
      });
      if (!inspected.title || !inspected.url) throw new Error("Fresh inspection missing title or URL after approval fallback");
      const fresh = await api("/api/generate", {
        worker: false,
        body: { ...inspected, freelancerProfile: profile, preferredDomains: domains, capturedAt: new Date().toISOString() }
      });
      const guardedBid = fresh.decision === "BID" && fresh.guardReady === true;
      const safeManualReview = fresh.decision === "MAYBE"
        && fresh.domainGate === "allowed"
        && fresh.priceWithinBudget === true
        && (fresh.bidQualityScore || 0) >= 70;
      if ((!guardedBid && !safeManualReview) || fresh.priceWithinBudget !== true) throw new Error("Fresh approval safety revalidation failed");
      if (new URL(fresh.url).origin !== new URL(approval.url).origin) throw new Error("Project origin changed after approval");
      if (!budgetAllowsApprovedPrice(fresh.budget, approval.project.recommendedPrice)) throw new Error("Approved price is outside the current project budget");

      const opened = await page.evaluate(() => window.BidCopilotAdapter.openProposalForm());
      if (!opened?.ok) throw new Error(opened?.reason || "Proposal form could not be opened");
      await page.waitForTimeout(700);
      const fill = await page.evaluate((payload) => window.BidCopilotAdapter.fill(payload), {
        bid: approval.project.bid,
        price: approval.project.recommendedPrice,
        duration: approval.project.recommendedDuration
      });
      if (!fill?.ok || !fill?.filled?.proposal || !fill?.filled?.price || !fill?.filled?.duration) throw new Error(fill?.reason || "Locked fields were not all filled");

      const beforeUrl = page.url();
      const clicked = await page.evaluate(() => window.BidCopilotAdapter.submit());
      if (!clicked?.ok) throw new Error(clicked?.reason || "Final submit control was not detected");
      await page.waitForTimeout(3500);
      const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      const postBlock = hasBlock(text.slice(0, 25_000), page.url());
      if (postBlock) throw new Error(`${site}: ${postBlock} appeared after submit; manual verification required`);
      const successText = /پیشنهاد.{0,40}(?:ثبت|ارسال).{0,20}(?:شد|موفق)|(?:proposal|bid).{0,30}(?:submitted|placed).{0,20}(?:successfully)?/i.test(text);
      const navigated = page.url() !== beforeUrl;
      const formStillVisible = await page.evaluate(() => Boolean(window.BidCopilotAdapter.inspect)).then(async () => {
        const state = await page.evaluate(() => window.BidCopilotAdapter.inspect());
        return Boolean(state?.detected?.proposal && state?.detected?.submit);
      }).catch(() => false);
      if (!successText && !navigated && formStillVisible) throw new Error("Submit was clicked but success could not be verified; no automatic retry will occur");
      await persistContext(site);
      return true;
    } finally {
      await page.close().catch(() => undefined);
      await releaseContext(site);
    }
  });
}

async function approvalCycle() {
  if (approvalBusy) return;
  approvalBusy = true;
  let approval;
  try {
    const claimed = await api("/api/automation/claim", { body: { workerId } });
    approval = claimed.approval;
    if (!approval) return;
    await submitApproved(approval);
    await api("/api/automation/result", { body: { id: approval.id, status: "submitted" } });
    await heartbeat("idle", `Bid ${approval.id} submitted and verified`, approval.site);
  } catch (error) {
    const message = describeWorkerError(error);
    console.error("approval:", message);
    if (approval?.id) await api("/api/automation/result", { body: { id: approval.id, status: "failed", error: message } }).catch(() => undefined);
    await heartbeat("blocked", message, approval?.site || "");
  } finally {
    approvalBusy = false;
  }
}

async function main() {
  if (!panelUrl.startsWith("https://") && !panelUrl.startsWith("http://127.0.0.1")) throw new Error("PANEL_URL must use HTTPS (localhost is allowed for development)");
  if (workerKey.length < 24 || !copilotKey) throw new Error("WORKER_KEY (24+ chars) and COPILOT_KEY are required");
  await fs.mkdir(path.dirname(seenFile), { recursive: true });
  seen = new Set(JSON.parse(await fs.readFile(seenFile, "utf8").catch(() => "[]")));
  adapterBundle = `${await fs.readFile(path.join(root, "extension/adapter-core.js"), "utf8")}\n${await fs.readFile(path.join(root, "extension/adapters.js"), "utf8")}`;
  browser = await chromium.launch({ headless: true });
  await heartbeat("idle", "Worker is online");
  await report({
    category: "worker",
    eventType: "worker_started",
    level: "success",
    title: "Worker آنلاین شد",
    message: "مرورگر خودکار Worker اجرا شد و اسکن دوره‌ای کایا و پونیشا فعال است.",
    status: "idle",
    metadata: { version: VERSION, scanIntervalSeconds: scanInterval / 1000 }
  });
  const handleScanError = async (error) => {
    const message = describeWorkerError(error);
    console.error("scan:", message);
    await heartbeat("error", message);
    await report({
      category: "scan",
      eventType: "scan_failed",
      level: "error",
      title: "اسکن دوره‌ای ناموفق بود",
      message,
      status: "error",
      metadata: { kayaSession: sessionState.kaya, ponishaSession: sessionState.ponisha }
    });
  };
  void guardedScanCycle().catch(handleScanError);
  const scanTimer = setInterval(() => void guardedScanCycle().catch(handleScanError), scanInterval);
  const heartbeatTimer = setInterval(() => void heartbeat(), 25_000);
  process.once("SIGTERM", () => shutdown([scanTimer, heartbeatTimer]));
  process.once("SIGINT", () => shutdown([scanTimer, heartbeatTimer]));
}

async function shutdown(timers) {
  if (stopping) return;
  stopping = true;
  timers.forEach(clearInterval);
  await Promise.all([...contexts.keys()].map(persistContext));
  await browser?.close().catch(() => undefined);
  process.exit(0);
}

http.createServer((req, res) => {
  if (req.url === "/health") {
    const healthy = !stopping && status !== "error";
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ healthy, status, workerId, version: VERSION, lastScanAt, message: statusMessage, sessionState }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ service: "Bid Copilot Browser Worker", version: VERSION }));
}).listen(port, "0.0.0.0");

main().catch((error) => {
  status = "error";
  statusMessage = error.message;
  console.error(error);
  setTimeout(() => process.exit(1), 1000);
});
