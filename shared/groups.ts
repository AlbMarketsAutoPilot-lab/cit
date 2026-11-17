// Group rounds (task 10C, decision log 2026-11-16). Every group is for one competition. A round's table
// counts only that competition's points, from the day after the round started or the member joined
// (whichever is later), so nobody brings points from before. It ends for everyone on the same day:
// when the admin concludes it, or by itself when the competition's season is over.
import { dayOf } from './scoring.ts';

const DAY = 86_400_000;

// First UTC day whose points count for a member: the day after the later of round start and joining.
export function memberStartDay(started: number, joinedAt: number): string {
  return dayOf(Math.max(started, joinedAt) + DAY);
}

export interface TableRow {
  id: string;
  nick: string;
  total: number; // points this round, in halves
  exact: number;
}

// Order of a round table and the podium: points, then exact scores, then nickname. Equal points and
// equal exact scores share a rank.
export function rankTable<T extends TableRow>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total || b.exact - a.exact || a.nick.localeCompare(b.nick));
  let rank = 0;
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.total !== r.total || prev.exact !== r.exact) rank = i + 1;
    return { ...r, rank };
  });
}

// One group table. ?1 = JSON [{u: user id, s: first counted day}], ?2 = competition,
// ?3 = week start, ?4 = month start, ?5 = last counted day. Reads comp_points by its key (user, comp, day).
export const TABLE_SQL = `SELECT u.id, u.nick,
    COALESCE(SUM(CASE WHEN cp.day >= ?3 THEN cp.h END), 0) AS week,
    COALESCE(SUM(CASE WHEN cp.day >= ?4 THEN cp.h END), 0) AS month,
    COALESCE(SUM(cp.h), 0) AS total,
    COALESCE(SUM(cp.exact), 0) AS exact
  FROM json_each(?1) AS j
  JOIN users AS u ON u.id = json_extract(j.value, '$.u')
  LEFT JOIN comp_points AS cp ON cp.user_id = u.id AND cp.comp = ?2
    AND cp.day >= json_extract(j.value, '$.s') AND cp.day <= ?5
  GROUP BY u.id`;

// Freeze a round: ?1 = group id, ?2 = JSON [{u, h, e}]. Only while the round is still running.
export const FREEZE_SQL = [
  `DELETE FROM group_results WHERE group_id = ?1 AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND done = 0)`,
  `INSERT INTO group_results (group_id, user_id, h, exact)
   SELECT ?1, json_extract(value, '$.u'), json_extract(value, '$.h'), json_extract(value, '$.e')
   FROM json_each(?2) WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND done = 0)`,
  // ?1 = group id, ?2 = now (ms), ?3 = last counted day
  `UPDATE groups SET done = ?2, end_day = ?3 WHERE id = ?1 AND done = 0`,
];

// Groups whose competition's season is over: ?1 = today (UTC day). The season must have ended before
// today, the round must have started on or before its last day, and every match of that competition
// up to that day must be settled or void.
export const DUE_SQL = `SELECT g.id, g.comp, g.started, s.end_day AS end
  FROM groups AS g JOIN seasons AS s ON s.comp = g.comp
  WHERE g.done = 0 AND s.end_day < ?1 AND date(g.started / 1000, 'unixepoch') <= s.end_day
    AND NOT EXISTS (SELECT 1 FROM matches AS m WHERE m.comp = g.comp AND m.settled = 0
      AND m.kickoff < (CAST(strftime('%s', s.end_day) AS INTEGER) + 86400) * 1000)
  LIMIT 50`;

// A group whose admin left or was deleted gets the member who joined first as its new admin.
// Callers may append "AND groups.id = ?1" to limit it to one group.
export const NEW_ADMIN_SQL = `UPDATE groups SET owner_id = (SELECT user_id FROM members WHERE group_id = groups.id
    ORDER BY joined_at, user_id LIMIT 1)
  WHERE owner_id NOT IN (SELECT user_id FROM members WHERE group_id = groups.id)
    AND EXISTS (SELECT 1 FROM members WHERE group_id = groups.id)`;
