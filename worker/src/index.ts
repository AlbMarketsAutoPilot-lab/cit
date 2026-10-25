// Called It! API (PLAN §5). Bearer auth with a random key per device; no cookies, so CORS is open.
import { isGoals, isPick, monthStart, validScore, weekStart } from '../../shared/scoring.ts';
import { DAY, type Env } from './env.ts';
import { daily, hourly } from './jobs.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const ALNUM = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function rand(n: number, alphabet: string): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join('');
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const cleanCode = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Best-effort per-isolate cache (the Cache API does nothing on workers.dev).
const mem = new Map<string, { exp: number; data: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.exp > now) return hit.data as T;
  const data = await load();
  if (mem.size > 500) mem.clear();
  mem.set(key, { exp: now + ttl, data });
  return data;
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === 'object') return b as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, 'Bad request.');
}

interface User {
  id: string;
  nick: string;
  key_hash: string;
  total_h: number;
  exact_n: number;
  last_seen: number;
}

async function auth(req: Request, env: Env): Promise<User> {
  const m = /^Bearer ([A-Za-z0-9]{12})\.([A-Za-z0-9]{32})$/.exec(req.headers.get('authorization') ?? '');
  if (!m) throw new HttpError(401, 'Please sign in again.');
  const u = await env.DB.prepare('SELECT id, nick, key_hash, total_h, exact_n, last_seen FROM users WHERE id = ?1')
    .bind(m[1])
    .first<User>();
  if (!u || u.key_hash !== (await sha256(m[2]))) throw new HttpError(401, 'Please sign in again.');
  const now = Date.now();
  if (u.last_seen < now - DAY) await env.DB.prepare('UPDATE users SET last_seen = ?1 WHERE id = ?2').bind(now, u.id).run();
  return u;
}

const MATCH_COLS = `id, comp, kickoff, home, away, home_crest AS hc, away_crest AS ac, status, hg, ag,
  h1, hx, h2, h1x, hx2, h12, settled`;

