-- VISHWAS schema v1 (SQLite — used only for local tests; mirrors the PostgreSQL schema). Additive only: never drops or rewrites data.
-- Timestamps are written by the app as ISO-8601 UTC; IDs are generated in PHP.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,                 -- lower-cased
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,         -- PHP password_hash (Argon2id), never plaintext
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,         -- SHA-256 of the bearer token
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  hits INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sos_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,             -- the app's session id: retries never duplicate
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'cancelled')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  received_at TEXT NOT NULL,    -- when the server got it
  updated_at TEXT NOT NULL,
  contacts TEXT,
  alert_summary TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sos_events_user_client_key ON sos_events (user_id, client_id);

CREATE TABLE IF NOT EXISTS sos_locations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES sos_events (id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  recorded_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sos_locations_event_idx ON sos_locations (event_id);

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id TEXT REFERENCES sos_events (id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'video', 'photo')),
  part INTEGER NOT NULL,
  upload_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,           -- path inside the private storage folder
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS recordings_upload_key ON recordings (upload_key);
CREATE INDEX IF NOT EXISTS recordings_user_idx ON recordings (user_id);

-- SMS / WhatsApp alerts (Twilio). Stored so retries never re-send and
-- delivery reports can be matched across requests.
CREATE TABLE IF NOT EXISTS alert_sessions (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  who TEXT,
  recipients TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_media (
  media_key TEXT PRIMARY KEY,          -- session/kind/part
  session_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  url TEXT NOT NULL,
  results TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_messages (
  sid TEXT PRIMARY KEY,                -- Twilio message id
  session_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  media_key TEXT
);
