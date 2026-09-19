import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { normalizeProjectInspection } from "./project-normalizer.mjs";
import { blockedRetryDelayMs, describeWorkerError } from "./runtime-policy.mjs";
import { budgetAllowsApprovedPrice } from "./budget-policy.mjs";
import { blockedCountry, projectSeenKeys } from "./candidate-policy.mjs";

import { createDeadManMonitor } from "./dead-man-monitor.mjs";
import { createRecovery } from "./recovery.mjs";
import { createAtomicWriter } from "./durable-state.mjs";

const VERSION = "0.7.4";
const root = path.resolve(import.meta.dirname, "../..");
const dataDir = path.resolve(process.env.BROWSER_DATA_DIR || "/data");
const panelUrl = String(process.env.PANEL_URL || "").replace(/\/$/, "");
const copilotKey = process.env.COPILOT_KEY || "";
const workerKey = process.env.WORKER_KEY || "";
const workerId = process.env.WORKER_ID || "primary-worker";
const profile = process.env.FREELANCER_PROFILE || "";
const domains = String(process.env.PREFERRED_DOMAINS || "").split(",").map((value) => value.trim()).filter(Boolean);
const scanInterval = clamp(process.env.SCAN_INTERVAL_SECONDS, 120, 120, 3600) * 1000;
const approvalPoll = clamp(process.env.APPROVAL_POLL_SECONDS, 15, 15, 60) * 1000;
const inspectLimit = clamp(process.env.INSPECT_LIMIT_PER_SITE, 5, 1, 10);
const browserOperationTimeout = clamp(process.env.BROWSER_OPERATION_TIMEOUT_SECONDS, 35, 10, 90) * 1000;
const siteScanTimeout = clamp(process.env.SITE_SCAN_TIMEOUT_SECONDS, 150, 45, 600) * 1000;
const topPerCycle = clamp(process.env.TOP_BIDS_PER_CYCLE, 1, 1, 1);
const automationMinScore = clamp(process.env.AUTOMATION_MIN_SCORE, 72, 65, 95);
const blockedSiteRetry = blockedRetryDelayMs(process.env.BLOCKED_SITE_RETRY_MINUTES);
const inspectionRetryDelay = clamp(process.env.INSPECTION_RETRY_MINUTES, 30, 5, 360) * 60_000;
const memoryWatchdogInterval = clamp(process.env.MEMORY_WATCHDOG_SECONDS, 30, 15, 300) * 1000;
const heapRestartMb = clamp(process.env.HEAP_RESTART_MB, 300, 192, 420);
const maxWorkerUptime = clamp(process.env.MAX_WORKER_UPTIME_HOURS, 6, 1, 24) * 60 * 60_000;
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
const notificationBatchSize = clamp(process.env.NOTIFICATION_BATCH_PER_CYCLE, 5, 1, 30);
// This covers two bounded site scans, a bounded notification batch, and cleanup.
// It is deliberately longer than a normal cycle so healthy slow scans are not restarted.
const cycleWatchdogTimeout = Math.max(
  clamp(process.env.WORKER_WATCHDOG_SECONDS, 480, 180, 1800) * 1000,
  siteScanTimeout * Object.keys(markets).length + notificationBatchSize * 20_000 + 30_000
);

let browser;
let stopping = false;
let approvalBusy = false;
let scanBusy = false;
let lastScanAt = "";
let scanStartedAt = "";
let recycleExiting = false;
let status = "starting";
let statusMessage = "Worker is starting";
const startedAt = Date.now();
const contexts = new Map();
const locks = new Map();
const blockedUntil = new Map();
const sessionState = { kaya: "error", ponisha: "error" };
const seenFile = path.join(dataDir, "state/seen.json");
const pendingNotificationsFile = path.join(dataDir, "state/pending-notifications.json");
const inspectionFailuresFile = path.join(dataDir, "state/inspection-failures.json");
let seen = new Set();
let pendingNotifications = [];
let inspectionFailures = new Map();
let adapterBundle = "";
let stateLoaded = false;
let lastRestart = null;
const timers = [];
const recoveryFile = path.join(dataDir, "state/worker-recovery.json");
const deadManTimeout = clamp(process.env.DEAD_MAN_TIMEOUT_SECONDS, 900, 180, 7200) * 1000;
const recoveryReportCooldown = 30 * 60_000;
const deadMan = createDeadManMonitor({ timeoutMs: deadManTimeout,
  scanIntervalMs: scanInterval, cycleTimeoutMs: cycleWatchdogTimeout });
