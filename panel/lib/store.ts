import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { ApprovalStatus, BidApprovalRecord, ProjectRecord, SearchRecord, WorkerHeartbeat } from "./types";

const dataDir = process.env.COPILOT_DATA_DIR?.trim()
  ? path.resolve(process.env.COPILOT_DATA_DIR.trim())
  : path.join(process.cwd(), ".data");
const projectsFile = path.join(dataDir, "projects.json");
const searchesFile = path.join(dataDir, "searches.json");
const approvalsFile = path.join(dataDir, "approvals.json");
const workersFile = path.join(dataDir, "workers.json");

type LocalItems = ProjectRecord | SearchRecord | BidApprovalRecord | WorkerHeartbeat;
type DatabaseGlobal = typeof globalThis & {
  bidCopilotPool?: Pool;
  bidCopilotLocalCache?: Map<string, LocalItems[]>;
  bidCopilotLocalWrites?: Map<string, Promise<unknown>>;
};
const databaseGlobal = globalThis as DatabaseGlobal;
const databaseUrl = process.env.DATABASE_URL?.trim();
const localCache = databaseGlobal.bidCopilotLocalCache ||= new Map();
const localWrites = databaseGlobal.bidCopilotLocalWrites ||= new Map();

function pool() {
  if (!databaseUrl) return null;
  if (!databaseGlobal.bidCopilotPool) {
    databaseGlobal.bidCopilotPool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000
    });
  }
  return databaseGlobal.bidCopilotPool;
}

let schemaReady: Promise<void> | null = null;
async function ensureSchema() {
  const db = pool();
  if (!db) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query("CREATE SCHEMA IF NOT EXISTS bid_copilot");
      await db.query(`
        CREATE TABLE IF NOT EXISTS bid_copilot.copilot_projects (
          id TEXT PRIMARY KEY,
          url TEXT UNIQUE NOT NULL,
          site TEXT NOT NULL,
          status TEXT NOT NULL,
          captured_at TIMESTAMPTZ NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS bid_copilot.copilot_searches (
          id TEXT PRIMARY KEY,
          site TEXT NOT NULL,
          query TEXT NOT NULL DEFAULT '',
          page_url TEXT NOT NULL,
          result_count INTEGER NOT NULL DEFAULT 0,
          searched_at TIMESTAMPTZ NOT NULL,
          payload JSONB NOT NULL
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS bid_copilot.copilot_bid_approvals (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          url TEXT UNIQUE NOT NULL,
          site TEXT NOT NULL,
          status TEXT NOT NULL,
          score INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ NOT NULL,
          approval_token_hash TEXT NOT NULL,
          telegram_chat_id TEXT,
          telegram_message_id BIGINT,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS bid_copilot.copilot_worker_state (
          worker_id TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS copilot_projects_captured_idx ON bid_copilot.copilot_projects (captured_at DESC)");
      await db.query("CREATE INDEX IF NOT EXISTS copilot_searches_searched_idx ON bid_copilot.copilot_searches (searched_at DESC)");
      await db.query("CREATE INDEX IF NOT EXISTS copilot_approvals_status_idx ON bid_copilot.copilot_bid_approvals (status, score DESC, created_at ASC)");
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function readJsonFile<T extends LocalItems>(file: string): Promise<T[]> {
  const cached = localCache.get(file);
  if (cached) return cached as T[];
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as T[];
    localCache.set(file, parsed);
    return parsed;
  } catch {
    localCache.set(file, []);
    return [];
  }
}

async function readJson<T extends LocalItems>(file: string): Promise<T[]> {
  const pending = localWrites.get(file);
  if (pending) await pending.catch(() => undefined);
  return readJsonFile<T>(file);
}

async function writeJsonFile<T extends LocalItems>(file: string, items: T[]) {
  const trimmed = items.slice(0, 250);
  await fs.mkdir(dataDir, { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(trimmed, null, 2), "utf8");
  await fs.rename(temporary, file);
  localCache.set(file, trimmed);
}

async function mutateJson<T extends LocalItems>(file: string, update: (items: T[]) => T[]): Promise<T[]> {
  const previous = localWrites.get(file) || Promise.resolve();
  const operation: Promise<T[]> = previous.catch(() => undefined).then(async () => {
    const current = await readJsonFile<T>(file);
    const next = update(current);
    await writeJsonFile(file, next);
    return next;
  });
  localWrites.set(file, operation);
  try {
    return await operation;
  } finally {
    if (localWrites.get(file) === operation) localWrites.delete(file);
  }
}

export async function saveProject(record: ProjectRecord) {
  const db = pool();
  if (db) {
    await ensureSchema();
    await db.query(
      `INSERT INTO bid_copilot.copilot_projects (id, url, site, status, captured_at, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT (url) DO UPDATE SET
         id = EXCLUDED.id,
         site = EXCLUDED.site,
         status = EXCLUDED.status,
         captured_at = EXCLUDED.captured_at,
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [record.id, record.url, record.site, record.status, record.capturedAt, JSON.stringify(record)]
    );
    return;
  }
  await mutateJson<ProjectRecord>(projectsFile, (items) => [
    record,
    ...items.filter((x) => x.id !== record.id && x.url !== record.url)
  ]);
}

