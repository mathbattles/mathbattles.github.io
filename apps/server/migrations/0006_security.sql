-- Two-step sign-in for the admin page. The secret is stored encrypted, and session tokens are
-- stored only as hashes, so a copy of this table can't be used to get in.
CREATE TABLE admin_mfa (
  uid TEXT PRIMARY KEY,
  secret_enc TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  -- The last 30-second step a code was accepted for, so a code can't be used twice.
  last_step INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX admin_sessions_uid ON admin_sessions (uid);

-- Invites get unguessable ids. They only ever live a day, so nothing is lost by starting over.
DROP TABLE IF EXISTS invites;
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  from_uid TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX invites_to ON invites (to_uid, created_at);

-- The Daily Challenge is gone.
DROP TABLE IF EXISTS daily_scores;
