-- App data backed up from the phone (emergency contacts, Voice SOS settings):
-- one JSON document per user, replaced on every backup. Additive only.
CREATE TABLE IF NOT EXISTS user_backups (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
