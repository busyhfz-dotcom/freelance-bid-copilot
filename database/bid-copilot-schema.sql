CREATE SCHEMA IF NOT EXISTS bid_copilot;

CREATE TABLE IF NOT EXISTS bid_copilot.copilot_projects (
  id TEXT PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  site TEXT NOT NULL,
  status TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bid_copilot.copilot_searches (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  searched_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

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
);

CREATE TABLE IF NOT EXISTS bid_copilot.copilot_worker_state (
  worker_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bid_copilot.copilot_reports (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL,
  site TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS copilot_projects_captured_idx ON bid_copilot.copilot_projects (captured_at DESC);
CREATE INDEX IF NOT EXISTS copilot_searches_searched_idx ON bid_copilot.copilot_searches (searched_at DESC);
CREATE INDEX IF NOT EXISTS copilot_approvals_status_idx ON bid_copilot.copilot_bid_approvals (status, score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS copilot_reports_created_idx ON bid_copilot.copilot_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS copilot_reports_category_idx ON bid_copilot.copilot_reports (category, created_at DESC);

ALTER TABLE bid_copilot.copilot_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_copilot.copilot_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_copilot.copilot_bid_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_copilot.copilot_worker_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_copilot.copilot_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA bid_copilot FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA bid_copilot FROM anon, authenticated;
