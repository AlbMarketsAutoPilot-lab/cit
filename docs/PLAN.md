# Called It! — Build Plan

**Status: FROZEN v1.1 — 2026-10-25.** Changes only through the decision log at the bottom.

A free football prediction game for groups of friends. Pick 1 / X / 2 / 1X / X2 / 12 on today's
and upcoming matches, optionally call the exact score, beat your friends on the group table.
No money, no prizes, no odds. English, for football fans worldwide.

## Status table

Every session reads `CLAUDE.md`, then this table, and works on the first task that is not done.

| # | Task | Effort | Status |
|---|---|---|---|
| 1 | Scoring + tests (`shared/scoring.ts`) | high | ✅ done |
| 2 | Worker API, jobs, D1 tables (database `called-it` created) | high | ✅ done |
| 3 | Web app (Matches, Groups, Me) | medium | ✅ done |
| 4 | Android project (KAJ wrapper + AdMob + OneSignal), workflows | medium | ✅ done |
| 5 | Working rules (`CLAUDE.md`), Android signing as in KAJ | low | ✅ done (pull request) |
| 6 | Owner setup, one step at a time: GitHub secrets, Pages, merge, `API_BASE` | low | next |
| 7 | First live import checked; web version checked | medium | — |
| 8 | Owner's phone test (APK from GitHub Actions) | medium | — |
| 9 | Signed AAB in Android Studio, Play Console, closed test | medium | — |

---

## 1. Fixed decisions

| Topic | Decision |
|---|---|
| Name | **Called It!** · repo `AlbMarketsAutoPilot-lab/cit` (public, needed for free GitHub Pages) · Android id `com.calledit.app` |
| Match data | football-data.org v4, free tier (12 competitions, 10 calls/min). Key lives only in Cloudflare secrets. |
| Backend | One Cloudflare Worker (API + 2 cron jobs) + one D1 database. Free plan only, no card on file. |
| App | One web page (TypeScript → single `called-it.html`) |
| Android | Same WebView wrapper as `kaj-game` + `INTERNET` + share bridge + **AdMob** banner (top, with Google UMP consent) + **OneSignal** push. Upright only, Android 8.0+. Release AAB ≈ 6 MB (the ad and push SDKs are most of it). The owner builds and signs the release in Android Studio (as KAJ); GitHub Actions builds only the test APK. |
| Web | Same page on GitHub Pages, so iPhone friends can play in the browser |
| Accounts | Nickname + secret device key + recovery code. No email, no Google sign-in, no third-party auth. |
| Third parties | GitHub, Cloudflare, football-data.org, Google AdMob (ads), OneSignal (push). Nothing else. |
| Cost | €0. Cloudflare's free plan **fails instead of billing**, so the risk is downtime, never a bill. OneSignal mobile push is free. |

Competitions: `CL PL ELC PD SA BL1 FL1 DED PPL BSA WC EC`.

---

## 2. Game rules (frozen)

**Picks.** One prediction per user per match, shared by all their groups (no hedging across groups).
Editable until kickoff, then locked by the server.

**Value points.** Each match shows its points on the buttons before anyone picks.

```
points(pick) = 2 / (3 × p)      p = model probability that the pick wins (double = sum of its two outcomes)
round to nearest 0.5 · singles clamped to 1–5 · doubles clamped to 0.5–2.5
```
Even match (⅓ each) → singles 2, doubles 1. Every pick has the same expected value (≈0.67), so skill =
reading the match better than the model.

**Probability model** (computed once at import, stored on the match):
```
base: p1 = 0.45, pX = 0.26, p2 = 0.29
d  = (ppg_home − ppg_away) / 3          ppg = points per game, TOTAL table of that competition
     use d = 0 if either team has played < 5 games or there is no table (cups, early season)
p1 = 0.45 + 0.30·d
pX = 0.26 − 0.10·|d|
p2 = 1 − p1 − pX
clamp each to ≥ 0.08, then renormalise to sum 1
```

