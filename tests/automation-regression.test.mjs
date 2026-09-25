import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Telegram approval is short-lived, one-time, and bound to an authorized account", () => {
  const policy = read("panel/lib/approval-policy.ts");
  const webhook = read("panel/app/api/telegram/webhook/route.ts");
  assert.match(policy, /timingSafeEqual/);
  assert.match(policy, /expiresAt/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /TELEGRAM_ALLOWED_USER_ID/);
  assert.match(webhook, /TELEGRAM_CHAT_ID/);
  assert.match(webhook, /decideBidApproval/);
});

test("Telegram sends notification-only project links", () => {
  const telegram = read("panel/lib/telegram.ts");
  const candidates = read("panel/app/api/automation/candidates/route.ts");
  assert.match(telegram, /آگهی جدید/);
  assert.match(telegram, /باز کردن آگهی/);
  assert.match(telegram, /url: project\.url/);
  assert.doesNotMatch(telegram.slice(telegram.indexOf("sendProjectApprovalRequest"), telegram.indexOf("sendBidApprovalRequest")), /callback_data/);
  assert.match(candidates, /status: "notified"/);
  assert.match(candidates, /eventType: "new_project_sent"/);
  assert.match(candidates, /\[telegram-delivery\]/);
  assert.match(read("worker/src/index.mjs"), /telegram candidate: delivered/);
});

test("new project notifications require only valid marketplace identity", () => {
  const candidates = read("panel/app/api/automation/candidates/route.ts");
  assert.match(candidates, /project\?\.url/);
  assert.match(candidates, /project\.title/);
  assert.match(candidates, /project\.site/);
  assert.doesNotMatch(candidates, /canQueueForApproval/);
  assert.doesNotMatch(candidates, /AUTOMATION_MIN_SCORE/);
});

test("notification delivery is deduplicated by canonical URL and title fingerprint", () => {
  const candidates = read("panel/app/api/automation/candidates/route.ts");
  const store = read("panel/lib/store.ts");
  assert.match(candidates, /canonicalProjectUrl/);
  assert.match(candidates, /projectFingerprint/);
  assert.match(store, /ON CONFLICT \(url\) DO NOTHING/);
});

test("approved work is claimed atomically and cannot be submitted twice", () => {
  const store = read("panel/lib/store.ts");
  assert.match(store, /FOR UPDATE SKIP LOCKED/);
  assert.match(store, /status = 'approved'/);
  assert.match(store, /status = 'submitting'/);
  assert.match(store, /WHERE id = \$1 AND status = 'submitting'/);
});

test("browser Worker never schedules automatic bid submission", () => {
  const worker = read("worker/src/index.mjs");
  const main = worker.slice(worker.indexOf("async function main"), worker.indexOf("async function shutdown"));
  assert.doesNotMatch(main, /approvalCycle/);
  assert.doesNotMatch(main, /approvalTimer/);
  assert.match(main, /scanTimer/);
});

test("Worker blocks CAPTCHA and login challenges instead of bypassing them", () => {
  const worker = read("worker/src/index.mjs");
  assert.match(worker, /captcha/);
  assert.match(worker, /login_required/);
  assert.match(worker, /submission stopped without bypass/);
  assert.match(worker, /no automatic retry will occur/);
  assert.match(worker, /BLOCKED_SITE_RETRY_MINUTES/);
  assert.match(worker, /blockedUntil/);
});

test("Worker alerts are deduplicated persistently and report recovery", () => {
  const heartbeat = read("panel/app/api/automation/heartbeat/route.ts");
  const policy = read("panel/lib/worker-alert-policy.ts");
  const telegram = read("panel/lib/telegram.ts");
  assert.match(heartbeat, /previous\?\.alertState/);
  assert.match(heartbeat, /WORKER_ALERT_COOLDOWN_MINUTES/);
  assert.match(policy, /cooldownExpired/);
  assert.match(policy, /action: "recovered"/);
  assert.match(telegram, /sendWorkerRecovery/);
});

