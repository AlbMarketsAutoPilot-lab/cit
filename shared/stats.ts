// Me statistics (task 10B, docs/PLAN.md §7 "10B"). Pure maths shared by the Worker and the tests.
// Pick-level stats can only use the picks still stored (60 days, fewer at higher cleanup tiers, §6);
// month and competition totals come from daily_points / comp_points (kept 400 days).
import { covers, isPick, outcome, PICKS, type Pick } from './scoring.ts';

// Days of picks kept by the cleanup at each tier (worker/src/jobs.ts cleanup).
export const KEEP_DAYS = [60, 30, 14, 7] as const;

// One settled pick: the match result and what the user picked.
export interface StatPick {
  kickoff: number;
  pick: string;
  sh: number | null;
  sa: number | null;
  hg: number;
  ag: number;
}

export interface Tally {
  n: number; // settled picks
  right: number; // right picks, exact scores included
  exact: number; // right picks with the exact score
}

export interface PickStats {
  keep: number; // days covered by byPick (all stored picks)
  half: number; // days in each comparison period
  recent: Tally; // last `half` days
  previous: Tally; // the `half` days before
  byPick: Record<Pick, { n: number; right: number }>;
  streak: number; // right picks in a row, counting back from the latest settled pick
}

export function keepDays(tier: number): number {
  return KEEP_DAYS[Math.max(0, Math.min(KEEP_DAYS.length - 1, Math.trunc(tier) || 0))];
}

const DAY = 86_400_000;

export function pickStats(picks: StatPick[], now: number, keep: number): PickStats {
  const half = Math.floor(keep / 2);
  const recentFrom = now - half * DAY;
  const previousFrom = now - 2 * half * DAY;
  const tally = (): Tally => ({ n: 0, right: 0, exact: 0 });
  const recent = tally();
  const previous = tally();
  const byPick = Object.fromEntries(PICKS.map((p) => [p, { n: 0, right: 0 }])) as PickStats['byPick'];
  const sorted = picks.filter((p) => isPick(p.pick) && p.kickoff >= now - keep * DAY && p.kickoff <= now);
  sorted.sort((a, b) => b.kickoff - a.kickoff);
  let streak = 0;
  let streakOpen = true;
  for (const p of sorted) {
    const right = covers(p.pick as Pick, outcome(p.hg, p.ag));
    const exact = right && p.sh === p.hg && p.sa === p.ag;
    byPick[p.pick as Pick].n++;
    if (right) byPick[p.pick as Pick].right++;
    const t = p.kickoff >= recentFrom ? recent : p.kickoff >= previousFrom ? previous : null;
    if (t) {
      t.n++;
      if (right) t.right++;
      if (exact) t.exact++;
    }
    if (streakOpen) {
      if (right) streak++;
      else streakOpen = false;
    }
  }
  return { keep, half, recent, previous, byPick, streak };
}

// First day ('YYYY-MM') of each of the last `count` months up to the month of `now`, oldest first (UTC).
export function lastMonths(now: number, count = 12): string[] {
  const d = new Date(now);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

// Points (halves) per month for the last 12 months, months without points as 0.
export function monthSeries(rows: { m: string; h: number }[], now: number): { m: string; h: number }[] {
  const by = new Map(rows.map((r) => [r.m, Number(r.h) || 0]));
  return lastMonths(now).map((m) => ({ m, h: by.get(m) ?? 0 }));
}