**Exact score.** Optional. Must agree with the pick (pick `1` → home must win; pick `1X` → home win or
draw). Correct exact score = **+3 bonus** on top of the pick points.

**Result used.** Regular time only (90' + stoppage): `score.regularTime` if present, else `score.fullTime`.
Only `FINISHED` matches score. Anything else stays pending; pending > 7 days after kickoff → void (0, not
counted).

**Storage of points.** Integers in **half-points** (`3.5 pts` stored as `7`) to avoid float errors.

**Days and weeks.** Stored by UTC date of kickoff; week = Mon–Sun UTC. The app shows local times.

---

## 3. Data flow

```
              ┌──────────── daily 03:40 UTC ────────────┐
football-data │ 1 call: matches today..+7 days          │
   .org  ◄────┤ ≤ 8 calls: standings (comps with games) │──► D1: matches (+ points per pick)
              │ cleanup + size check (§6)               │
              └─────────────────────────────────────────┘
              ┌──────────── hourly :15 ─────────────────┐
              │ 1 call: matches yesterday..today        │──► D1: status/score, settle ≤ 20 matches/run
              └─────────────────────────────────────────┘
phone / browser ──► Worker API (cached) ──► D1
```

Both jobs are idempotent: running twice changes nothing. A failed run is simply redone next time.

---

## 4. Database (D1 / SQLite)

```sql
users        (id TEXT PK, nick TEXT UNIQUE NOCASE, key_hash TEXT, recovery_hash TEXT,
              total_h INT DEFAULT 0, exact_n INT DEFAULT 0, last_seen INT, created_at INT)
matches      (id INT PK, comp TEXT, kickoff INT, home TEXT, away TEXT, home_crest TEXT, away_crest TEXT,
              status TEXT, hg INT, ag INT,
              h1 INT, hx INT, h2 INT, h1x INT, hx2 INT, h12 INT,   -- points in halves
              settled INT DEFAULT 0)
predictions  (match_id INT, user_id TEXT, pick TEXT, sh INT, sa INT, edits INT DEFAULT 0,
              PRIMARY KEY (match_id, user_id)) WITHOUT ROWID   -- match first: settlement + reveal read ranges
groups       (id TEXT PK, name TEXT, code TEXT UNIQUE, owner_id TEXT, created_at INT)
members      (group_id TEXT, user_id TEXT, joined_at INT, PRIMARY KEY (group_id, user_id)) WITHOUT ROWID
daily_points (user_id TEXT, day TEXT, h INT, exact INT, PRIMARY KEY (user_id, day)) WITHOUT ROWID
meta         (k TEXT PK, v TEXT)        -- settle_version, tier, db_size, last_import
```
Indexes (only these, every index costs writes): `matches(kickoff)`, `members(user_id, group_id)`.

**Points are not written per prediction.** A prediction's points are computed on read from the match
result. Settlement only writes `daily_points` (one row per user per day) and `users.total_h`. This is the
single biggest write saving.

**Settlement** (one atomic D1 batch per run): read predictions of newly finished matches → sum per
user/day → upsert `daily_points`, add to `users.total_h`, set `matches.settled = 1`, bump `settle_version`.

---

## 5. API (Worker, `/v1`)

| Call | Purpose |
|---|---|
| `POST /users {nick}` | create account → `{id, key, recovery}` (recovery shown once) |
| `POST /recover {nick, recovery}` | new key on a new phone |
| `DELETE /me` | delete account and all its data (Play requirement) |
| `GET /home` | **one call on app open**: me, matches today..+7, my picks, my groups |
| `PUT /predictions [{match, pick, sh, sa}]` | save many picks in one request; rejected after kickoff |
| `GET /history?from&to` | my settled picks with points |
| `POST /groups {name}` · `POST /groups/join {code}` · `DELETE /groups/:id/me` | groups |
| `GET /groups/:id` | one call: week, month and all-time board + everyone's picks on matches that **already started** (the reveal) |

Auth header: `Authorization: Bearer <id>.<key>`; server stores only SHA-256 hashes.
CORS is open (`*`): auth is a bearer key and there are no cookies, so an origin check would add nothing.

**Caching (in the Worker's memory; the Cache API does nothing on workers.dev):** match list 5 min; group
screen 5 min, keyed by `settle_version` and member count. All-time board reads `users.total_h`.

**Abuse caps:** nick 3–16 chars; ≤ 10 edits per prediction; ≤ 10 groups owned, ≤ 30 joined per user;
≤ 50 members per group. On a D1 quota error the API answers `503 {"limit":true}` and the app shows
"Daily limit reached — try again after 01:00/02:00" instead of crashing.

---

## 6. Staying at €0: limits, budget, cleanup

### Free limits that matter
| Limit | Free plan | Our use at **1,000 daily players** | Room |
|---|---|---|---|
| Worker requests | 100,000 / day | ≈ 25,000 (1 `/home` per open, batched picks) | ~4,000 players |
| D1 rows written | 100,000 / day | ≈ 35,000 | ~2,500 players |
| D1 rows read | 5,000,000 / day | ≈ 1,300,000 (with caching) | ~3,500 players |
| D1 database size | **500 MB** per database (5 GB per account) | see below | — |
| Cron triggers | a few per account | 2 | ok |
| football-data.org | 10 calls / min | ≤ 9 in the daily run, 1 hourly | ok |

Static files (the app itself) never touch the Worker: they come from the APK or GitHub Pages.

### Size estimate
Predictions are the only table that grows fast (~100 bytes/row with key).
1,000 players × 30 picks/week ≈ 1.5 M rows/year ≈ 150 MB/year if kept forever → **we don't keep them**.

### Cleanup — runs every day in the 03:40 job
**Normal retention (Tier 0):**
1. Delete predictions and matches whose kickoff is older than **60 days** (their points already live in
   `daily_points` and `users.total_h`, so tables and history totals stay correct).
2. Delete `daily_points` older than **400 days** (all-time total is already in `users.total_h`).
3. Delete users not seen for **365 days** (with memberships); delete groups with no members.
4. Void pending matches older than 7 days.

Expected steady size at 1,000 players: **≈ 30–40 MB**. That is >10× below the 500 MB wall.

### Tiers — chosen automatically by the daily job from the measured size (`meta.size_after` of D1)
| Tier | Trigger | Action |
|---|---|---|
| 0 | < 250 MB | normal retention above |
| 1 | ≥ 250 MB | predictions/matches kept **30 days** |
| 2 | ≥ 350 MB | predictions/matches kept **14 days**; users inactive **180 days** deleted |
| 3 | ≥ 450 MB | predictions/matches kept **7 days**; new sign-ups paused. If ever reached: move old `daily_points` to a 2nd D1 database (free plan allows 10) by hand. |

The current tier and size are stored in `meta` and shown on a hidden `/v1/status` page.
Daily read/write limits are covered by the caching, batching and caps above; if they are still hit, the
app degrades gracefully (§5) and the hourly settle simply catches up after midnight UTC.
Safety net: D1 Time Travel (free, last 7 days) can restore the database to any minute.

---

## 7. App screens (MVP)

1. **Welcome** — choose nickname → shows recovery code once ("save this").
2. **Matches** — tabs Today / Tomorrow / Week; grouped by competition; each match: six pick buttons with
   their points, optional score field, lock icon at kickoff. One **Save picks** button.
3. **Groups** — my groups; create; join by code; **Invite** opens Android share sheet / Web Share.
4. **Group** — board (Week / Month / All time); per match after kickoff: how everyone picked (reveal).
5. **Me** — history with points, total, recovery code, delete account, About (data: football-data.org).

Language: English (worldwide audience). Team names as football-data.org gives them; no club crests
(trademark risk on Play).

**Push (OneSignal):** the daily job sends one reminder on days with matches, delivered at 11:00 in each
user's own time zone. The app links the device to the user id (`OneSignal.login`) for targeted pushes later.

**Ads (AdMob):** one adaptive banner above the app (not next to the tab bar, to avoid accidental taps).
Google UMP consent form for EEA/UK; "Ad privacy settings" in Me when required. Web version has no ads.

**Not in MVP (v1.1, in this order):** results push ("your points are in") · banker (one ×2 match per day) ·
shareable daily recap image · per-group competition filter · streaks.

---

## 8. Repository layout

```
cit/
  docs/PLAN.md                 this file
  shared/scoring.ts            model + points + settlement maths (used by worker and web)
  tests/*.test.ts              node --test
  worker/src/index.ts          API + cron handlers
  worker/schema.sql
  worker/wrangler.toml         D1 binding, 2 crons
  web/index.html, web/src/*.ts, web/style.css
  scripts/build-web.ts         esbuild → dist/called-it.html (single file)
  android/                     kaj-game wrapper + share/push/consent bridge, AdMob, OneSignal
  public/privacy.html, public/delete-account.html
  .github/workflows/ci.yml     typecheck + tests on every push
  .github/workflows/android.yml   APK/AAB
  .github/workflows/pages.yml     web app + privacy pages
  .github/workflows/worker.yml    wrangler deploy (main only)
```
Dev dependencies only: `typescript`, `esbuild`, `wrangler`, `@cloudflare/workers-types`. No frameworks.

---

## 9. Build order

| # | Step | Done when |
|---|---|---|
| 1 | `shared/scoring.ts` + tests | model, points table, exact-score check, settlement totals all tested |
| 2 | D1 schema + Worker API + crons | runs locally with `wrangler dev`, cron tested with `--test-scheduled` |
| 3 | Web app (5 screens) | full flow works in a browser against local Worker |
| 4 | Android wrapper + workflows | CI builds APK; app runs on a phone |
| 5 | Deploy | D1 created, secrets set, first import shows real matches |
| 6 | Play Store | privacy + delete pages live, Data safety filled, closed test started (12 testers / 14 days) |

---

## 10. Owner checklist

1. ✅ Public repo `AlbMarketsAutoPilot-lab/cit`.
2. Get a football-data.org API key.
3. Cloudflare: create an API token (Workers Scripts: Edit, D1: Edit) and note the Account ID.
   D1 database `called-it` already exists (id in `worker/wrangler.toml`) with its tables.
4. GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FOOTBALL_DATA_KEY`,
   `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`, `ADMOB_APP_ID`, `ADMOB_BANNER_ID`. No signing key on GitHub.
5. GitHub variable `API_BASE` = the Worker address printed by the first Worker deploy
   (`https://called-it.<your-subdomain>.workers.dev`).
6. Enable GitHub Pages (source: GitHub Actions).
7. OneSignal: Android (FCM) platform configured in the OneSignal dashboard.
8. AdMob: app + banner ad unit; host `app-ads.txt` on the developer website listed in Play.
9. Before launch: confirm with football-data.org that a free public app is fine.

---

## 11. Decision log

| Date | Decision |
|---|---|
| 2026-10-25 | Plan frozen as v1.0 (name, stack, rules, limits, cleanup tiers). |
| 2026-10-25 | Owner approved: app ID `com.calledit.app`, upright only, Android 8.0+, ad banner on top, no club crests, reminder 11:00 local, nicknames 3–16 letters/numbers/_, groups ≤ 50 players and ≤ 30 per player, the icon (`docs/store/`). Database `called-it` and branch kept. `CLAUDE.md` rules. Android as in KAJ: signing in Android Studio, no secrets for it on GitHub, Gradle 8.11.1. |
| 2026-10-25 | v1.1 (owner): English only, worldwide; add OneSignal push and AdMob ads; repo is `cit`. Build: predictions keyed (match, user); one group call; memory cache; tier 3 simplified; no crests. |
