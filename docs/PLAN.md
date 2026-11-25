# Called It! — Build Plan

**Status: FROZEN v1.1 — 2026-10-25.** Changes only through the decision log at the bottom.

A free football prediction game for groups of friends. Pick 1 / X / 2 / 1X / X2 / 12 on today's
and upcoming matches, optionally call the exact score, beat your friends on the group table.
No money, no prizes, no odds. English, for football fans worldwide.

## Status table

Every session reads `CLAUDE.md`, then this table, and works on the first task that is not done.

**The app is not published yet** (owner, 2026-11-16): only test builds exist, not on the Play Store. Every user
will be new at the Play release, so nothing needs to stay compatible with older app versions.

| # | Task | Effort | Status |
|---|---|---|---|
| 1 | Scoring + tests (`shared/scoring.ts`) | high | ✅ done |
| 2 | Worker API, jobs, D1 tables (database `called-it` created) | high | ✅ done |
| 3 | Web app (Matches, Groups, Me) | medium | ✅ done |
| 4 | Android project (KAJ wrapper + AdMob + OneSignal), workflows | medium | ✅ done |
| 5 | Working rules (`CLAUDE.md`), Android signing as in KAJ | low | ✅ done (pull request) |
| 6 | Owner setup, one step at a time: GitHub secrets, Pages, merge, `API_BASE` | low | ✅ done |
| 7 | First live import checked; web version checked | medium | ✅ done (owner) |
| 7b | Match filter (competition, team search) + league position line | medium | ✅ done (pull request) |
| 8 | Owner's phone test (APK from GitHub Actions) | medium | ✅ done (owner) |
| 9 | Signed AAB in Android Studio, Play Console, closed test | medium | in progress: app `com.connectal.calledit` created, store listing and app content filled in, 1.1.0 / code 2 sent for review, **1.2.0 / code 3 submitted**; AdMob linked to Play; `app-ads.txt` checked. Testers step skipped by the owner. Next: football-data.org check (§10 item 9) before production |
| 10A | Settings tab (gear): menu moved from Me; Match reminders On/Off switch (permission asked at first open), © Connect AL in About | medium | ✅ done (pull request) |
| 10C | Groups: one competition per group, rounds end with the season or when the admin concludes, podium | high | ✅ done (pull request; owner runs `worker/migrations/2026-11-16-task-10c.sql` before the merge) |
| 10B | Me: statistics and charts | medium | ✅ done (pull request) |
| 10D | Team crests on matches, competition emblems | medium | ✅ done (pull request) |

---

## 1. Fixed decisions

| Topic | Decision |
|---|---|
| Name | **Called It!** · repo `AlbMarketsAutoPilot-lab/cit` (public, needed for free GitHub Pages) · Android id `com.connectal.calledit` (Play id; the Java code package stays `com.calledit.app`) |
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
team_stats   (comp TEXT, team TEXT, pos INT, ppg REAL, PRIMARY KEY (comp, team)) WITHOUT ROWID
                                         -- league position + points per game, daily job (≈ 300 rows)
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
| `GET /stats` | Me statistics (10B): hit rate, results, pick types, streak (stored picks); points per month, per competition this season (400-day totals). Read-only |
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
   Filter by competition (chips) and **Search team** (all days). Under each team: "3rd · 2.1 pts/game"
   from the league table (free tier; no odds, no news — owner decision 2026-10-25).
3. **Groups** — my groups; create; join by code; **Invite** opens Android share sheet / Web Share.
4. **Group** — board (Week / Month / All time); per match after kickoff: how everyone picked (reveal).
5. **Me** — history with points, total, recovery code, delete account, About (data: football-data.org).

Language: English (worldwide audience). Team names as football-data.org gives them; team crests and competition emblems
from football-data.org (owner decision 2026-11-16, replaces "no club crests").

**Push (OneSignal):** the daily job sends one reminder on days with matches, delivered at 11:00 in each
user's own time zone. The app links the device to the user id (`OneSignal.login`) for targeted pushes later.

**Ads (AdMob):** one adaptive banner above the app (not next to the tab bar, to avoid accidental taps).
Google UMP consent form for EEA/UK; "Ad privacy settings" in Me when required. Web version has no ads.

**Not in MVP (v1.1, in this order):** results push ("your points are in") · banker (one ×2 match per day) ·
shareable daily recap image · per-group competition filter · streaks.

### v1.2 approved details (owner, 2026-11-16)

Everything the owner approved for tasks 10A–10D. A new session needs nothing else.

