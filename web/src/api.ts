// Talks to the Worker. API_BASE is set at build time (scripts/build-web.ts).
declare const API_BASE: string;

export interface Auth {
  id: string;
  key: string;
  nick: string;
  recovery?: string;
}

export interface Match {
  id: number;
  comp: string;
  kickoff: number;
  home: string;
  away: string;
  hc?: string | null; // team crest links (football-data.org), null when unknown
  ac?: string | null;
  status: string;
  hg: number | null;
  ag: number | null;
  h1: number;
  hx: number;
  h2: number;
  h1x: number;
  hx2: number;
  h12: number;
  settled: number;
  // League position and points per game (null until the daily job has the table).
  hpos?: number | null;
  hppg?: number | null;
  apos?: number | null;
  appg?: number | null;
}

export interface SavedPick {
  m: number;
  pick: string;
  sh: number | null;
  sa: number | null;
}

export interface GroupInfo {
  id: string;
  name: string;
  code: string;
  n: number;
  comp: string; // every group is for one competition
  done: number; // 0 while the round runs, else the time it was concluded
}

export interface GroupDetail extends GroupInfo {
  round: number;
  started: number;
  end_day: string | null; // last day counted, once concluded
  admin: boolean;
}

export interface Home {
  now: number;
  me: { id: string; nick: string; total: number; exact: number };
  matches: Match[];
  emblems?: Record<string, string>; // competition code → emblem link (task 10D)
  picks: SavedPick[];
  groups: GroupInfo[];
}

export interface BoardRow {
  id: string;
  nick: string;
  total: number;
  exact: number;
  week: number;
  month: number;
}

export interface GroupData {
  group: GroupDetail;
  board: BoardRow[];
  reveal: (SavedPick & { nick: string })[];
}

export type HistoryRow = Match & { pick: string; sh: number | null; sa: number | null };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const STORE = 'calledit.auth';

export function loadAuth(): Auth | null {
  try {
    const a = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    return a && typeof a.nick === 'string' ? a : null;
  } catch {
    return null;
  }
}

export function saveAuth(a: Auth | null): void {
  try {
    if (a) localStorage.setItem(STORE, JSON.stringify(a));
    else localStorage.removeItem(STORE);
  } catch {}
}

export async function api<T>(auth: Auth | null, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth?.id && auth.key) headers.authorization = `Bearer ${auth.id}.${auth.key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Something went wrong.');
  return data as T;
}

// GET /v1/stats (task 10B). Points are in halves.
export interface Tally {
  n: number;
  right: number;
  exact: number;
}

export interface Stats {
  keep: number; // days of stored picks behind byPick
  half: number; // days in each of recent / previous
  recent: Tally;
  previous: Tally;
  byPick: Record<string, { n: number; right: number }>;
  streak: number;
  months: { m: string; h: number }[]; // last 12 months, oldest first
  comps: { comp: string; h: number; exact: number }[]; // this season, most points first
}