const atomicWrite = createAtomicWriter();
const recovery = createRecovery({
  onStart(reason) {
    stopping = true;
    recycleExiting = true;
    timers.forEach(clearInterval);
    status = "restarting";
    statusMessage = reason;
    console.error("Worker recovery:", reason);
  },
  async persist(reason, metadata) {
    // Never overwrite a volume that has not finished loading (or was corrupt).
    if (!stateLoaded) return;
    const now = Date.now();
    const previousReportAt = Number(lastRestart?.reportAttemptedAt || 0);
    const shouldReport = now - previousReportAt >= recoveryReportCooldown || now < previousReportAt;
    lastRestart = { reason, at: new Date(now).toISOString(), metadata,
      reportAttemptedAt: shouldReport ? now : previousReportAt, reportSuppressed: !shouldReport };
    await withinTimeout("recovery durable state", () => Promise.all([
      persistPendingNotifications(),
      atomicWrite(seenFile, JSON.stringify([...seen].slice(-5000))),
      persistInspectionFailures(),
      atomicWrite(recoveryFile, JSON.stringify(lastRestart))
    ]), 8000).catch(error => console.error("recovery state:", error.message));
    await withinTimeout("recovery auth state", () => Promise.all([...contexts.keys()].map(persistContext)), 8000)
      .catch(error => console.error("recovery auth:", error.message));
  },
  async report(reason, metadata) {
    if (!stateLoaded || lastRestart?.reportSuppressed) return;
    await Promise.all([
      heartbeat("restarting", reason),
      report({ category: "worker", eventType: "worker_recycle", level: "warning",
        title: "Worker is restarting to recover scanning", message: reason,
        status: "restarting", metadata: { ...metadata, restartAt: lastRestart?.at } })
    ]);
  },
  async close() { await browser?.close(); }
});

