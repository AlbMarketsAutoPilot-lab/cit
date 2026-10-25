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
}

export interface Home {
  now: number;
  me: { id: string; nick: string; total: number; exact: number };
  matches: Match[];
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
  group: GroupInfo;
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