test("Worker persists every fresh inspected project before delivery and scans independently", () => {
  const worker = read("worker/src/index.mjs");
  const scan = worker.slice(worker.indexOf("async function scanSite"), worker.indexOf("async function guardedScanCycle"));
  assert.match(scan, /enqueuePendingNotifications\(candidates\)/);
  assert.match(scan, /flushPendingNotifications\(\)/);
  assert.match(worker, /\/api\/automation\/candidates/);
  assert.doesNotMatch(scan, /safeManualReview/);
  assert.match(worker, /scanTimer/);
  assert.match(worker, /scanBusy/);
});

test("Worker uses a durable notification outbox and recovers stalled scan delivery", () => {
  const worker = read("worker/src/index.mjs");
  assert.match(worker, /pending-notifications\.json/);
  assert.match(worker, /readPersistedArray\(pendingNotificationsFile/);
  assert.match(worker, /persistPendingNotifications\(\)/);
  assert.match(worker, /WORKER_WATCHDOG_SECONDS/);
  assert.match(worker, /DEAD_MAN_TIMEOUT_SECONDS/);
  assert.match(worker, /enforceScanWatchdog/);
  assert.match(worker, /scan_watchdog_recycle/);
  assert.match(worker, /dead_man_recycle/);
  assert.match(worker, /recycleBrowser/);
  assert.match(worker, /missedCycles/);
});

test("hosted panel uses a private username/password session without persisting secrets in localStorage", () => {
  const page = read("panel/app/page.tsx");
  const auth = read("panel/lib/auth.ts");
  const session = read("panel/app/api/session/route.ts");
  assert.match(session, /httpOnly: true/);
  assert.match(session, /sameSite: "strict"/);
  assert.match(session, /isPanelCredentials\(username, password\)/);
  assert.match(session, /remember \? \{ maxAge: REMEMBERED_SESSION_DURATION_SECONDS \}/);
  assert.match(auth, /bid_copilot_session/);
  assert.match(auth, /PANEL_USERNAME/);
  assert.match(auth, /PANEL_PASSWORD/);
  assert.match(auth, /PANEL_SESSION_SECRET/);
  assert.match(auth, /createHmac\("sha256"/);
  assert.match(page, /fetch\("\/api\/session"/);
  assert.match(page, /مرا به خاطر بسپار/);
  assert.match(page, /name="username"/);
  assert.match(page, /name="password"/);
  assert.match(page, /method: "DELETE"/);
  assert.doesNotMatch(page, /localStorage\.setItem\("bid-copilot:key"/);
  assert.doesNotMatch(page, /localStorage\.setItem\([^\n]*password/i);
});

test("extension can reach production and defaults explicit approve to guarded submit", () => {
  const manifest = read("extension/manifest.json");
  const worker = read("extension/service-worker.js");
  const options = read("extension/options.js");
  assert.match(manifest, /https:\/\/www\.freelancerpanel\.ir\/\*/);
  assert.match(worker, /panelUrl: "https:\/\/www\.freelancerpanel\.ir"/);
  assert.match(worker, /autoSubmit: true/);
  assert.match(options, /آزمایش اتصال/);
});

test("MV3 extension wakes cleanly and replaces stale content-script listeners", () => {
  const worker = read("extension/service-worker.js");
  const content = read("extension/content.js");
  assert.match(worker, /contentReady\(tab\)/);
  assert.match(worker, /ensureContent\(tab\)/);
  assert.match(worker, /chrome\.runtime\.onStartup\.addListener/);
  assert.match(worker, /chrome\.storage\.local\.set\(\{ extensionRuntime/);
  assert.match(content, /removeListener\(previous\.listener\)/);
  assert.match(content, /version: CONTENT_VERSION/);
});

test("Worker normalizes fresh listings without generating or submitting bids", () => {
  const worker = read("worker/src/index.mjs");
  const scanSite = worker.slice(worker.indexOf("async function scanSite"), worker.indexOf("async function scanCycle"));
  assert.match(scanSite, /normalizeProjectInspection\(\{/);
  assert.doesNotMatch(scanSite, /\/api\/generate/);
  assert.doesNotMatch(scanSite, /BidCopilotAdapter\.submit/);
});

test("Worker isolates timed-out project navigations and bounds production polling", () => {
  const worker = read("worker/src/index.mjs");
  assert.match(worker, /clamp\(process\.env\.SCAN_INTERVAL_SECONDS, 120, 120, 3600\)/);
  assert.match(worker, /clamp\(process\.env\.NOTIFICATION_BATCH_PER_CYCLE, 5, 1, 30\)/);
  assert.match(worker, /clamp\(process\.env\.APPROVAL_POLL_SECONDS, 15, 15, 60\)/);
  assert.match(worker, /clamp\(process\.env\.INSPECT_LIMIT_PER_SITE, 5, 1, 10\)/);
  assert.match(worker, /SITE_SCAN_TIMEOUT_SECONDS/);
  assert.match(worker, /withinTimeout/);
  assert.match(worker, /scanStalled/);

  const scanSite = worker.slice(worker.indexOf("async function scanSite"), worker.indexOf("async function scanCycle"));
  assert.match(scanSite, /const listingPage = await context\.newPage\(\)/);
  assert.match(scanSite, /const detailPage = await context\.newPage\(\)/);
  assert.match(scanSite, /detailPage\.goto\(item\.url/);
  assert.match(scanSite, /detailPage\.close\(\)/);
  assert.match(scanSite, /listingPage\.close\(\)/);
  assert.doesNotMatch(scanSite, /await listingPage\.goto\(item\.url/);
});

test("Worker quarantines poisoned inspections and recycles before heap OOM", () => {
  const worker = read("worker/src/index.mjs");
  const railway = read("railway.toml");
  assert.match(worker, /inspection-failures\.json/);
  assert.match(worker, /isInspectionSuppressed/);
  assert.match(worker, /recordInspectionFailure/);
  assert.match(worker, /browserPoisonedBy/);
  assert.match(worker, /if \(browserPoisonedBy\(error\)\)/);
  assert.match(worker, /HEAP_RESTART_MB/);
  assert.match(worker, /MAX_WORKER_UPTIME_HOURS/);
  assert.match(worker, /BROWSER_RECYCLE_COOLDOWN_MINUTES/);
  assert.match(worker, /enforceMemoryWatchdog/);
  assert.match(worker, /requestWorkerRecycle/);
  assert.match(worker, /eventType: "browser_recycled"/);
  assert.match(worker, /memoryTimer/);
  assert.match(worker, /inspectionFailures: inspectionFailures\.size/);
  assert.match(railway, /restartPolicyType = "ALWAYS"/);
});

test("a hung marketplace cannot block the other marketplace or hide Worker health", () => {
  const worker = read("worker/src/index.mjs");
  const scanCycle = worker.slice(worker.indexOf("async function scanCycle"), worker.indexOf("async function guardedScanCycle"));
  assert.match(scanCycle, /for \(const site of Object\.keys\(markets\)\)/);
  assert.match(scanCycle, /siteFailures \+= 1/);
  assert.match(scanCycle, /site_scan_failed/);
  assert.match(worker, /scanBusy = false/);
  assert.match(worker, /scanStartedAt = ""/);
});

test("Telegram stays exclusive to new project notifications", () => {
  const heartbeat = read("panel/app/api/automation/heartbeat/route.ts");
  const telegram = read("panel/lib/telegram.ts");
  assert.doesNotMatch(heartbeat, /sendWorkerAlert/);
  assert.doesNotMatch(heartbeat, /sendWorkerRecovery/);
  assert.match(telegram, /آگهی جدید/);
  assert.match(telegram, /inline_keyboard/);
});

test("Docker Worker is non-root and keeps auth state outside the image", () => {
  const docker = read("worker/Dockerfile");
  const entrypoint = read("worker/docker-entrypoint.sh");
  const ignore = read("worker/.dockerignore");
  assert.match(docker, /ENTRYPOINT \["\/usr\/local\/bin\/bid-copilot-entrypoint"\]/);
  assert.match(entrypoint, /chown -R pwuser:pwuser \/data/);
  assert.match(entrypoint, /exec runuser -u pwuser -- "\$@"/);
  assert.match(docker, /\/data\/auth/);
  assert.match(ignore, /secrets/);
  assert.doesNotMatch(docker, /COPY worker\/secrets/);
});

test("Worker keeps persisted storage-state credentials owner-only", () => {
  const worker = read("worker/src/index.mjs");
  const initialize = worker.slice(worker.indexOf("async function initializeSensitiveState"), worker.indexOf("async function api"));
  const persist = worker.slice(worker.indexOf("async function persistContext"), worker.indexOf("async function withSiteLock"));
  assert.match(initialize, /await fs\.chmod\(market\.statePath, 0o600\)/);
  assert.match(persist, /context\.storageState/);
  assert.match(persist, /await fs\.chmod\(markets\[site\]\.statePath, 0o600\)/);
});

test("hosted database uses a private RLS-enabled Supabase schema", () => {
  const schema = read("database/bid-copilot-schema.sql");
  const store = read("panel/lib/store.ts");
  assert.match(schema, /CREATE SCHEMA IF NOT EXISTS bid_copilot/);
  assert.equal((schema.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, 5);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bid_copilot\.copilot_reports/);
  assert.match(schema, /REVOKE ALL ON SCHEMA bid_copilot FROM anon, authenticated/);
  assert.doesNotMatch(store, /(?:FROM|INTO|UPDATE) copilot_(?:projects|searches|bid_approvals|worker_state)/);
});

test("proposal strategy rejects repetitive AI-template sections", () => {
  const bid = read("panel/lib/bid.ts");
  assert.match(bid, /Avoid generic sales claims, headings, metadata/);
  assert.match(bid, /Return exactly one JSON object/);
  assert.doesNotMatch(bid, /labelledProposal|jsonCandidates/);
  assert.match(bid, /enforceProposalStyle/);
  assert.match(bid, /max_output_tokens: 650/);
});

test("dashboard exposes Worker health and Telegram approval queue", () => {
  const page = read("panel/app/page.tsx");
  assert.match(page, /mode === "automation"/);
  assert.match(page, /\/api\/automation\/heartbeat/);
  assert.match(page, /\/api\/automation\/candidates/);
  assert.match(page, /TELEGRAM PROJECT ALERTS/);
});

test("reports persist scans and Telegram project notifications", () => {
  const reportsRoute = read("panel/app/api/reports/route.ts");
  const page = read("panel/app/page.tsx");
  const worker = read("worker/src/index.mjs");
  const candidates = read("panel/app/api/automation/candidates/route.ts");
  assert.match(reportsRoute, /isWorkerAuthorized/);
  assert.match(reportsRoute, /listReports/);
  assert.match(page, /ViewMode = "reports"/);
  assert.match(page, /fetch\("\/api\/reports"/);
  assert.match(page, /گزارشات زنده اسکن و تلگرام/);
  assert.match(worker, /eventType: "scan_completed"/);
  assert.match(candidates, /eventType: "new_project_sent"/);
  assert.match(candidates, /eventType: "new_project_delivery_failed"/);
});

test("Worker storage-state credentials are explicitly excluded from source control", () => {
  const ignore = read("worker/.gitignore");
  const files = fs.readdirSync(path.join(root, "worker"), { recursive: true }).map(String);
  assert.match(ignore, /\*\.storage-state\.json/);
  assert.equal(files.some((file) => /storage-state\.json$/i.test(file)), false);
});
