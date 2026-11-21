CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 4000),
  contact TEXT NOT NULL DEFAULT '' CHECK(length(contact) <= 200),
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_inbox ON messages(archived_at, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_unread ON messages(read_at, archived_at);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS request_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS limits_expiry ON request_limits(expires_at);
