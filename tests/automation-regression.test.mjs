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

test("approval queue requires a guarded BID inside budget", () => {
  const policy = read("panel/lib/approval-policy.ts");
  assert.match(policy, /project\.decision === "BID"/);
  assert.match(policy, /project\.guardReady === true/);
  assert.match(policy, /project\.priceWithinBudget === true/);
  assert.match(policy, /jobScore/);
});

test("approved work is claimed atomically and cannot be submitted twice", () => {
  const store = read("panel/lib/store.ts");
  assert.match(store, /FOR UPDATE SKIP LOCKED/);
  assert.match(store, /status = 'approved'/);
  assert.match(store, /status = 'submitting'/);
  assert.match(store, /WHERE id = \$1 AND status = 'submitting'/);
});

test("browser Worker submits only after a server approval claim and fresh guard validation", () => {
  const worker = read("worker/src/index.mjs");
  const approvalCycle = worker.slice(worker.indexOf("async function approvalCycle"), worker.indexOf("async function main"));
  assert.match(approvalCycle, /\/api\/automation\/claim/);
  assert.match(approvalCycle, /if \(!approval\) return/);
  assert.match(approvalCycle, /await submitApproved\(approval\)/);
  assert.equal((worker.match(/BidCopilotAdapter\.submit\(\)/g) || []).length, 1);
  assert.match(worker, /fresh\.decision !== "BID"/);
  assert.match(worker, /fresh\.guardReady !== true/);
  assert.match(worker, /fresh\.priceWithinBudget !== true/);
  assert.match(worker, /Project budget changed after approval/);
});

test("Worker blocks CAPTCHA and login challenges instead of bypassing them", () => {
  const worker = read("worker/src/index.mjs");
  assert.match(worker, /captcha/);
  assert.match(worker, /login_required/);
  assert.match(worker, /submission stopped without bypass/);
  assert.match(worker, /no automatic retry will occur/);
});

test("Worker ranks a bounded five-to-ten batch and polls approvals independently", () => {
  const worker = read("worker/src/index.mjs");
  assert.match(worker, /TOP_BIDS_PER_CYCLE/);
  assert.match(worker, /clamp\(process\.env\.TOP_BIDS_PER_CYCLE, 5, 5, 10\)/);
  assert.match(worker, /approvalTimer/);
  assert.match(worker, /scanTimer/);
  assert.match(worker, /scanBusy/);
});

test("Worker normalizes list fallbacks before both generate requests", () => {
  const worker = read("worker/src/index.mjs");
  assert.match(worker, /import \{ normalizeProjectInspection \}/);
  assert.equal((worker.match(/normalizeProjectInspection\(\{/g) || []).length, 2);
  assert.match(worker, /item,/);
  assert.match(worker, /approval\.project/);
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
  assert.match(persist, /await context\.storageState/);
  assert.match(persist, /await fs\.chmod\(markets\[site\]\.statePath, 0o600\)/);
});

test("hosted database uses a private RLS-enabled Supabase schema", () => {
  const schema = read("database/bid-copilot-schema.sql");
  const store = read("panel/lib/store.ts");
  assert.match(schema, /CREATE SCHEMA IF NOT EXISTS bid_copilot/);
  assert.equal((schema.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, 4);
  assert.match(schema, /REVOKE ALL ON SCHEMA bid_copilot FROM anon, authenticated/);
  assert.doesNotMatch(store, /(?:FROM|INTO|UPDATE) copilot_(?:projects|searches|bid_approvals|worker_state)/);
});

test("proposal strategy rejects repetitive AI-template sections", () => {
  const bid = read("panel/lib/bid.ts");
  assert.match(bid, /Tools & Software Stack/);
  assert.match(bid, /Asset Libraries/);
  assert.match(bid, /Project Roadmap/);
  assert.match(bid, /Reassuring Facts/);
  assert.match(bid, /never more than 4 short paragraphs/);
  assert.match(bid, /max_output_tokens: 350/);
});

test("dashboard exposes Worker health and Telegram approval queue", () => {
  const page = read("panel/app/page.tsx");
  assert.match(page, /mode === "automation"/);
  assert.match(page, /\/api\/automation\/heartbeat/);
  assert.match(page, /\/api\/automation\/candidates/);
  assert.match(page, /TELEGRAM APPROVAL REQUIRED/);
});

test("Worker storage-state credentials are explicitly excluded from source control", () => {
  const ignore = read("worker/.gitignore");
  const files = fs.readdirSync(path.join(root, "worker"), { recursive: true }).map(String);
  assert.match(ignore, /\*\.storage-state\.json/);
  assert.equal(files.some((file) => /storage-state\.json$/i.test(file)), false);
});
