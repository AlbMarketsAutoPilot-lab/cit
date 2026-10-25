-- Called It! database (Cloudflare D1). Idempotent: safe to run on every deploy. PLAN §4.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nick TEXT NOT NULL UNIQUE COLLATE NOCASE,
  key_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  total_h INTEGER NOT NULL DEFAULT 0,
  exact_n INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Points per pick (h1..h12) are in halves and fixed when the match is first imported.
-- settled: 0 = pending, 1 = scored, 2 = void. hg/ag = regular-time result.
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  comp TEXT NOT NULL,
  kickoff INTEGER NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  home_crest TEXT,
  away_crest TEXT,
  status TEXT NOT NULL,
  hg INTEGER,
  ag INTEGER,
  h1 INTEGER NOT NULL,
  hx INTEGER NOT NULL,
  h2 INTEGER NOT NULL,
  h1x INTEGER NOT NULL,
  hx2 INTEGER NOT NULL,
  h12 INTEGER NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS matches_kickoff ON matches (kickoff);

-- League position and points per game, refreshed by the daily job; team = the name used in matches.
CREATE TABLE IF NOT EXISTS team_stats (
  comp TEXT NOT NULL,
  team TEXT NOT NULL,
  pos INTEGER NOT NULL,
  ppg REAL NOT NULL,
  PRIMARY KEY (comp, team)
) WITHOUT ROWID;

-- Keyed by match first: settlement and the group reveal read one match's picks in a range.
CREATE TABLE IF NOT EXISTS predictions (
  match_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  pick TEXT NOT NULL,
  sh INTEGER,
  sa INTEGER,
  edits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, user_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS members_user ON members (user_id, group_id);

CREATE TABLE IF NOT EXISTS daily_points (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  h INTEGER NOT NULL,
  exact INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (k, v) VALUES ('settle_version', '0'), ('tier', '0'), ('db_size', '0'), ('last_import', '');