export async function updateProjectStatus(url: string, status: ProjectRecord["status"]) {
  const db = pool();
  if (db) {
    await ensureSchema();
    const current = await db.query<{ payload: ProjectRecord }>("SELECT payload FROM bid_copilot.copilot_projects WHERE url = $1 LIMIT 1", [url]);
    const record = current.rows[0]?.payload;
    if (!record) return null;
    const next = { ...record, status };
    await db.query(
      "UPDATE bid_copilot.copilot_projects SET status = $2, payload = $3::jsonb, updated_at = NOW() WHERE url = $1",
      [url, status, JSON.stringify(next)]
    );
    return next;
  }
  const next = await mutateJson<ProjectRecord>(projectsFile, (items) =>
    items.map((x) => x.url === url ? { ...x, status } : x)
  );
  return next.find((x) => x.url === url) || null;
}

export async function listProjects() {
  const db = pool();
  if (db) {
    await ensureSchema();
    const result = await db.query<{ payload: ProjectRecord }>("SELECT payload FROM bid_copilot.copilot_projects ORDER BY captured_at DESC LIMIT 250");
    return result.rows.map((row) => row.payload);
  }
  return readJson<ProjectRecord>(projectsFile);
}

export async function saveSearch(record: SearchRecord) {
  const db = pool();
  if (db) {
    await ensureSchema();
    await db.query(
      `INSERT INTO bid_copilot.copilot_searches (id, site, query, page_url, result_count, searched_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         site = EXCLUDED.site,
         query = EXCLUDED.query,
         page_url = EXCLUDED.page_url,
         result_count = EXCLUDED.result_count,
         searched_at = EXCLUDED.searched_at,
         payload = EXCLUDED.payload`,
      [record.id, record.site, record.query, record.pageUrl, record.resultCount, record.searchedAt, JSON.stringify(record)]
    );
    return;
  }
  await mutateJson<SearchRecord>(searchesFile, (items) => [
    record,
    ...items.filter((item) => item.id !== record.id)
  ]);
}

export async function listSearches() {
  const db = pool();
  if (db) {
    await ensureSchema();
    const result = await db.query<{ payload: SearchRecord }>("SELECT payload FROM bid_copilot.copilot_searches ORDER BY searched_at DESC LIMIT 250");
    return result.rows.map((row) => row.payload);
  }
  return readJson<SearchRecord>(searchesFile);
}

export async function queueBidApproval(record: BidApprovalRecord) {
  const db = pool();
  if (db) {
    await ensureSchema();
    const inserted = await db.query<{ payload: BidApprovalRecord }>(
      `INSERT INTO bid_copilot.copilot_bid_approvals
         (id, project_id, url, site, status, score, expires_at, approval_token_hash, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW())
       ON CONFLICT (url) DO NOTHING
       RETURNING payload`,
      [record.id, record.projectId, record.url, record.site, record.status, record.score, record.expiresAt,
        record.approvalTokenHash, JSON.stringify(record), record.createdAt]
    );
    if (inserted.rows[0]) return { record: inserted.rows[0].payload, created: true };
    const existing = await db.query<{ payload: BidApprovalRecord }>("SELECT payload FROM bid_copilot.copilot_bid_approvals WHERE url = $1 LIMIT 1", [record.url]);
    return { record: existing.rows[0]?.payload || record, created: false };
  }
  let created = false;
  let queued = record;
  await mutateJson<BidApprovalRecord>(approvalsFile, (items) => {
    const existing = items.find((item) => item.url === record.url);
    if (existing) {
      queued = existing;
      return items;
    }
    created = true;
    return [record, ...items];
  });
  return { record: queued, created };
}