async function createUser(env: Env, b: Record<string, unknown>) {
  const nick = String(b.nick ?? '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) throw new HttpError(400, 'Nickname: 3–16 letters, numbers or _.');
  const tier = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'tier'`).first<{ v: string }>();
  if (Number(tier?.v ?? 0) >= 3) throw new HttpError(503, 'New sign-ups are paused for today. Please try again tomorrow.');
  const id = rand(12, ALNUM);
  const key = rand(32, ALNUM);
  const recovery = rand(12, UPPER);
  const now = Date.now();
  try {
    await env.DB.prepare(
      'INSERT INTO users (id, nick, key_hash, recovery_hash, last_seen, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)',
    )
      .bind(id, nick, await sha256(key), await sha256(recovery), now)
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, 'That nickname is taken.');
    throw e;
  }
  return { id, key, nick, recovery: recovery.match(/.{4}/g)!.join('-') };
}

async function recover(env: Env, b: Record<string, unknown>) {
  const nick = String(b.nick ?? '').trim();
  const code = cleanCode(b.recovery);
  const u = await env.DB.prepare('SELECT id, nick, recovery_hash FROM users WHERE nick = ?1')
    .bind(nick)
    .first<{ id: string; nick: string; recovery_hash: string }>();
  if (!u || code.length !== 12 || u.recovery_hash !== (await sha256(code))) {
    throw new HttpError(403, 'Nickname or recovery code is wrong.');
  }
  const key = rand(32, ALNUM);
  await env.DB.prepare('UPDATE users SET key_hash = ?1, last_seen = ?2 WHERE id = ?3')
    .bind(await sha256(key), Date.now(), u.id)
    .run();
  return { id: u.id, key, nick: u.nick };
}

async function home(env: Env, me: User) {
  const now = Date.now();
  const bucket = Math.floor(now / 300_000);
  const matches = await cached(`matches:${bucket}`, 300_000, async () => {
    const t = bucket * 300_000;
    return (
      await env.DB.prepare(
        `SELECT ${MATCH_COLS.replace(/(^|,\s*)(\w+)/g, '$1m.$2')}, ts1.pos AS hpos, ts1.ppg AS hppg, ts2.pos AS apos, ts2.ppg AS appg
         FROM matches m
         LEFT JOIN team_stats ts1 ON ts1.comp = m.comp AND ts1.team = m.home
         LEFT JOIN team_stats ts2 ON ts2.comp = m.comp AND ts2.team = m.away
         WHERE m.kickoff >= ?1 AND m.kickoff < ?2 ORDER BY m.kickoff, m.comp, m.id`,
      )
        .bind(t - 2 * DAY, t + 8 * DAY)
        .all<{ id: number }>()
    ).results;
  });
  const picks = (
    await env.DB.prepare(
      `SELECT match_id AS m, pick, sh, sa FROM predictions WHERE user_id = ?1 AND match_id IN (SELECT value FROM json_each(?2))`,
    )
      .bind(me.id, JSON.stringify(matches.map((m) => m.id)))
      .all()
  ).results;
  return {
    now,
    me: { id: me.id, nick: me.nick, total: me.total_h, exact: me.exact_n },
    matches,
    picks,
    groups: await myGroups(env, me),
  };
}

async function myGroups(env: Env, me: User) {
  return (
    await env.DB.prepare(
      `SELECT g.id, g.name, g.code, (SELECT COUNT(*) FROM members x WHERE x.group_id = g.id) AS n
       FROM members mb JOIN groups g ON g.id = mb.group_id WHERE mb.user_id = ?1 ORDER BY g.name`,
    )
      .bind(me.id)
      .all()
  ).results;
}

async function savePicks(env: Env, me: User, b: Record<string, unknown>) {
  const list = Array.isArray(b.picks) ? b.picks : null;
  if (!list || list.length > 100) throw new HttpError(400, 'Bad request.');
  const seen = new Map<number, { m: number; pick: string; sh: number | null; sa: number | null }>();
  for (const raw of list) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const m = p.m;
    const sh = p.sh ?? null;
    const sa = p.sa ?? null;
    if (!Number.isInteger(m) || !isPick(p.pick) || (sh !== null && !isGoals(sh)) || (sa !== null && !isGoals(sa))) {
      throw new HttpError(400, 'Bad request.');
    }
    if (!validScore(p.pick, sh as number | null, sa as number | null)) {
      throw new HttpError(400, 'The exact score must match your pick.');
    }
    seen.set(m as number, { m: m as number, pick: p.pick, sh: sh as number | null, sa: sa as number | null });
  }
  const rows = [...seen.values()];
  // Only matches that have not started; at most 10 changes per prediction (PLAN §5).
  await env.DB.prepare(
    `INSERT INTO predictions (match_id, user_id, pick, sh, sa)
     SELECT m.id, ?1, json_extract(j.value, '$.pick'), json_extract(j.value, '$.sh'), json_extract(j.value, '$.sa')
     FROM json_each(?2) AS j JOIN matches AS m ON m.id = json_extract(j.value, '$.m')
     WHERE m.kickoff > ?3 AND m.status IN ('SCHEDULED', 'TIMED') AND m.settled = 0
     ON CONFLICT (match_id, user_id) DO UPDATE SET pick = excluded.pick, sh = excluded.sh, sa = excluded.sa,
       edits = predictions.edits + 1
     WHERE predictions.edits < 10 AND (predictions.pick IS NOT excluded.pick OR predictions.sh IS NOT excluded.sh
       OR predictions.sa IS NOT excluded.sa)`,
  )
    .bind(me.id, JSON.stringify(rows), Date.now())
    .run();
  const picks = (
    await env.DB.prepare(
      `SELECT match_id AS m, pick, sh, sa FROM predictions WHERE user_id = ?1 AND match_id IN (SELECT value FROM json_each(?2))`,
    )
      .bind(me.id, JSON.stringify(rows.map((r) => r.m)))
      .all()
  ).results;
  return { picks };
}

async function history(env: Env, me: User) {
  const now = Date.now();
  const rows = (
    await env.DB.prepare(
      `SELECT ${MATCH_COLS.replace(/(^|,\s*)(\w+)/g, '$1m.$2')}, p.pick, p.sh, p.sa
       FROM matches AS m JOIN predictions AS p ON p.match_id = m.id AND p.user_id = ?1
       WHERE m.kickoff >= ?2 AND m.kickoff < ?3 ORDER BY m.kickoff DESC`,
    )
      .bind(me.id, now - 30 * DAY, now)
      .all()
  ).results;
  return { rows };
}

async function deleteMe(env: Env, me: User) {
  const groups = (await myGroups(env, me)).map((g) => (g as { id: string }).id);
  const db = env.DB;
  await db.batch([
    db.prepare(`DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches) AND user_id = ?1`).bind(me.id),
    db.prepare(`DELETE FROM members WHERE user_id = ?1`).bind(me.id),
    db.prepare(`DELETE FROM daily_points WHERE user_id = ?1`).bind(me.id),
    db.prepare(`DELETE FROM users WHERE id = ?1`).bind(me.id),
    db
      .prepare(
        `DELETE FROM groups WHERE id IN (SELECT value FROM json_each(?1))
         AND NOT EXISTS (SELECT 1 FROM members WHERE group_id = groups.id)`,
      )
      .bind(JSON.stringify(groups)),
  ]);
  return { ok: true };
}

async function joinedCount(env: Env, me: User): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE user_id = ?1').bind(me.id).first<{ n: number }>();
  return r?.n ?? 0;
}

async function createGroup(env: Env, me: User, b: Record<string, unknown>) {
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 30) throw new HttpError(400, 'Group name: 1–30 characters.');
  const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM groups WHERE owner_id = ?1').bind(me.id).first<{ n: number }>();
  if ((owned?.n ?? 0) >= 10) throw new HttpError(400, 'You can create up to 10 groups.');
  if ((await joinedCount(env, me)) >= 30) throw new HttpError(400, 'You can be in up to 30 groups.');
  const id = rand(12, ALNUM);
  const now = Date.now();
  for (let attempt = 0; ; attempt++) {
    const code = rand(6, UPPER);
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO groups (id, name, code, owner_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(
          id,
          name,
          code,
          me.id,
          now,
        ),
        env.DB.prepare('INSERT INTO members (group_id, user_id, joined_at) VALUES (?1, ?2, ?3)').bind(id, me.id, now),
      ]);
      return { group: { id, name, code, n: 1 } };
    } catch (e) {
      if (attempt >= 2 || !/UNIQUE/i.test(String(e))) throw e;
    }
  }
}

async function joinGroup(env: Env, me: User, b: Record<string, unknown>) {
  const code = cleanCode(b.code);
  const g = await env.DB.prepare(
    `SELECT g.id, g.name, g.code, (SELECT COUNT(*) FROM members WHERE group_id = g.id) AS n,
       EXISTS (SELECT 1 FROM members WHERE group_id = g.id AND user_id = ?2) AS mine
     FROM groups AS g WHERE g.code = ?1`,
  )
    .bind(code, me.id)
    .first<{ id: string; name: string; code: string; n: number; mine: number }>();
  if (!g) throw new HttpError(404, 'No group with that code.');
  if (g.mine) return { group: { id: g.id, name: g.name, code: g.code, n: g.n } };
  if (g.n >= 50) throw new HttpError(400, 'This group is full (50 players).');
  if ((await joinedCount(env, me)) >= 30) throw new HttpError(400, 'You can be in up to 30 groups.');
  await env.DB.prepare('INSERT OR IGNORE INTO members (group_id, user_id, joined_at) VALUES (?1, ?2, ?3)')
    .bind(g.id, me.id, Date.now())
    .run();
  return { group: { id: g.id, name: g.name, code: g.code, n: g.n + 1 } };
}

async function leaveGroup(env: Env, me: User, id: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM members WHERE group_id = ?1 AND user_id = ?2').bind(id, me.id),
    env.DB.prepare('DELETE FROM groups WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM members WHERE group_id = ?1)').bind(id),
  ]);
  return { ok: true };
}

// One call per group screen: boards for all periods + everyone's picks on matches that have started.
async function group(env: Env, me: User, id: string) {
  const g = await env.DB.prepare(
    `SELECT g.id, g.name, g.code, (SELECT COUNT(*) FROM members WHERE group_id = g.id) AS n,
       EXISTS (SELECT 1 FROM members WHERE group_id = g.id AND user_id = ?2) AS mine,
       (SELECT v FROM meta WHERE k = 'settle_version') AS sv
     FROM groups AS g WHERE g.id = ?1`,
  )
    .bind(id, me.id)
    .first<{ id: string; name: string; code: string; n: number; mine: number; sv: string }>();
  if (!g || !g.mine) throw new HttpError(404, 'Group not found.');
  const bucket = Math.floor(Date.now() / 300_000);
  const data = await cached(`group:${id}:${g.n}:${g.sv}:${bucket}`, 300_000, async () => {
    const now = bucket * 300_000;
    const board = (
      await env.DB.prepare(
        `SELECT u.id, u.nick, u.total_h AS total, u.exact_n AS exact,
           COALESCE((SELECT SUM(h) FROM daily_points WHERE user_id = u.id AND day >= ?2), 0) AS week,
           COALESCE((SELECT SUM(h) FROM daily_points WHERE user_id = u.id AND day >= ?3), 0) AS month
         FROM members AS mb JOIN users AS u ON u.id = mb.user_id WHERE mb.group_id = ?1`,
      )
        .bind(id, weekStart(now), monthStart(now))
        .all()
    ).results;
    const reveal = (
      await env.DB.prepare(
        `SELECT p.match_id AS m, u.nick, p.pick, p.sh, p.sa
         FROM members AS mb JOIN users AS u ON u.id = mb.user_id
         JOIN predictions AS p ON p.user_id = mb.user_id
           AND p.match_id IN (SELECT id FROM matches WHERE kickoff <= ?2 AND kickoff >= ?3)
         WHERE mb.group_id = ?1`,
      )
        .bind(id, Date.now(), Date.now() - 2 * DAY)
        .all()
    ).results;
    return { board, reveal };
  });
  return { group: { id: g.id, name: g.name, code: g.code, n: g.n }, ...data };
}

async function status(env: Env) {
  const rows = (await env.DB.prepare('SELECT k, v FROM meta').all<{ k: string; v: string }>()).results;
  return { ok: true, ...Object.fromEntries(rows.map((r) => [r.k, r.v])) };
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  if (method === 'GET' && (path === '/' || path === '/v1/status')) return json(await status(env));
  if (method === 'POST' && path === '/v1/users') return json(await createUser(env, await body(req)));
  if (method === 'POST' && path === '/v1/recover') return json(await recover(env, await body(req)));

  const me = await auth(req, env);
  if (method === 'GET' && path === '/v1/home') return json(await home(env, me));
  if (method === 'PUT' && path === '/v1/predictions') return json(await savePicks(env, me, await body(req)));
  if (method === 'GET' && path === '/v1/history') return json(await history(env, me));
  if (method === 'DELETE' && path === '/v1/me') return json(await deleteMe(env, me));
  if (method === 'POST' && path === '/v1/groups') return json(await createGroup(env, me, await body(req)));
  if (method === 'POST' && path === '/v1/groups/join') return json(await joinGroup(env, me, await body(req)));
  const g = /^\/v1\/groups\/([A-Za-z0-9]{12})(\/me)?$/.exec(path);
  if (g && method === 'GET' && !g[2]) return json(await group(env, me, g[1]));
  if (g && method === 'DELETE' && g[2]) return json(await leaveGroup(env, me, g[1]));
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(req, env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      console.log('error', msg);
      if (/limit|exceeded|quota/i.test(msg)) {
        return json({ error: 'Daily limit reached. Please try again in a few hours.', limit: true }, 503);
      }
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(event.cron === '40 3 * * *' ? daily(env) : hourly(env));
  },
} satisfies ExportedHandler<Env>;
