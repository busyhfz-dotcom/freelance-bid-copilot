import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const VERSION = "0.5.1";
const root = path.resolve(import.meta.dirname, "../..");
const dataDir = path.resolve(process.env.BROWSER_DATA_DIR || "/data");
const panelUrl = String(process.env.PANEL_URL || "").replace(/\/$/, "");
const copilotKey = process.env.COPILOT_KEY || "";
const workerKey = process.env.WORKER_KEY || "";
const workerId = process.env.WORKER_ID || "primary-worker";
const profile = process.env.FREELANCER_PROFILE || "";
const domains = String(process.env.PREFERRED_DOMAINS || "").split(",").map((value) => value.trim()).filter(Boolean);
const scanInterval = clamp(process.env.SCAN_INTERVAL_SECONDS, 60, 30, 900) * 1000;
const approvalPoll = clamp(process.env.APPROVAL_POLL_SECONDS, 2, 1, 15) * 1000;
const inspectLimit = clamp(process.env.INSPECT_LIMIT_PER_SITE, 15, 5, 30);
const topPerCycle = clamp(process.env.TOP_BIDS_PER_CYCLE, 5, 5, 10);
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
  if (await fileExists(market.statePath)) return;
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
  if (context) await context.storageState({ path: markets[site].statePath }).catch(() => undefined);
}

async function withSiteLock(site, operation) {
  const previous = locks.get(site) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(site, current);
  try { return await current; } finally { if (locks.get(site) === current) locks.delete(site); }
}

async function scanSite(site) {
  return withSiteLock(site, async () => {
    await heartbeat("scanning", `Scanning ${site}`, site);
    const context = await contextFor(site);
    const page = await context.newPage();
    const candidates = [];
    try {
      await page.goto(markets[site].listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const block = await pageBlock(page);
      if (block) {
        sessionState[site] = block;
        await heartbeat("blocked", `${site}: ${block}; manual login or CAPTCHA action is required`, site);
        return candidates;
      }
      sessionState[site] = "ready";
      await injectAdapters(page);
      const listing = await page.evaluate(() => window.BidCopilotAdapter.scanList());
      const freshItems = (listing?.items || []).filter((item) => item.url && !seen.has(item.url)).slice(0, inspectLimit);
      for (const item of freshItems) {
        try {
          await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          const projectBlock = await pageBlock(page);
          if (projectBlock) throw new Error(`${site}: ${projectBlock}`);
          await injectAdapters(page);
          const inspected = await page.evaluate(() => window.BidCopilotAdapter.inspect());
          const generated = await api("/api/generate", {
            worker: false,
            body: { ...inspected, freelancerProfile: profile, preferredDomains: domains, capturedAt: new Date().toISOString() }
          });
          if (generated.decision === "BID" && generated.guardReady === true && generated.priceWithinBudget === true) candidates.push(generated);
          else seen.add(item.url);
        } catch (error) {
          console.error(`inspect ${site} ${item.url}:`, error.message);
        }
      }
      await persistContext(site);
      return candidates;
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}

async function scanCycle() {
  const candidates = [];
  for (const site of Object.keys(markets)) candidates.push(...await scanSite(site));
  const best = candidates.sort((a, b) => (b.jobScore || 0) - (a.jobScore || 0) || (b.matchScore || 0) - (a.matchScore || 0)).slice(0, topPerCycle);
  for (const project of best) {
    try {
      await api("/api/automation/candidates", { body: project });
      seen.add(project.url);
    } catch (error) {
      console.error("queue candidate:", error.message);
    }
  }
  lastScanAt = new Date().toISOString();
  await atomicWrite(seenFile, JSON.stringify([...seen].slice(-5000)));
  await heartbeat("idle", `Scan complete; ${best.length} approval request(s) queued`);
}

async function guardedScanCycle() {
  if (scanBusy) return;
  scanBusy = true;
  try { await scanCycle(); } finally { scanBusy = false; }
}

function comparableBudget(value) {
  return String(value || "").replace(/[\s,٬]/g, "").replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).toLowerCase();
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
      const inspected = await page.evaluate(() => window.BidCopilotAdapter.inspect());
      const fresh = await api("/api/generate", {
        worker: false,
        body: { ...inspected, freelancerProfile: profile, preferredDomains: domains, capturedAt: new Date().toISOString() }
      });
      if (fresh.decision !== "BID" || fresh.guardReady !== true || fresh.priceWithinBudget !== true) throw new Error("Fresh BID/Guard revalidation failed");
      if (new URL(fresh.url).origin !== new URL(approval.url).origin) throw new Error("Project origin changed after approval");
      if (comparableBudget(fresh.budget) !== comparableBudget(approval.project.budget)) throw new Error("Project budget changed after approval");

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
    console.error("approval:", error.message);
    if (approval?.id) await api("/api/automation/result", { body: { id: approval.id, status: "failed", error: error.message } }).catch(() => undefined);
    await heartbeat("blocked", error.message, approval?.site || "");
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
  void guardedScanCycle().catch(async (error) => { console.error("scan:", error); await heartbeat("error", error.message); });
  const scanTimer = setInterval(() => void guardedScanCycle().catch(async (error) => { console.error("scan:", error); await heartbeat("error", error.message); }), scanInterval);
  const approvalTimer = setInterval(() => void approvalCycle(), approvalPoll);
  const heartbeatTimer = setInterval(() => void heartbeat(), 25_000);
  process.once("SIGTERM", () => shutdown([scanTimer, approvalTimer, heartbeatTimer]));
  process.once("SIGINT", () => shutdown([scanTimer, approvalTimer, heartbeatTimer]));
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
