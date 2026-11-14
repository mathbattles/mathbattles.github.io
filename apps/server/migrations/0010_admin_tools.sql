-- Admin tools: bans and mutes, a log of every admin change, and game settings changed without a redeploy.
CREATE TABLE IF NOT EXISTS sanctions (
  uid TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'ban' (no matches) or 'mute' (no chat)
  reason TEXT NOT NULL,
  until INTEGER NOT NULL,      -- ms since epoch
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid, kind)
);

CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
