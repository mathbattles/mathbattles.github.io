CREATE TABLE players (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  season INTEGER NOT NULL DEFAULT 1,
  games INTEGER NOT NULL DEFAULT 0,
  profile TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX players_rating ON players (rating DESC);

CREATE TABLE rooms (
  code TEXT PRIMARY KEY,
  is_public INTEGER NOT NULL,
  players INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'teams',
  mode TEXT NOT NULL DEFAULT 'fn',
  in_lobby INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX rooms_open ON rooms (is_public, in_lobby, updated_at);

CREATE TABLE daily_scores (
  day INTEGER NOT NULL,
  who TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  shots INTEGER NOT NULL,
  chars INTEGER NOT NULL,
  PRIMARY KEY (day, who)
);
CREATE INDEX daily_board ON daily_scores (day, score);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  reported TEXT,
  text TEXT,
  created_at INTEGER NOT NULL
);
