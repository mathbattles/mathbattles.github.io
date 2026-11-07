-- Friends: one row per direction once accepted. A pending request has only the asker's row.
CREATE TABLE friends (
  uid TEXT NOT NULL,
  friend_uid TEXT NOT NULL,
  status TEXT NOT NULL, -- 'pending' (uid asked friend_uid) or 'accepted'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid, friend_uid)
);
CREATE INDEX friends_incoming ON friends (friend_uid, status);

-- Who is online, and which room they're in. Updated by the game every few seconds while open.
CREATE TABLE presence (
  uid TEXT PRIMARY KEY,
  room TEXT,
  last_seen INTEGER NOT NULL
);

-- A party follows its leader into rooms.
CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  leader TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE party_members (
  uid TEXT PRIMARY KEY,
  party_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL
);
CREATE INDEX party_members_party ON party_members (party_id);

-- Invitations to a room or a party. Old ones are cleared by the daily job.
CREATE TABLE invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_uid TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'room' or 'party'
  target TEXT NOT NULL, -- a room code or a party id
  created_at INTEGER NOT NULL
);
CREATE INDEX invites_to ON invites (to_uid, created_at);

-- Player-made maps that were shared.
CREATE TABLE maps (
  code TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  author TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX maps_recent ON maps (created_at DESC);
CREATE INDEX maps_author ON maps (uid, created_at DESC);
