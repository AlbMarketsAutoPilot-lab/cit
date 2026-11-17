// Group rounds (task 10C): who counts from when, ranking, settlement per competition, and the SQL
// itself, run on SQLite with the real worker/schema.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DUE_SQL, FREEZE_SQL, memberStartDay, NEW_ADMIN_SQL, rankTable, TABLE_SQL } from '../shared/groups.ts';
import { settlementSums } from '../shared/scoring.ts';

const T = (iso: string) => Date.parse(iso);

test('points count from the day after the round starts or the member joins, whichever is later', () => {
  const started = T('2026-11-16T18:00:00Z');
  assert.equal(memberStartDay(started, started), '2026-11-17'); // admin, joined at creation
  assert.equal(memberStartDay(started, T('2026-11-10T09:00:00Z')), '2026-11-17'); // member from an earlier round
  assert.equal(memberStartDay(started, T('2026-11-20T23:59:00Z')), '2026-11-21'); // joined later
});

test('rank: points, then exact scores, then nickname; full ties share a rank', () => {
  const r = rankTable([
    { id: 'a', nick: 'zed', total: 10, exact: 1 },
    { id: 'b', nick: 'amy', total: 10, exact: 1 },
    { id: 'c', nick: 'bob', total: 10, exact: 2 },
    { id: 'd', nick: 'cat', total: 4, exact: 0 },
  ]);
  assert.deepEqual(
    r.map((x) => [x.nick, x.rank]),
    [
      ['bob', 1],
      ['amy', 2],
      ['zed', 2],
      ['cat', 4],
    ],
  );
});

test('settlement sums per day and per competition and day', () => {
  const t = { '1': 4, X: 7, '2': 7, '1X': 2, X2: 3, '12': 2 } as const;
  const ms = [
    { id: 1, comp: 'SA', kickoff: T('2026-11-21T14:00:00Z'), hg: 2, ag: 1, table: t },
    { id: 2, comp: 'SA', kickoff: T('2026-11-21T19:45:00Z'), hg: 0, ag: 0, table: t },
    { id: 3, comp: 'PL', kickoff: T('2026-11-21T15:00:00Z'), hg: 1, ag: 3, table: t },
  ];
  const s = settlementSums(ms, [
    { match_id: 1, user_id: 'u1', pick: '1', sh: 2, sa: 1 }, // 4 + 6 exact
    { match_id: 2, user_id: 'u1', pick: 'X', sh: null, sa: null }, // 7
    { match_id: 3, user_id: 'u1', pick: '2', sh: null, sa: null }, // 7
    { match_id: 3, user_id: 'u2', pick: '1', sh: null, sa: null }, // 0: not written
    { match_id: 9, user_id: 'u2', pick: '1', sh: null, sa: null }, // unknown match
  ]);
  assert.deepEqual(s.daily, [{ u: 'u1', d: '2026-11-21', h: 24, e: 1 }]);
  assert.deepEqual(s.comp, [
    { u: 'u1', c: 'SA', d: '2026-11-21', h: 17, e: 1 },
    { u: 'u1', c: 'PL', d: '2026-11-21', h: 7, e: 0 },
  ]);
});

