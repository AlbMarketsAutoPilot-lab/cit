-- Task 10C, run ONCE on the live database called-it, just before merging the pull request.
-- Approved by the owner on 2026-11-16: the test groups are deleted (groups and their memberships).
-- Users, picks, points and matches are NOT touched.
-- After the merge, the deploy runs worker/schema.sql, which creates the other new tables
-- (comp_points, group_results, seasons); they are also created here so the order does not matter.

DELETE FROM members;
DROP TABLE IF EXISTS groups;

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  comp TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  started INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  end_day TEXT
);

CREATE TABLE IF NOT EXISTS group_results (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  h INTEGER NOT NULL,
  exact INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS seasons (
  comp TEXT PRIMARY KEY,
  start_day TEXT NOT NULL,
  end_day TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comp_points (
  user_id TEXT NOT NULL,
  comp TEXT NOT NULL,
  day TEXT NOT NULL,
  h INTEGER NOT NULL,
  exact INTEGER NOT NULL,
  PRIMARY KEY (user_id, comp, day)
) WITHOUT ROWID;