export async function attachTelegramMessage(id: string, chatId: string, messageId: number) {
  const db = pool();
  if (db) {
    await ensureSchema();
    const current = await db.query<{ payload: BidApprovalRecord }>("SELECT payload FROM bid_copilot.copilot_bid_approvals WHERE id = $1 LIMIT 1", [id]);
    const record = current.rows[0]?.payload;
    if (!record) return null;
    const next = { ...record, telegramChatId: chatId, telegramMessageId: messageId, updatedAt: new Date().toISOString() };
    await db.query(
      `UPDATE bid_copilot.copilot_bid_approvals SET telegram_chat_id = $2, telegram_message_id = $3,
       payload = $4::jsonb, updated_at = NOW() WHERE id = $1`,
      [id, chatId, messageId, JSON.stringify(next)]
    );
    return next;
  }
  let updated: BidApprovalRecord | null = null;
  await mutateJson<BidApprovalRecord>(approvalsFile, (items) => items.map((item) => {
    if (item.id !== id) return item;
    updated = { ...item, telegramChatId: chatId, telegramMessageId: messageId, updatedAt: new Date().toISOString() };
    return updated;
  }));
  return updated;
}

export async function discardUnsentApproval(id: string) {
  const db = pool();
  if (db) {
    await ensureSchema();
    await db.query("DELETE FROM bid_copilot.copilot_bid_approvals WHERE id = $1 AND status = 'pending' AND telegram_message_id IS NULL", [id]);
    return;
  }
  await mutateJson<BidApprovalRecord>(approvalsFile, (items) => items.filter((item) => !(item.id === id && item.status === "pending" && !item.telegramMessageId)));
}

export async function listBidApprovals(limit = 100) {
  const db = pool();
  if (db) {
    await ensureSchema();
    await db.query("UPDATE bid_copilot.copilot_bid_approvals SET status = 'expired', payload = jsonb_set(payload, '{status}', '\"expired\"'), updated_at = NOW() WHERE status IN ('pending', 'approved') AND expires_at <= NOW()");
    const result = await db.query<{ payload: BidApprovalRecord }>("SELECT payload FROM bid_copilot.copilot_bid_approvals ORDER BY created_at DESC LIMIT $1", [Math.min(250, Math.max(1, limit))]);
    return result.rows.map((row) => row.payload);
  }
  const now = Date.now();
  const items = await mutateJson<BidApprovalRecord>(approvalsFile, (current) => current.map((item) =>
    (item.status === "pending" || item.status === "approved") && new Date(item.expiresAt).getTime() <= now
      ? { ...item, status: "expired", updatedAt: new Date().toISOString() }
      : item
  ));
  return items.slice(0, limit);
}

export async function decideBidApproval(id: string, decision: "approve" | "reject", tokenHash: string, chatId: string) {
  const now = new Date().toISOString();
  const nextStatus: ApprovalStatus = decision === "approve" ? "approved" : "rejected";
  const db = pool();
  if (db) {
    await ensureSchema();
    const current = await db.query<{ payload: BidApprovalRecord }>(
      `SELECT payload FROM bid_copilot.copilot_bid_approvals
       WHERE id = $1 AND status = 'pending' AND approval_token_hash = $2 AND expires_at > NOW()
         AND (telegram_chat_id IS NULL OR telegram_chat_id = $3)
       LIMIT 1`,
      [id, tokenHash, chatId]
    );
    const record = current.rows[0]?.payload;
    if (!record) return null;
    const next: BidApprovalRecord = {
      ...record,
      status: nextStatus,
      updatedAt: now,
      ...(decision === "approve" ? { approvedAt: now } : { rejectedAt: now })
    };
    const updated = await db.query(
      `UPDATE bid_copilot.copilot_bid_approvals SET status = $2, payload = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND status = 'pending' AND approval_token_hash = $4 AND expires_at > NOW()`,
      [id, nextStatus, JSON.stringify(next), tokenHash]
    );
    return updated.rowCount === 1 ? next : null;
  }
  let decided: BidApprovalRecord | null = null;
  await mutateJson<BidApprovalRecord>(approvalsFile, (items) => items.map((item) => {
    if (item.id !== id || item.status !== "pending" || item.approvalTokenHash !== tokenHash || new Date(item.expiresAt).getTime() <= Date.now()) return item;
    if (item.telegramChatId && item.telegramChatId !== chatId) return item;
    decided = { ...item, status: nextStatus, updatedAt: now, ...(decision === "approve" ? { approvedAt: now } : { rejectedAt: now }) };
    return decided;
  }));
  return decided;
}

