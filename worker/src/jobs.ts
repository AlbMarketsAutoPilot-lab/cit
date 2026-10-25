// The two cron jobs (PLAN §3, §6): hourly results + settlement, daily import + reminder + cleanup.
import { dayOf, isPick, pointsTable, probabilities, score, type PointsTable } from '../../shared/scoring.ts';
import { DAY, type Env } from './env.ts';

const API = 'https://api.football-data.org/v4';
export const COMPETITIONS = ['CL', 'PL', 'ELC', 'PD', 'SA', 'BL1', 'FL1', 'DED', 'PPL', 'BSA', 'WC', 'EC'];

interface FdTeam {
  id: number;
  name: string | null;
  shortName?: string | null;
  crest?: string | null;
}
interface FdGoals {
  home: number | null;
  away: number | null;
}
interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  competition: { code: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: { duration?: string; fullTime?: FdGoals; regularTime?: FdGoals };
}
interface FdStandings {
  standings?: { type: string; table: { team: { id: number }; playedGames: number; points: number }[] }[];
}

export interface MatchRow {
  id: number;
  kickoff: number;
  hg: number | null;
  ag: number | null;
  h1: number;
  hx: number;
  h2: number;
  h1x: number;
  hx2: number;
  h12: number;
}

export function tableOf(m: MatchRow): PointsTable {
  return { '1': m.h1, X: m.hx, '2': m.h2, '1X': m.h1x, X2: m.hx2, '12': m.h12 };
}

async function fd<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(API + path, { headers: { 'X-Auth-Token': env.FOOTBALL_DATA_KEY } });
  if (!res.ok) throw new Error(`football-data ${path}: ${res.status}`);
  return (await res.json()) as T;
}

async function fetchMatches(env: Env, from: number, to: number): Promise<FdMatch[]> {
  const r = await fd<{ matches?: FdMatch[] }>(env, `/matches?dateFrom=${dayOf(from)}&dateTo=${dayOf(to)}`);
  // Knockout games with teams still unknown come back later, once the teams are set.
  return (r.matches ?? []).filter(
    (m) => COMPETITIONS.includes(m.competition?.code) && m.homeTeam?.name && m.awayTeam?.name,
  );
}

const goals = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

// Regular time only (PLAN §2). With extra time or penalties, fullTime includes them, so use regularTime.
export function regularResult(m: FdMatch): [number, number] | [null, null] {
  if (m.status !== 'FINISHED') return [null, null];
  const s = m.score ?? {};
  const r = s.duration && s.duration !== 'REGULAR' ? s.regularTime : s.fullTime;
  return r && goals(r.home) && goals(r.away) ? [r.home, r.away] : [null, null];
}

// ppg: "<competition>:<team id>" → points per game (teams with 5+ games only).
async function upsertMatches(env: Env, list: FdMatch[], ppg: Map<string, number>): Promise<void> {
  if (!list.length) return;
  const rows = list.map((m) => {
    const c = m.competition.code;
    const t = pointsTable(probabilities(ppg.get(`${c}:${m.homeTeam.id}`) ?? null, ppg.get(`${c}:${m.awayTeam.id}`) ?? null));
    const [hg, ag] = regularResult(m);
    return {
      id: m.id,
      comp: c,
      kickoff: Date.parse(m.utcDate),
      home: m.homeTeam.shortName || m.homeTeam.name,
      away: m.awayTeam.shortName || m.awayTeam.name,
      hc: m.homeTeam.crest ?? null,
      ac: m.awayTeam.crest ?? null,
      status: m.status,
      hg,
      ag,
      h1: t['1'],
      hx: t.X,
      h2: t['2'],
      h1x: t['1X'],
      hx2: t.X2,
      h12: t['12'],
    };
  });
  // Points are fixed at first import; settled matches never change (PLAN §2).
  await env.DB.prepare(
    `INSERT INTO matches (id, comp, kickoff, home, away, home_crest, away_crest, status, hg, ag, h1, hx, h2, h1x, hx2, h12)
     SELECT json_extract(value, '$.id'), json_extract(value, '$.comp'), json_extract(value, '$.kickoff'),
       json_extract(value, '$.home'), json_extract(value, '$.away'), json_extract(value, '$.hc'), json_extract(value, '$.ac'),
       json_extract(value, '$.status'), json_extract(value, '$.hg'), json_extract(value, '$.ag'),
       json_extract(value, '$.h1'), json_extract(value, '$.hx'), json_extract(value, '$.h2'),
       json_extract(value, '$.h1x'), json_extract(value, '$.hx2'), json_extract(value, '$.h12')
     FROM json_each(?1) WHERE true
     ON CONFLICT (id) DO UPDATE SET kickoff = excluded.kickoff, status = excluded.status, hg = excluded.hg, ag = excluded.ag,
       home = excluded.home, away = excluded.away, home_crest = excluded.home_crest, away_crest = excluded.away_crest
     WHERE matches.settled = 0 AND (matches.kickoff IS NOT excluded.kickoff OR matches.status IS NOT excluded.status
       OR matches.hg IS NOT excluded.hg OR matches.ag IS NOT excluded.ag)`,
  )
    .bind(JSON.stringify(rows))
    .run();
}

