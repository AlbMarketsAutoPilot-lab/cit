# Called It!

Free football prediction game for groups of friends. Pick **1 · X · 2** or a double **1X · X2 · 12**
on upcoming matches, optionally call the exact score, and beat your friends on the group table.
No money, no bets, no prizes.

The full, frozen plan is in [docs/PLAN.md](docs/PLAN.md).

| Part | Where |
|---|---|
| Game maths (points, settlement) | `shared/scoring.ts`, tests in `tests/` |
| API + daily/hourly jobs (Cloudflare Worker + D1) | `worker/` |
| App page (one HTML file, also used by Android) | `web/` → `dist/index.html` |
| Android app (WebView + AdMob + OneSignal) | `android/` |
| Privacy / delete-account pages | `public/` |

## Commands

```sh
npm ci
npm test                 # game maths
npm run typecheck
npm run build            # dist/ (API_BASE=https://… for a real build)
npm run worker:dev       # local Worker + local D1 on :8787 (cron: curl "localhost:8787/__scheduled?cron=15+*+*+*+*")
npm run android:assets   # app page for Android, live Worker address; then: gradle -p android assembleDebug
```

Local D1 tables: `npx wrangler d1 execute called-it --local -c worker/wrangler.toml --file worker/schema.sql`.

## Deploy (GitHub Actions)

- **Worker** (`worker.yml`): on merge to `main`. Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `FOOTBALL_DATA_KEY`, `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`.
- **Web** (`pages.yml`): GitHub Pages at https://albmarketsautopilot-lab.github.io/cit/. Variable `API_BASE`.
- **Android** (`android.yml`): the test APK as a build artifact. Variable `API_BASE`; secrets `ADMOB_APP_ID`,
  `ADMOB_BANNER_ID`, `ONESIGNAL_APP_ID`. Without AdMob IDs the app shows Google's test ads. The release AAB is
  built and signed by the owner in Android Studio (as KAJ); no signing key on GitHub.

## Release build on the owner's PC (Android Studio)

1. Add the real IDs to `android/local.properties` (git-ignored, stays on the PC):
   `ADMOB_APP_ID=…`, `ADMOB_BANNER_ID=…`, `ONESIGNAL_APP_ID=…` (same values as the GitHub secrets).
2. In the repo folder: `npm ci` then `npm run android:assets` (copies the app page with the live Worker address).
3. Android Studio: Build → Generate Signed App Bundle.

Match data: [football-data.org](https://www.football-data.org).
