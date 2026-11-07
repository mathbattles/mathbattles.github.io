CREATE TABLE usernames (
  username_lc TEXT PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  display TEXT NOT NULL,
  -- A real email the player asked to log in with. Never returned without the correct password.
  login_email TEXT,
  created_at INTEGER NOT NULL
);