interface PredRow {
  match_id: number;
  user_id: string;
  pick: string;
  sh: number | null;
  sa: number | null;
}

// Void stale matches, then score up to 20 finished ones in one atomic batch (idempotent).
export async function settle(env: Env, now: number): Promise<number> {
  const db = env.DB;
  await db
    .prepare(`UPDATE matches SET settled = 2 WHERE settled = 0 AND kickoff < ?1 AND (status != 'FINISHED' OR hg IS NULL)`)
    .bind(now - 7 * DAY)
    .run();
  const ms = (
    await db
      .prepare(
        `SELECT id, kickoff, hg, ag, h1, hx, h2, h1x, hx2, h12 FROM matches
         WHERE settled = 0 AND status = 'FINISHED' AND hg IS NOT NULL AND ag IS NOT NULL ORDER BY kickoff LIMIT 20`,
      )
      .all<MatchRow>()
  ).results;
  if (!ms.length) return 0;
  const ids = JSON.stringify(ms.map((m) => m.id));
  const preds = (
    await db
      .prepare(`SELECT match_id, user_id, pick, sh, sa FROM predictions WHERE match_id IN (SELECT value FROM json_each(?1))`)
      .bind(ids)
      .all<PredRow>()
  ).results;
  const byId = new Map(ms.map((m) => [m.id, m]));
  const sums = new Map<string, { u: string; d: string; h: number; e: number }>();
  for (const p of preds) {
    const m = byId.get(p.match_id);
    if (!m || m.hg === null || m.ag === null || !isPick(p.pick)) continue;
    const s = score(tableOf(m), p.pick, p.sh, p.sa, m.hg, m.ag);
    if (s.halves === 0) continue; // zero rows are not written; boards treat missing as 0
    const d = dayOf(m.kickoff);
    const key = `${p.user_id}|${d}`;
    const cur = sums.get(key) ?? { u: p.user_id, d, h: 0, e: 0 };
    cur.h += s.halves;
    cur.e += s.exact ? 1 : 0;
    sums.set(key, cur);
  }
  const rows = JSON.stringify([...sums.values()]);
  await db.batch([
    db
      .prepare(
        `INSERT INTO daily_points (user_id, day, h, exact)
         SELECT json_extract(value, '$.u'), json_extract(value, '$.d'), json_extract(value, '$.h'), json_extract(value, '$.e')
         FROM json_each(?1) WHERE true
         ON CONFLICT (user_id, day) DO UPDATE SET h = h + excluded.h, exact = exact + excluded.exact`,
      )
      .bind(rows),
    db
      .prepare(
        `UPDATE users SET total_h = total_h + t.h, exact_n = exact_n + t.e
         FROM (SELECT json_extract(value, '$.u') AS u, SUM(json_extract(value, '$.h')) AS h, SUM(json_extract(value, '$.e')) AS e
               FROM json_each(?1) GROUP BY 1) AS t
         WHERE users.id = t.u`,
      )
      .bind(rows),
    db.prepare(`UPDATE matches SET settled = 1 WHERE id IN (SELECT value FROM json_each(?1))`).bind(ids),
    db.prepare(`UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'settle_version'`),
  ]);
  return ms.length;
}

