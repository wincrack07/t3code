CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('write', 'read')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE threads (
  id INTEGER PRIMARY KEY,
  environment_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  project TEXT,
  archived INTEGER NOT NULL,
  deleted_at TEXT,
  meta TEXT NOT NULL,
  UNIQUE(environment_id, thread_id)
);
CREATE INDEX threads_order ON threads(updated_at DESC, environment_id DESC, thread_id DESC);
CREATE VIRTUAL TABLE thread_search USING fts5(title, markdown);
