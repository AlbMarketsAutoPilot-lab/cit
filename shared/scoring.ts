// Game maths shared by the Worker (settlement) and the app (points on the buttons).
// Frozen rules: docs/PLAN.md §2. Points are integers in halves: 7 means 3.5 points.

export type Pick = '1' | 'X' | '2' | '1X' | 'X2' | '12';
export type Outcome = '1' | 'X' | '2';
export const PICKS: readonly Pick[] = ['1', 'X', '2', '1X', 'X2', '12'];
export const EXACT_BONUS = 6; // +3 points
export const MAX_GOALS = 20;

export interface Probs {
  p1: number;
  pX: number;
  p2: number;
}

// Points per pick, in halves.
export type PointsTable = Record<Pick, number>;

// Win/draw/loss chances from points per game (null = fewer than 5 games or no table: use base rates).
export function probabilities(ppgHome: number | null, ppgAway: number | null): Probs {
  const d = ppgHome === null || ppgAway === null ? 0 : Math.max(-1, Math.min(1, (ppgHome - ppgAway) / 3));
  const p1 = Math.max(0.08, 0.45 + 0.3 * d);
  const pX = Math.max(0.08, 0.26 - 0.1 * Math.abs(d));
  const p2 = Math.max(0.08, 1 - (0.45 + 0.3 * d) - (0.26 - 0.1 * Math.abs(d)));
  const sum = p1 + pX + p2;
  return { p1: p1 / sum, pX: pX / sum, p2: p2 / sum };
}

// 2 / (3p), rounded to the nearest half point and clamped (singles 1–5, doubles 0.5–2.5).
function halves(p: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(4 / (3 * p))));
}

export function pointsTable(pr: Probs): PointsTable {
  return {
    '1': halves(pr.p1, 2, 10),
    X: halves(pr.pX, 2, 10),
    '2': halves(pr.p2, 2, 10),
    '1X': halves(pr.p1 + pr.pX, 1, 5),
    X2: halves(pr.pX + pr.p2, 1, 5),
    '12': halves(pr.p1 + pr.p2, 1, 5),
  };
}

export function isPick(v: unknown): v is Pick {
  return typeof v === 'string' && (PICKS as readonly string[]).includes(v);
}

export function outcome(home: number, away: number): Outcome {
  return home > away ? '1' : home < away ? '2' : 'X';
}

export function covers(pick: Pick, o: Outcome): boolean {
  return pick.includes(o);
}

export function isGoals(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_GOALS;
}

// An exact score is optional, but when given it must be whole goals and agree with the pick.
export function validScore(pick: Pick, sh: number | null, sa: number | null): boolean {
  if (sh === null && sa === null) return true;
  if (!isGoals(sh) || !isGoals(sa)) return false;
  return covers(pick, outcome(sh, sa));
}

export interface Scored {
  halves: number;
  exact: boolean;
}

// Points for one prediction once the regular-time result (hg–ag) is known.
export function score(
  table: PointsTable,
  pick: Pick,
  sh: number | null,
  sa: number | null,
  hg: number,
  ag: number,
): Scored {
  if (!covers(pick, outcome(hg, ag))) return { halves: 0, exact: false };
  const exact = sh === hg && sa === ag;
  return { halves: table[pick] + (exact ? EXACT_BONUS : 0), exact };
}

export function formatHalves(h: number): string {
  return h % 2 === 0 ? String(h / 2) : (h / 2).toFixed(1);
}

// Calendar helpers, all in UTC (PLAN §2).
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekStart(ms: number): string {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return dayOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
}

export function monthStart(ms: number): string {
  return dayOf(ms).slice(0, 8) + '01';
}
