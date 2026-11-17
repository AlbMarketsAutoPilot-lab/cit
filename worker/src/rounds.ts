// Group round tables and concluding (task 10C). Rules in shared/groups.ts.
import { DUE_SQL, FREEZE_SQL, memberStartDay, TABLE_SQL } from '../../shared/groups.ts';
import { dayOf, monthStart, weekStart } from '../../shared/scoring.ts';

export interface RoundGroup {
  id: string;
  comp: string;
  started: number;
}

export interface RoundRow {
  id: string;
  nick: string;
  week: number;
  month: number;
  total: number;
  exact: number;
}

// The running table of a round, counting days up to lastDay.
export async function roundTable(db: D1Database, g: RoundGroup, lastDay: string, now: number): Promise<RoundRow[]> {
  const members = (
    await db.prepare('SELECT user_id, joined_at FROM members WHERE group_id = ?1').bind(g.id).all<{ user_id: string; joined_at: number }>()
  ).results;
  const list = members.map((m) => ({ u: m.user_id, s: memberStartDay(g.started, m.joined_at) }));
  return (
    await db.prepare(TABLE_SQL).bind(JSON.stringify(list), g.comp, weekStart(now), monthStart(now), lastDay).all<RoundRow>()
  ).results;
}

// Freeze the table up to lastDay and mark the round concluded (one atomic batch; no-op if already done).
export async function concludeRound(db: D1Database, g: RoundGroup, lastDay: string, now: number): Promise<void> {
  const rows = await roundTable(db, g, lastDay, now);
  const frozen = JSON.stringify(rows.map((r) => ({ u: r.id, h: r.total, e: r.exact })));
  await db.batch([
    db.prepare(FREEZE_SQL[0]).bind(g.id),
    db.prepare(FREEZE_SQL[1]).bind(g.id, frozen),
    db.prepare(FREEZE_SQL[2]).bind(g.id, now, lastDay),
  ]);
}

// Daily job: conclude rounds whose competition's season is over.
export async function concludeDue(db: D1Database, now: number): Promise<number> {
  const due = (await db.prepare(DUE_SQL).bind(dayOf(now)).all<RoundGroup & { end: string }>()).results;
  for (const g of due) await concludeRound(db, g, g.end, now);
  return due.length;
}
