-- Emergency links texted to contacts (see src/share.php): the SHA-256 of
-- the per-SOS token the app generates. Additive only.
ALTER TABLE sos_events ADD COLUMN share_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sos_events_share_key ON sos_events (share_token_hash);