function db(): DatabaseSync {
  const d = new DatabaseSync(':memory:');
  d.exec(readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8'));
  const user = d.prepare(`INSERT INTO users (id, nick, key_hash, recovery_hash, last_seen, created_at) VALUES (?, ?, '', '', 0, 0)`);
  for (const [id, nick] of [
    ['A', 'ann'],
    ['B', 'ben'],
    ['C', 'cid'],
  ]) {
    user.run(id, nick);
  }
  const started = T('2026-11-16T18:00:00Z');
  d.prepare(`INSERT INTO groups (id, name, code, owner_id, created_at, comp, started) VALUES ('G', 'Friends', 'ABC123', 'A', ?1, 'SA', ?1)`).run(
    started,
  );
  const mem = d.prepare(`INSERT INTO members (group_id, user_id, joined_at) VALUES ('G', ?, ?)`);
  mem.run('A', started);
  mem.run('B', T('2026-11-17T10:00:00Z'));
  mem.run('C', T('2026-11-25T10:00:00Z')); // joins later
  const cp = d.prepare(`INSERT INTO comp_points (user_id, comp, day, h, exact) VALUES (?, ?, ?, ?, ?)`);
  cp.run('A', 'SA', '2026-11-16', 20, 1); // creation day: does not count
  cp.run('A', 'SA', '2026-11-22', 6, 0);
  cp.run('A', 'PL', '2026-11-22', 50, 3); // other competition: does not count
  cp.run('B', 'SA', '2026-11-22', 9, 1);
  cp.run('C', 'SA', '2026-11-22', 30, 2); // before C joined: does not count
  cp.run('C', 'SA', '2026-11-29', 4, 0);
  cp.run('A', 'SA', '2026-12-02', 2, 0);
  return d;
}

function table(d: DatabaseSync, lastDay: string) {
  const g = d.prepare(`SELECT started FROM groups WHERE id = 'G'`).get() as { started: number };
  const ms = d.prepare(`SELECT user_id, joined_at FROM members WHERE group_id = 'G'`).all() as { user_id: string; joined_at: number }[];
  const list = ms.map((m) => ({ u: m.user_id, s: memberStartDay(g.started, m.joined_at) }));
  const rows = d.prepare(TABLE_SQL).all(JSON.stringify(list), 'SA', '2026-11-30', '2026-12-01', lastDay) as Record<string, number | string>[];
  return Object.fromEntries(rows.map((r) => [r.nick, [r.week, r.month, r.total, r.exact]]));
}

test('round table counts only this competition, from each member start, up to the last day', () => {
  const d = db();
  assert.deepEqual(table(d, '2026-12-31'), {
    ann: [2, 2, 8, 0], // week from 30 Nov: 2; December: 2; round: 6 + 2
    ben: [0, 0, 9, 1],
    cid: [0, 0, 4, 0],
  });
  assert.deepEqual(table(d, '2026-11-30').ann, [0, 0, 6, 0]); // concluded on 30 Nov: 2 Dec not counted
});

test('freeze writes the final table once and marks the round done', () => {
  const d = db();
  const frozen = JSON.stringify([
    { u: 'A', h: 8, e: 0 },
    { u: 'B', h: 9, e: 1 },
  ]);
  d.prepare(FREEZE_SQL[0]).run('G');
  d.prepare(FREEZE_SQL[1]).run('G', frozen);
  d.prepare(FREEZE_SQL[2]).run('G', 123, '2026-11-30');
  // A second conclude (e.g. the daily job right after the admin) changes nothing.
  d.prepare(FREEZE_SQL[0]).run('G');
  d.prepare(FREEZE_SQL[1]).run('G', JSON.stringify([{ u: 'A', h: 99, e: 9 }]));
  d.prepare(FREEZE_SQL[2]).run('G', 456, '2026-12-31');
  assert.deepEqual({ ...d.prepare(`SELECT done, end_day FROM groups`).get() }, { done: 123, end_day: '2026-11-30' });
  assert.deepEqual(
    d.prepare(`SELECT user_id, h, exact FROM group_results ORDER BY user_id`).all().map((r) => ({ ...r })),
    [
      { user_id: 'A', h: 8, exact: 0 },
      { user_id: 'B', h: 9, exact: 1 },
    ],
  );
});

test('rounds end by themselves only after the season is over and its matches are settled', () => {
  const d = db();
  const due = () => d.prepare(DUE_SQL).all('2027-05-31').map((r) => ({ ...r }));
  assert.deepEqual(due(), []); // no season known yet
  d.exec(`INSERT INTO seasons (comp, start_day, end_day) VALUES ('SA', '2026-08-23', '2027-05-30')`);
  const match = d.prepare(
    `INSERT INTO matches (id, comp, kickoff, home, away, status, h1, hx, h2, h1x, hx2, h12, settled) VALUES (?, 'SA', ?, 'a', 'b', 'X', 0, 0, 0, 0, 0, 0, ?)`,
  );
  match.run(1, T('2027-05-30T18:45:00Z'), 0); // last match not settled yet
  match.run(2, T('2027-08-22T18:45:00Z'), 0); // next season's fixture: does not block
  assert.deepEqual(due(), []);
  d.exec(`UPDATE matches SET settled = 1 WHERE id = 1`);
  assert.deepEqual(due(), [{ id: 'G', comp: 'SA', started: T('2026-11-16T18:00:00Z'), end: '2027-05-30' }]);
  assert.deepEqual(d.prepare(DUE_SQL).all('2027-05-30'), []); // not on the last day itself
  // A round started after the season ended waits for the next season's dates.
  d.exec(`UPDATE groups SET started = ${T('2027-06-10T10:00:00Z')}`);
  assert.deepEqual(due(), []);
});

test('a group whose admin leaves gets the member who joined first', () => {
  const d = db();
  d.exec(`DELETE FROM members WHERE user_id = 'A'`);
  d.prepare(`${NEW_ADMIN_SQL} AND groups.id = ?1`).run('G');
  assert.equal((d.prepare(`SELECT owner_id FROM groups`).get() as { owner_id: string }).owner_id, 'B');
});