**10A Settings (done, pull request #5).** A gear icon after Matches · Groups · Me opens Settings: Match reminders,
Recovery code, How points work, Ad privacy settings (only when required), Privacy policy, About, Delete account.
Match reminders is an On/Off switch (OneSignal opt-in / opt-out). Android asks for notification permission once,
at the first app open; allowing it turns the switch on; the user can turn it off later in Settings.
About ends with "© 2026 Connect AL. All rights reserved."

**10B Me: statistics and charts.** Me shows how the user is doing, with clear, good-looking graphics:
1. **Hit rate ring:** % of picks right.
2. **Points over time:** a line of points per day or week.
3. **Results bar:** exact / right / wrong.
4. **By pick type:** hit rate for 1, X, 2, 1X, X2, 12.
5. **By competition:** points and hit rate per competition.
6. **Streaks:** current and best run of right picks.
7. **Underdog calls:** right picks worth 3 points or more.
8. **My groups:** the user's rank in each group.

Charts are drawn by the page itself (SVG, no chart library), so the app stays small and the cost stays €0.
Before building, check which items the stored data supports for how long: predictions and matches are deleted
after 60 days (fewer at higher cleanup tiers, §6); `daily_points` and `comp_points` keep 400 days. Propose what
each chart covers (for example "last 60 days") to the owner.

**10B as built (owner approved 2026-11-17; item 8 "My groups" dropped).** One read-only call `GET /v1/stats`
when Me opens (`shared/stats.ts`, `worker/src/index.ts` `stats`). Me shows:
- Tiles: points, exact scores, **right in a row** (current streak, from the stored picks).
- **Hit rate ring:** last 30 days, with the change vs the 30 days before.
- **Results bar:** exact / right / wrong, last 30 days and the 30 days before.
- **Best pick types:** hit rate for 1, X, 2, 1X, X2, 12 over the last 60 days.
- **Points per month:** last 12 months, best month in gold (`daily_points`).
- **By competition:** points this season (`comp_points`, season dates from `seasons`; no stored season: last 365 days).
- The 30-day pick list stays below.
Periods follow the cleanup tier: picks kept 60/30/14/7 days → comparison periods of 30/15/7/3 days, labels show
the real number of days. Rolling periods, not calendar months (a calendar "last month" can reach past 60 days).
Cost at 1,000 players: 0 rows written, ≈ +0.8 M rows read/day (estimate from the queries), no schema change.

**10C Groups (done, pull request #6):** see the decision log (2026-11-17) and §4, §5.

**10D Team and competition icons.** Team crests on the match cards and competition emblems on the competition
filter and group headers, from football-data.org (the owner checked Play; replaces "no club crests").
Cost check (2026-11-16): €0 for Cloudflare, because the crest links are already stored in `matches`
(`home_crest`, `away_crest`) and phones load the images straight from football-data.org; 9–32 KB per crest
(measured), cached by the phone after the first view. Competition emblem links are not stored yet.

**10D as built (owner approved 2026-11-17).**
- **Where:** a 20 px team crest beside each team name on the match cards; an 18 px competition emblem on the
  competition chips (not on "All"), on the competition headings of the match list, in the My groups list and on
  the Group screen's competition line.
- **Emblem links:** taken from `competition.emblem` of the matches the daily import already fetches (the
  `crests.football-data.org/<code>.png` pattern fails for DED, BSA, WC, EC). Stored in one `meta` row
  (`k = 'emblems'`, JSON competition code → link), merged and written only when a link changes
  (`shared/icons.ts` `EMBLEMS_SQL`). `/home` returns `emblems`, inside the 5-minute cache. No schema change.
- **Missing or failed image:** only plain `https://` links are used. No link or a failed load: a crest leaves an
  empty slot (names stay aligned), an emblem is left out. Names are always shown.
- **Look:** emblems sit on a small white rounded tile and crests have a faint light outline, so dark logos
  (e.g. the Premier League emblem) stay visible on the dark background.
- **Privacy policy:** "Team crests and competition emblems load from football-data.org, which sees your device's
  IP address when they load." (Proxying the images through the Worker would use up the 100,000 requests/day.)
- **Cost at 1,000 players:** usually 0 rows written a day (≤ 1 when an emblem changes); +1 row read per cache
  refill; 0 extra Worker requests; 0 extra football-data.org API calls (images need no key); €0.
- Emblems appear after the first daily import that follows the deploy. Android needs no change.

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
8. ✅ AdMob: app + banner ad unit; `app-ads.txt` on the developer website listed in Play (`https://connect.al/app-ads.txt`, checked 2026-11-25).
9. Before launch: confirm with football-data.org that a free public app is fine.

---

## 11. Decision log

| Date | Decision |
|---|---|
| 2026-10-25 | Plan frozen as v1.0 (name, stack, rules, limits, cleanup tiers). |
| 2026-10-25 | Owner approved: app ID `com.calledit.app`, upright only, Android 8.0+, ad banner on top, no club crests, reminder 11:00 local, nicknames 3–16 letters/numbers/_, groups ≤ 50 players and ≤ 30 per player, the icon (`docs/store/`). Database `called-it` and branch kept. `CLAUDE.md` rules. Android as in KAJ: signing in Android Studio, no secrets for it on GitHub, Gradle 8.11.1. |
| 2026-10-25 | v1.1 (owner): English only, worldwide; add OneSignal push and AdMob ads; repo is `cit`. Build: predictions keyed (match, user); one group call; memory cache; tier 3 simplified; no crests. |
| 2026-10-25 | Task 6 (owner): `API_BASE` = `https://called-it.lodovikmirdita.workers.dev`, set before the merge. Real AdMob IDs also in test builds (never tap own ads). Local release build reads `ADMOB_APP_ID`, `ADMOB_BANNER_ID`, `ONESIGNAL_APP_ID` from git-ignored `android/local.properties`; `npm run android:assets` uses the live Worker. |
| 2026-10-25 | Task 7 (owner): first import and web version checked by the owner. 7b approved: competition filter, team search, "3rd · 2.1 pts/game" from the daily standings (`team_stats`; daily job fetches up to 8 tables: competitions with new matches first). No betting odds (paid add-on, ties the app to betting) and no news feed (licence risk with ads). |
| 2026-11-16 | Owner approved v1.2: Settings tab (gear) with a working Match reminders switch (10A); groups for one competition or all, only that competition's picks count, optional end date, admin concludes, podium (10C); Me statistics and charts (10B); team crests and competition emblems (10D): **replaces the 2026-10-25 "no club crests" decision**, owner checked Play. Order A → C → B → D. |
| 2026-11-16 | Owner: the app is not published yet (test builds only). Notification permission is asked at the first app open; allowing it turns Match reminders on, and the switch in Settings turns it off. About: © 2026 Connect AL. |
| 2026-11-17 | Task 10C (owner approved 2026-11-16): every group is for **one competition** (no "all competitions" groups). A round's table counts only that competition's points, from the **day after** the round starts or the member joins (whichever is later), so nobody brings earlier points; the end is the same for all. Rounds end by themselves when the season is over (football-data.org season end date, all its matches settled) or earlier when the admin taps Conclude; final table frozen, podium shown; the admin starts a new round (same members and competition). If the admin leaves, the member who joined first becomes admin. Points per user, competition and day (`comp_points`) written at settlement, kept 400 days. Test groups deleted by a one-time script (`worker/migrations/2026-11-16-task-10c.sql`). |
| 2026-11-17 | Owner moved the Worker and the D1 database `called-it` to a new Cloudflare account (export, import, new database id `cc73a259-f281-4c99-814c-9a194ef3e029`); the old Worker and database were deleted from the old account. GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are the new account's. New Worker address: `https://called-it.morenmirdita.workers.dev` (`API_BASE`, `LIVE_API`); replaces the 2026-10-25 `API_BASE` entry. |
| 2026-11-17 | Task 10B (owner approved): Me statistics as listed in §7 "10B as built": streak tile, hit rate ring, results bar, pick types (stored picks, 60 days at tier 0) and points per month, points per competition this season (400-day totals). Read-only, no schema or settlement change, 60-day pick cleanup unchanged. Not chosen: keeping picks 400 days (≈ 3–5 M reads/day at 1,000 players, lost again when the cleanup tiers start) and per-season counters. Item 8 (rank in my groups) dropped by the owner. No player cap added: the free plan stops at its limits (no bill), existing hard stops stay (§5, §6). |
| 2026-11-17 | Task 10D (owner approved): team crests on match cards; competition emblems on the competition chips, match list headings, My groups list and Group screen, as in §7 "10D as built". Emblem links from the daily import's matches, stored in one `meta` row (no schema change); phones load images straight from football-data.org (€0). Missing or failed images: empty crest slot, emblem left out. White tile behind emblems and light outline on crests (owner approved). Privacy policy now says football-data.org sees the device's IP address when images load. |
| 2026-11-17 | Owner approved the task 9 session prompt `docs/prompts/Task9_play_release.md`: signed AAB in Android Studio (as KAJ, no secrets on GitHub), Play Console app, store listing texts, app content (privacy, app access, ads, IARC age rating, target audience 13+, Data safety, gambling questions: free game, no money, prizes or odds), closed test (12 testers / 14 days), AdMob link and `app-ads.txt`, football-data.org check before production. Texts and answers shown to the owner for approval before pasting. |
| 2026-11-17 | Task 9 (owner approved): Play Console said the package name `com.calledit.app` is already in use by another developer (Android developer verification registers package names; no public Play page, 404 checked). The owner has no other Play account. New Play id **`com.connectal.calledit`** (Connect AL; no Play page, 404 checked): `applicationId` in `android/app/build.gradle.kts` and the Play link in `web/src/main.ts`. The Java code package and `namespace` stay `com.calledit.app` (no code move). Replaces the 2026-10-25 app ID decision. Test builds install as a new app: uninstall the old one once. |
| 2026-11-17 | Task 9 (owner approved): Play Console's trader section requires a terms of service link. New page `public/terms.html`, live at `https://albmarketsautopilot-lab.github.io/cit/terms.html` (copied to `dist/` by `scripts/build-web.ts`, published by `pages.yml`): free game by Connect AL, no money, betting, prizes or odds; nickname and group name rules (offensive, impersonating or illegal names may be removed with their accounts); fair play; match data from football-data.org may be late or wrong; AdMob ads; no warranty; delete account in Settings; accounts unused for 12 months deleted; link to the privacy policy; contact `info@connect.al`. Privacy policy and delete-account page: "Me →" corrected to "Settings (gear) →" (moved in 10A); privacy contact now `info@connect.al` (plus GitHub issues); privacy "Last updated" 17 November 2026. The app shows the privacy text inside the page, so the release AAB needs `npm run android:assets` after this merge. |
| 2026-11-17 | Task 9 (owner approved): Play warned that `android.hardware.screen.portrait` (implied by `screenOrientation="portrait"`) is a required hardware feature that excludes some tablets, Chromebooks, PC and XR devices. `AndroidManifest.xml` now declares it with `android:required="false"`; the app stays upright only on phones (PLAN §1 unchanged; Android 16 ignores the lock on large screens). Version **1.2.0 / code 3** (codes 1 and 2 already used on Play). |
| 2026-11-17 | Task 9 Play Console (owner approved, filled in by the owner): **App** "Called It!", game, free, English (United States), `com.connectal.calledit`. **Store listing:** category Sports; short description, full description and release notes as in `docs/store/listing.md`; privacy policy `https://albmarketsautopilot-lab.github.io/cit/privacy.html`; contact `info@connect.al`. **App access:** restricted (sign-in), instructions in `docs/store/listing.md` (nickname only, no credentials). **Ads:** yes (AdMob). **Content rating (IARC):** Game; violence, fear, sexuality, language, controlled substances, crude humour, digital purchases: No; **gambling: No** (free picks, nothing staked or won, no odds shown); users interact: Yes (nicknames, group names), shares location: No, other miscellaneous: No; block/report/chat moderation: No; interactions limited to invited friends: Yes. Result: 3+, PEGI 3, ESRB Everyone, USK all ages (IGRS Indonesia 13+). **Target audience:** 13–15, 16–17, 18+ (no under-13). **Data safety:** collects data: yes; encrypted in transit: yes; account creation "Other" (nickname + device key + recovery code); deletion link `https://albmarketsautopilot-lab.github.io/cit/delete-account.html`; partial deletion: no. Data types: User IDs collected only (app functionality, account management); approximate location, crash logs, diagnostics, app interactions and device or other IDs collected and shared (AdMob: analytics, advertising, fraud prevention; app interactions and device IDs also collected for app functionality via OneSignal); other user-generated content collected only (app functionality); none ephemeral, all required. Advertising ID: yes. Financial features: none. **Trader status:** applies (yes); terms of service `https://albmarketsautopilot-lab.github.io/cit/terms.html`. **Releases:** code 1 used earlier; **1.1.0 / code 2** sent for review (built on the owner's PC with the version changed locally, not in the repo; Play's portrait-feature warning: "Proceed anyway"); next 1.2.0 / code 3 from the repo. |
| 2026-11-25 | Task 9 (owner approved): developer website in Play is `connect.al`; `https://connect.al/app-ads.txt` already has `google.com, pub-2373589608434861, DIRECT, f08c47fec0942fa0` (checked 2026-11-25), the same AdMob publisher id as Called It!'s `ADMOB_APP_ID`, so no website change. The owner linked the AdMob app to Play (`com.connectal.calledit`) and submitted 1.2.0 / code 3. The closed test testers step was skipped by the owner. Code 1's exact build is not recorded; code 2 was built after pull request 14 (privacy text in the app), code 3 adds only the portrait-not-required manifest line. |