function clamp(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s`);
  error.name = "TimeoutError";
  return error;
}

async function withinTimeout(label, operation, timeoutMs = browserOperationTimeout) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function wasSeen(project = {}) {
  return projectSeenKeys(project).some((key) => seen.has(key));
}

function markSeen(project = {}) {
  for (const key of projectSeenKeys(project)) seen.add(key);
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readPersistedArray(file, label) {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(value)) throw new Error("expected an array");
    return value;
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`Cannot restore ${label}: ${error.message}`);
    return [];
  }
}

function notificationKey(project = {}) {
  const keys = projectSeenKeys(project);
  return keys.join("|") || `${project.site || ""}|${project.url || ""}|${project.title || ""}`;
}

function inspectionFailureKey(project = {}) {
  return notificationKey(project);
}

function isInspectionSuppressed(project = {}, now = Date.now()) {
  const key = inspectionFailureKey(project);
  const failure = key ? inspectionFailures.get(key) : null;
  if (!failure) return false;
  if (Number(failure.retryAt) > now) return true;
  inspectionFailures.delete(key);
  return false;
}

async function persistInspectionFailures() {
  const items = [...inspectionFailures.values()]
    .filter((item) => Number(item.retryAt) > Date.now() - inspectionRetryDelay)
    .sort((a, b) => Number(b.retryAt) - Number(a.retryAt))
    .slice(0, 500);
  inspectionFailures = new Map(items.map((item) => [item.key, item]));
  await atomicWrite(inspectionFailuresFile, JSON.stringify(items));
}

async function recordInspectionFailure(project = {}, error) {
  const key = inspectionFailureKey(project);
  if (!key) return;
  const previous = inspectionFailures.get(key);
  const attempts = Math.min(12, Number(previous?.attempts || 0) + 1);
  const multiplier = Math.min(6, attempts);
  const retryAt = Date.now() + inspectionRetryDelay * multiplier;
  inspectionFailures.set(key, {
    key,
    site: project.site || "",
    url: project.url || "",
    title: project.title || "",
    attempts,
    retryAt,
    reason: String(error?.message || error || "inspection failed").slice(0, 300)
  });
  await persistInspectionFailures();
}

async function clearInspectionFailure(project = {}) {
  const key = inspectionFailureKey(project);
  if (!key || !inspectionFailures.delete(key)) return;
  await persistInspectionFailures();
}

function browserPoisonedBy(error) {
  const message = String(error?.message || error || "");
  return error?.name === "TimeoutError"
    || /timed out|Target page, context or browser has been closed|Browser has been closed|Execution context was destroyed/i.test(message);
}

async function persistPendingNotifications() {
  await atomicWrite(pendingNotificationsFile, JSON.stringify(pendingNotifications));
}

async function enqueuePendingNotifications(projects) {
  if (stopping) return 0;
  const known = new Set(pendingNotifications.map(notificationKey));
  const additions = projects.filter((project) => {
    const key = notificationKey(project);
    if (!key || known.has(key)) return false;
    known.add(key);
    return true;
  });
  if (!additions.length) return 0;
  pendingNotifications.push(...additions);
  await persistPendingNotifications();
  return additions.length;
}

async function flushPendingNotifications() {
  let queuedCount = 0;
  let queueFailures = 0;
  const batch = pendingNotifications.slice(0, notificationBatchSize);
  for (const project of batch) {
    if (stopping) break;
    try {
      const result = await api("/api/automation/candidates", { body: project });
      if (stopping) break; // Keep ambiguous in-flight deliveries for server-side deduplication.
      if (result.created) queuedCount += 1;
      markSeen(project);
      const key = notificationKey(project);
      pendingNotifications = pendingNotifications.filter((candidate) => notificationKey(candidate) !== key);
      // Persist both sides of the hand-off before taking the next item.  A restart
      // can therefore resume delivery without silently dropping a notification.
      await persistPendingNotifications();
      await atomicWrite(seenFile, JSON.stringify([...seen].slice(-5000)));
    } catch (error) {
      queueFailures += 1;
      console.error("queue candidate:", error.message);
      // Keep the failed item at the head of the durable outbox for the next cycle.
      break;
    }
  }
  return { queuedCount, queueFailures, attempted: batch.length };
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
  if (stopping && nextStatus !== "restarting") return;
  status = nextStatus;
  statusMessage = message;
  await api("/api/automation/heartbeat", {
    timeout: stopping ? 8000 : 20_000,
    body: { workerId, status, message, currentSite: site, lastSeenAt: new Date().toISOString(), lastScanAt, sessionState, version: VERSION }
  }).catch((error) => console.error("heartbeat:", error.message));
}

async function report(input) {
  return api("/api/reports", {
    timeout: stopping ? 8000 : 20_000,
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
    const state = await withinTimeout(`${site} storage state`, () => context.storageState(), 7000);
    await atomicWrite(markets[site].statePath, JSON.stringify(state));
    await fs.chmod(markets[site].statePath, 0o600);
  } catch (error) { console.error(`persist ${site}:`, error.message); }
}

async function releaseContext(site) {
  const context = contexts.get(site);
  if (!context) return;
  await persistContext(site);
  contexts.delete(site);
  await withinTimeout(`${site} context close`, () => context.close()).catch((error) => console.error(`close ${site}:`, error.message));
}

// A timeout means the Playwright operation may still be unresolved.  Drop that
// context before the next cycle rather than reusing a potentially wedged one.
async function discardContext(site) {
  const context = contexts.get(site);
  if (!context) return;
  contexts.delete(site);
  await withinTimeout(`${site} timed-out context reset`, () => context.close(), 10_000)
    .catch((error) => console.error(`reset ${site}:`, error.message));
}

async function withSiteLock(site, operation) {
  const previous = locks.get(site) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(site, current);
  try { return await current; } finally { if (locks.get(site) === current) locks.delete(site); }
}

async function scanSite(site) {
  return withSiteLock(site, async () => {
    try {
      return await withinTimeout(`scan ${site}`, () => scanSiteOnce(site), siteScanTimeout);
    } catch (error) {
      await discardContext(site);
      throw error;
    }
  });
}

async function scanSiteOnce(site) {
    const retryAt = blockedUntil.get(site) || 0;
    if (stopping || retryAt > Date.now()) return { candidates: [], successful: false };
    blockedUntil.delete(site);
    await heartbeat("scanning", `Scanning ${site}`, site);
    const context = await contextFor(site);
    const listingPage = await context.newPage();
    const candidates = [];
    try {
      console.log(`scan ${site}: opening list`);
      await withinTimeout(`${site} list navigation`, () => listingPage.goto(markets[site].listUrl, { waitUntil: "domcontentloaded", timeout: browserOperationTimeout }));
      const block = await withinTimeout(`${site} list block check`, () => pageBlock(listingPage));
      if (block) {
        sessionState[site] = block;
        blockedUntil.set(site, Date.now() + blockedSiteRetry);
        await heartbeat("blocked", `${site}: ${block}; manual login or CAPTCHA action is required`, site);
        return { candidates, successful: false };
      }
      sessionState[site] = "ready";
      await withinTimeout(`${site} adapter injection`, () => injectAdapters(listingPage));
      const listing = await withinTimeout(`${site} list extraction`, () => listingPage.evaluate(() => window.BidCopilotAdapter.scanList()));
      if (!Array.isArray(listing?.items)) throw new Error("Invalid marketplace listing result");
      const freshItems = listing.items
        .filter((item) => item.url && !wasSeen({ ...item, site }) && !isInspectionSuppressed({ ...item, site }))
        .slice(0, inspectLimit);
      console.log(`scan ${site}: ${listing?.items?.length || 0} listed, ${freshItems.length} fresh`);
      for (const item of freshItems) {
        if (stopping) break;
        const detailPage = await context.newPage();
        try {
          await withinTimeout(`${site} project navigation`, () => detailPage.goto(item.url, { waitUntil: "domcontentloaded", timeout: browserOperationTimeout }));
          const projectBlock = await withinTimeout(`${site} project block check`, () => pageBlock(detailPage));
          if (projectBlock) {
            sessionState[site] = projectBlock;
            blockedUntil.set(site, Date.now() + blockedSiteRetry);
            await heartbeat("blocked", `${site}: ${projectBlock}; manual login or CAPTCHA action is required`, site);
            break;
          }
          await withinTimeout(`${site} project adapter injection`, () => injectAdapters(detailPage));
          const inspected = normalizeProjectInspection({
            site,
            item,
            inspected: await withinTimeout(`${site} project inspection`, () => detailPage.evaluate(() => window.BidCopilotAdapter.inspect())),
            currentUrl: detailPage.url()
          });
          if (!inspected.title || !inspected.url) throw new Error("Inspection missing title or URL after listing fallback");
          if (blockedCountry(inspected)) {
            markSeen(inspected);
            console.log(`skip ${site} ${inspected.url}: blocked employer country`);
            continue;
          }
          if (wasSeen(inspected)) continue;
          await clearInspectionFailure({ ...inspected, site });
          if (stopping) break;
          const candidate = {
            ...inspected,
            capturedAt: new Date().toISOString(),
            status: "generated",
            bid: "",
            jobScore: Number(item.score || 0),
            matchScore: Number(item.matchScore || item.score || 0)
          };
          // Persist immediately: a later detail-page timeout must not lose earlier projects.
          await enqueuePendingNotifications([candidate]);
          candidates.push(candidate);
        } catch (error) {
          console.error(`inspect ${site} ${item.url}:`, error.message);
          await recordInspectionFailure({ ...item, site }, error).catch((failureError) => console.error("persist inspection failure:", failureError.message));
          if (browserPoisonedBy(error)) {
            await discardContext(site);
            throw error;
          }
        } finally {
          await withinTimeout(`${site} project page close`, () => detailPage.close(), 10_000)
            .catch((error) => console.error(`close ${site} project:`, error.message));
        }
      }
      if (sessionState[site] === "ready") await heartbeat("scanning", `${site}: session ready`, site);
      return { candidates, successful: !stopping && sessionState[site] === "ready" };
    } finally {
      await withinTimeout(`${site} list page close`, () => listingPage.close()).catch((error) => console.error(`close ${site} list:`, error.message));
      await releaseContext(site);
    }
}

async function scanCycle() {
  const candidates = [];
  let siteFailures = 0;
  const successfulSites = [];
  for (const site of Object.keys(markets)) {
    try {
      if (stopping) return;
      const result = await scanSite(site);
      candidates.push(...result.candidates);
      if (result.successful) successfulSites.push(site);
    } catch (error) {
      siteFailures += 1;
      sessionState[site] = "error";
      console.error(`scan ${site}:`, error.message);
      await report({
        category: "scan",
        eventType: "site_scan_failed",
        level: "error",
        title: `اسکن ${site} ناموفق بود`,
        message: error.message,
        site,
        status: "error",
        metadata: { timeout: error?.name === "TimeoutError" }
      });
    }
  }
  if (stopping) return;
  const addedToOutbox = await enqueuePendingNotifications(candidates);
  const { queuedCount, queueFailures, attempted } = await flushPendingNotifications();
  if (stopping) return;
  lastScanAt = new Date().toISOString();
  await atomicWrite(seenFile, JSON.stringify([...seen].slice(-5000)));
  await heartbeat(successfulSites.length ? "idle" : "blocked", `Scan complete; ${queuedCount} notification(s) sent; ${pendingNotifications.length} queued`);
  await report({
    category: "scan",
    eventType: "scan_completed",
    level: queueFailures || siteFailures ? "warning" : "success",
    title: "اسکن دوره‌ای تکمیل شد",
    message: queuedCount
      ? `${queuedCount} آگهی جدید با لینک مستقیم به تلگرام ارسال شد.`
      : `${candidates.length} آگهی تازه بررسی شد؛ ${pendingNotifications.length} اعلان در صف پایدار باقی مانده است.`,
    status: "idle",
    metadata: {
      candidateCount: candidates.length,
      selectedCount: candidates.length,
      addedToOutbox,
      outboxAttempted: attempted,
      outboxRemaining: pendingNotifications.length,
      queuedCount,
      failureCount: queueFailures + siteFailures,
      kayaSession: sessionState.kaya,
      ponishaSession: sessionState.ponisha,
      successfulSites
    }
  });
  if (!stopping) {
    deadMan.completeCycle(successfulSites);
    console.log("scan cycle completed:", JSON.stringify({ successfulSites, pendingNotifications: pendingNotifications.length, lastSuccessfulScanAt: deadMan.snapshot().lastSuccessfulScanAt }));
  }
}

async function guardedScanCycle() {
  if (stopping || scanBusy) return;
  scanBusy = true;
  scanStartedAt = new Date().toISOString();
  deadMan.startCycle();
  try { await scanCycle(); } finally { scanBusy = false; scanStartedAt = ""; deadMan.endCycle(); }
}

function scanIsStalled() {
  return deadMan.snapshot().reason === "scan_watchdog_restart";
}

function requestWorkerRecycle(reason, metadata = {}) {
  return recovery.request(reason, { ...metadata, scan: deadMan.snapshot(),
    pendingNotifications: pendingNotifications.length });
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  const toMb = (value) => Math.round(value / 1024 / 1024);
  return {
    heapUsedMb: toMb(usage.heapUsed),
    heapTotalMb: toMb(usage.heapTotal),
    rssMb: toMb(usage.rss),
    externalMb: toMb(usage.external)
  };
}

async function enforceMemoryWatchdog() {
  if (recycleExiting || stopping) return;
  const memory = memorySnapshot();
  const uptimeMs = Date.now() - startedAt;
  if (memory.heapUsedMb >= heapRestartMb) {
    await requestWorkerRecycle(`Memory watchdog reached ${memory.heapUsedMb}MB heap; restarting before OOM`, { ...memory, uptimeMs, heapRestartMb });
    return;
  }
  if (uptimeMs >= maxWorkerUptime) {
    await requestWorkerRecycle(`Scheduled Worker recycle after ${Math.round(uptimeMs / 60_000)} minutes`, { ...memory, uptimeMs, maxWorkerUptime });
  }
}

async function enforceScanWatchdog() {
  if (recovery.active || stopping) return;
  const scan = deadMan.snapshot();
  if (!scan.stale) return;
  await requestWorkerRecycle(scan.reason, { eventType: scan.reason, scanStartedAt });
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
  // Supervise initialization too, including a hung browser launch.
  timers.push(setInterval(() => void enforceScanWatchdog(), 15_000));
  const memoryTimer = setInterval(() => void enforceMemoryWatchdog(), memoryWatchdogInterval);
  timers.push(memoryTimer);
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await fs.mkdir(path.dirname(seenFile), { recursive: true });
  seen = new Set(await readPersistedArray(seenFile, "seen state"));
  pendingNotifications = await readPersistedArray(pendingNotificationsFile, "notification outbox");
  const persistedInspectionFailures = await readPersistedArray(inspectionFailuresFile, "inspection failure state");
  inspectionFailures = new Map(
    persistedInspectionFailures
      .filter((item) => item?.key && Number(item.retryAt) > Date.now())
      .map((item) => [item.key, item])
  );
  try { lastRestart = JSON.parse(await fs.readFile(recoveryFile, "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  stateLoaded = true;
  if (stopping) return;
  adapterBundle = `${await fs.readFile(path.join(root, "extension/adapter-core.js"), "utf8")}\n${await fs.readFile(path.join(root, "extension/adapters.js"), "utf8")}`;
  browser = await chromium.launch({ headless: true });
  if (stopping) { await browser.close(); return; }
  console.log("Worker started:", JSON.stringify({ version: VERSION, deadMan: deadMan.snapshot(), pendingNotifications: pendingNotifications.length, previousRestartAt: lastRestart?.at || null }));
  await heartbeat("idle", "Worker is online");
  await report({
    category: "worker",
    eventType: "worker_started",
    level: "success",
    title: "Worker آنلاین شد",
    message: "مرورگر خودکار Worker اجرا شد و اسکن دوره‌ای کایا و پونیشا فعال است.",
    status: "idle",
    metadata: { version: VERSION, scanIntervalSeconds: scanInterval / 1000, pendingNotifications: pendingNotifications.length }
  });
  const handleScanError = async (error) => {
    if (stopping) return;
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
  if (stopping) return;
  void guardedScanCycle().catch(handleScanError);
  const scanTimer = setInterval(() => void guardedScanCycle().catch(handleScanError), scanInterval);
  const heartbeatTimer = setInterval(() => void heartbeat(), 25_000);
  timers.push(scanTimer, heartbeatTimer);
}

async function shutdown() {
  return recovery.request("Worker shutdown signal", { eventType: "worker_shutdown" }, 0);
}

http.createServer((req, res) => {
  if (req.url === "/health") {
    const scanStalled = scanIsStalled();
    const deadManHealth = deadMan.snapshot();
    const missedCycles = deadManHealth.reason === "scan_progress_stale";
    const healthy = !stopping && !recycleExiting && status !== "error" && !deadManHealth.stale;
    const memory = memorySnapshot();
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      healthy, status, workerId, version: VERSION, lastScanAt, scanStartedAt, scanBusy,
      scanStalled, missedCycles, recycleExiting, deadMan: deadManHealth,
      lastSuccessfulScanAt: deadManHealth.lastSuccessfulScanAt,
      lastRestart: lastRestart ? { at: lastRestart.at, reason: lastRestart.reason } : null,
      pendingNotifications: pendingNotifications.length,
      inspectionFailures: inspectionFailures.size, uptimeMs: Date.now() - startedAt, memory,
      message: statusMessage, sessionState
    }));
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
