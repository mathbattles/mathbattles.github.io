-- Short replay links: the server keeps the replay, and the link carries an 8-character id.
CREATE TABLE IF NOT EXISTS replays (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_viewed INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS replays_last_viewed ON replays (last_viewed);
