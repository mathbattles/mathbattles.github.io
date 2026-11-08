-- Direct messages between friends. Kept for 30 days, then deleted by the daily job.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  from_uid TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX messages_pair ON messages (from_uid, to_uid, created_at);
CREATE INDEX messages_unread ON messages (to_uid, read_at);
CREATE INDEX messages_age ON messages (created_at);
