CREATE TABLE match_history (
  uid TEXT NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  -- 'server' rows were recorded by a room. 'device' rows were reported by the player's own device.
  source TEXT NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (uid, id)
);
CREATE INDEX match_history_recent ON match_history (uid, at DESC);
