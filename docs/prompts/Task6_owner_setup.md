# Task 6: owner setup (prepared 2026-10-25, owner-approved)

> Paste into a new Claude Code session: **"Do task 6 using docs/prompts/Task6_owner_setup.md"**.

Do task 6 of docs/PLAN.md (owner setup) in the repo AlbMarketsAutoPilot-lab/cit, branch claude/funny-fermat-ab8ejx.

## Read first (strict)
1. CLAUDE.md: the working rules. Follow them exactly: one step at a time, wait for "done";
   nothing without my "approved"; short plain answers, one recommendation; verify, never guess.
2. docs/PLAN.md: the status table, §10 owner checklist, decision log.
3. README.md and .github/workflows/*.yml: which secrets and variable each workflow reads.

## Where things stand
- Pull request #1 (https://github.com/AlbMarketsAutoPilot-lab/cit/pull/1) has the whole app. NOT merged:
  merging starts the Worker and Pages deploys, so it waits until the secrets exist.
- Cloudflare D1 database `called-it` (id 76b04ebe-8043-428a-866c-937df76f9dac) already exists with its tables.
- Android signing is NOT on GitHub (owner decision 2026-10-25, as KAJ): no KEYSTORE_* secrets.

## Goal: guide me one step at a time, in this order
1. Cloudflare API token: https://dash.cloudflare.com/?to=/:account/api-tokens → Create Token →
   Custom → "Edit Cloudflare Workers" template, add Account → D1 → Edit, name `called-it-github`,
   Account Resources = the account with the database `called-it`. (Checked against Cloudflare's
   GitHub Actions guide, updated 18 Oct 2026.)
2. Cloudflare Account ID (where to find it, checked on Cloudflare's page on the day).
3. football-data.org API key.
4. OneSignal: App ID and REST API key; the Android (FCM) platform set up in OneSignal.
5. AdMob: App ID and one banner ad unit ID for app com.calledit.app.
6. GitHub secrets at https://github.com/AlbMarketsAutoPilot-lab/cit/settings/secrets/actions,
   ONE SECRET PER STEP: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, FOOTBALL_DATA_KEY,
   ONESIGNAL_APP_ID, ONESIGNAL_API_KEY, ADMOB_APP_ID, ADMOB_BANNER_ID.
7. GitHub Pages: https://github.com/AlbMarketsAutoPilot-lab/cit/settings/pages → Source: GitHub Actions.
8. I merge pull request #1. You then read the "Worker" workflow log and give me the workers.dev address.
9. Variable API_BASE at https://github.com/AlbMarketsAutoPilot-lab/cit/settings/variables/actions
   = that address.
10. Re-run the "Web" and "Android" workflows (Run workflow on main).
11. You check: <API_BASE>/v1/status answers {"ok":true,...}; the web app opens at
    https://albmarketsautopilot-lab.github.io/cit/; the test APK artifact exists.
    Note: the hourly job (:15) imports yesterday to tomorrow; the full week comes with the daily
    job at 03:40 UTC.

## Strict
- Never ask me to paste a secret value (token, key) into the chat. I only say "done".
- Facts about Cloudflare, OneSignal, AdMob and GitHub screens: check on their own pages on the day,
  give the link. If the screen differs, ask me what I see.
- No code changes, no new endpoints, no pushes unless I say "approved".
- Open question to propose to me (problem, evidence, change, cost, risk) before task 9: when I build the
  release in Android Studio on my PC, the AdMob and OneSignal IDs come from environment variables
  (android/app/build.gradle.kts), so a local build would get AdMob test ads and no push.
- At the end: update the status table in docs/PLAN.md (task 6 done), only after my "approved",
  then push to the same pull request or a new one; I merge.
- Effort: medium (low is enough for steps 6–10).
