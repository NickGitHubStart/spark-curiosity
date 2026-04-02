-- Spark Cloud Companion — D1 Schema
-- Each user is identified by their installation token.

CREATE TABLE IF NOT EXISTS user_memory (
  token TEXT PRIMARY KEY,
  body TEXT NOT NULL DEFAULT '## Long-Term\n- (leer)\n\n## Mid-Term\n- (leer)\n\n## Short-Term\n- (leer)',
  onboarding_complete INTEGER NOT NULL DEFAULT 0,
  template_id TEXT,
  lang TEXT NOT NULL DEFAULT 'de',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS curated_gate (
  token TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  rules TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS block_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  platform TEXT,
  url TEXT,
  action TEXT,
  session_seconds INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_block_events_token ON block_events(token);
CREATE INDEX IF NOT EXISTS idx_block_events_timestamp ON block_events(token, timestamp);

CREATE TABLE IF NOT EXISTS bug_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  description TEXT,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  highlights TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT ''
);