export async function claimApprovedBid(workerId: string) {
  const db = pool();
  const now = new Date().toISOString();
  if (db) {
    await ensureSchema();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ id: string; payload: BidApprovalRecord }>(
        `SELECT id, payload FROM bid_copilot.copilot_bid_approvals
         WHERE status = 'approved' AND expires_at > NOW()
         ORDER BY score DESC, created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`
      );
      const record = selected.rows[0]?.payload;
      if (!record) {
        await client.query("COMMIT");
        return null;
      }
      const next: BidApprovalRecord = { ...record, status: "submitting", claimedBy: workerId, claimedAt: now, updatedAt: now, attempts: (record.attempts || 0) + 1 };
      await client.query("UPDATE bid_copilot.copilot_bid_approvals SET status = 'submitting', payload = $2::jsonb, updated_at = NOW() WHERE id = $1", [record.id, JSON.stringify(next)]);
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  let claimed: BidApprovalRecord | null = null;
  await mutateJson<BidApprovalRecord>(approvalsFile, (items) => {
    const candidate = items.filter((item) => item.status === "approved" && new Date(item.expiresAt).getTime() > Date.now())
      .sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))[0];
    if (!candidate) return items;
    return items.map((item) => {
      if (item.id !== candidate.id) return item;
      claimed = { ...item, status: "submitting", claimedBy: workerId, claimedAt: now, updatedAt: now, attempts: (item.attempts || 0) + 1 };
      return claimed;
    });
  });
  return claimed;
}

export async function finishBidSubmission(id: string, status: "submitted" | "failed", errorMessage = "") {
  const now = new Date().toISOString();
  const db = pool();
  if (db) {
    await ensureSchema();
    const current = await db.query<{ payload: BidApprovalRecord }>("SELECT payload FROM bid_copilot.copilot_bid_approvals WHERE id = $1 AND status = 'submitting' LIMIT 1", [id]);
    const record = current.rows[0]?.payload;
    if (!record) return null;
    const next: BidApprovalRecord = { ...record, status, updatedAt: now, ...(status === "submitted" ? { submittedAt: now, lastError: undefined } : { lastError: errorMessage || "Submission failed" }) };
    await db.query("UPDATE bid_copilot.copilot_bid_approvals SET status = $2, payload = $3::jsonb, updated_at = NOW() WHERE id = $1 AND status = 'submitting'", [id, status, JSON.stringify(next)]);
    await updateProjectStatus(record.url, status === "submitted" ? "submitted" : "error");
    return next;
  }
  let finished: BidApprovalRecord | null = null;
  await mutateJson<BidApprovalRecord>(approvalsFile, (items) => items.map((item) => {
    if (item.id !== id || item.status !== "submitting") return item;
    finished = { ...item, status, updatedAt: now, ...(status === "submitted" ? { submittedAt: now, lastError: undefined } : { lastError: errorMessage || "Submission failed" }) };
    return finished;
  }));
  if (finished) await updateProjectStatus((finished as BidApprovalRecord).url, status === "submitted" ? "submitted" : "error");
  return finished;
}

export async function saveWorkerHeartbeat(heartbeat: WorkerHeartbeat) {
  const db = pool();
  if (db) {
    await ensureSchema();
    await db.query(
      `INSERT INTO bid_copilot.copilot_worker_state (worker_id, payload, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (worker_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [heartbeat.workerId, JSON.stringify(heartbeat)]
    );
    return;
  }
  await mutateJson<WorkerHeartbeat>(workersFile, (items) => [heartbeat, ...items.filter((item) => item.workerId !== heartbeat.workerId)]);
}

export async function listWorkerHeartbeats() {
  const db = pool();
  if (db) {
    await ensureSchema();
    const result = await db.query<{ payload: WorkerHeartbeat }>("SELECT payload FROM bid_copilot.copilot_worker_state ORDER BY updated_at DESC LIMIT 20");
    return result.rows.map((row) => row.payload);
  }
  return readJson<WorkerHeartbeat>(workersFile);
}
