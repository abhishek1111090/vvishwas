-- App data backed up from the phone (emergency contacts, Voice SOS settings):
-- one JSON document per user, replaced on every backup. Additive only.
CREATE TABLE IF NOT EXISTS user_backups (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