export async function hourly(env: Env): Promise<void> {
  const now = Date.now();
  try {
    await upsertMatches(env, await fetchMatches(env, now - 2 * DAY, now + DAY), new Map());
  } catch (e) {
    console.log('hourly import', String(e));
  }
  console.log('settled', await settle(env, now));
}

export async function daily(env: Env): Promise<void> {
  const now = Date.now();
  try {
    await importWeek(env, now);
  } catch (e) {
    console.log('daily import', String(e));
  }
  try {
    await remind(env, now);
  } catch (e) {
    console.log('reminder', String(e));
  }
  await cleanup(env, now);
}

async function importWeek(env: Env, now: number): Promise<void> {
  const list = await fetchMatches(env, now, now + 8 * DAY);
  const known = new Set(
    (
      await env.DB.prepare(`SELECT id FROM matches WHERE id IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(list.map((m) => m.id)))
        .all<{ id: number }>()
    ).results.map((r) => r.id),
  );
  // Standings only for competitions with new matches; ≤ 8 calls keeps us under 10 calls/minute.
  const comps = [...new Set(list.filter((m) => !known.has(m.id)).map((m) => m.competition.code))].slice(0, 8);
  const ppg = new Map<string, number>();
  for (const c of comps) {
    try {
      const s = await fd<FdStandings>(env, `/competitions/${c}/standings`);
      for (const st of s.standings ?? []) {
        if (st.type !== 'TOTAL') continue;
        for (const row of st.table ?? []) {
          if (row.playedGames >= 5) ppg.set(`${c}:${row.team.id}`, row.points / row.playedGames);
        }
      }
    } catch (e) {
      console.log('standings', c, String(e)); // no table only means base rates
    }
  }
  await upsertMatches(env, list, ppg);
  await env.DB.prepare(`INSERT OR REPLACE INTO meta (k, v) VALUES ('last_import', ?1)`).bind(new Date(now).toISOString()).run();
}

// One push to all subscribers, delivered at 11:00 in each user's own time zone (OneSignal).
async function remind(env: Env, now: number): Promise<void> {
  if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY) return;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM matches WHERE kickoff >= ?1 AND kickoff < ?2`)
    .bind(now, now + DAY)
    .first<{ n: number }>();
  const n = row?.n ?? 0;
  if (!n) return;
  const res = await fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${env.ONESIGNAL_API_KEY}` },
    body: JSON.stringify({
      app_id: env.ONESIGNAL_APP_ID,
      target_channel: 'push',
      included_segments: [env.ONESIGNAL_SEGMENT],
      headings: { en: 'Called It!' },
      contents: { en: `${n} ${n === 1 ? 'match' : 'matches'} today. Make your picks before kickoff!` },
      delayed_option: 'timezone',
      delivery_time_of_day: '11:00AM',
    }),
  });
  if (!res.ok) console.log('onesignal', res.status, await res.text());
}

// PLAN §6: retention shrinks automatically as the database grows towards the 500 MB limit.
export function tierFor(bytes: number): number {
  return bytes >= 450e6 ? 3 : bytes >= 350e6 ? 2 : bytes >= 250e6 ? 1 : 0;
}

async function cleanup(env: Env, now: number): Promise<void> {
  const db = env.DB;
  const size = (await db.prepare('SELECT 1').run()).meta.size_after ?? 0;
  const tier = tierFor(size);
  const cut = now - [60, 30, 14, 7][tier] * DAY;
  const inactive = now - (tier >= 2 ? 180 : 365) * DAY;
  await db.batch([
    db.prepare(`DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE kickoff < ?1 AND settled != 0)`).bind(cut),
    db.prepare(`DELETE FROM matches WHERE kickoff < ?1 AND settled != 0`).bind(cut),
    db.prepare(`DELETE FROM daily_points WHERE day < ?1`).bind(dayOf(now - 400 * DAY)),
    db.prepare(`DELETE FROM users WHERE last_seen < ?1`).bind(inactive),
    db.prepare(`DELETE FROM members WHERE user_id NOT IN (SELECT id FROM users)`),
    db.prepare(`DELETE FROM groups WHERE id NOT IN (SELECT group_id FROM members)`),
    db.prepare(`INSERT OR REPLACE INTO meta (k, v) VALUES ('tier', ?1), ('db_size', ?2)`).bind(String(tier), String(size)),
  ]);
  console.log('cleanup tier', tier, 'size', size);
}
