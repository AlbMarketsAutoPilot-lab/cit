# Task 9: signed AAB, Play Console, closed test (prepared 2026-11-17, owner-approved)

> Paste into a new Claude Code session: **"Do task 9 using docs/prompts/Task9_play_release.md"**.
> Store texts, age rating, Data safety and the other declarations are filled in **Play Console**;
> Android Studio is only for building and signing the AAB.

Do task 9 of docs/PLAN.md (Signed AAB in Android Studio, Play Console, closed test) in the repo
AlbMarketsAutoPilot-lab/cit. Start from the latest main; work on the branch this session gives you. Effort: medium.

Read first (strict)
- CLAUDE.md: the working rules. Follow them exactly: nothing without my "approved" (that exact word; "agreed" or
  "ok" is not approval); one step at a time, then wait for my "done" and check my output before the next step;
  answer only what I ask; short plain answers, one recommendation; verify in the code, the project documents or
  Google's own pages (checked today, with the link), never guess. Every approval goes into docs/PLAN.md in the
  same commit as the work.
- docs/PLAN.md: status table, §1 fixed decisions (app id com.connectal.calledit, upright only, Android 8.0+, AdMob
  banner with UMP consent, OneSignal push, signing as in KAJ), §7 screens and v1.2 details, §9 step 6, §10 owner
  checklist (items 8 and 9), decision log.
- android/ (app/build.gradle.kts: versionCode, versionName, local.properties, release build; AndroidManifest:
  permissions), public/privacy.html, public/delete-account.html, docs/store/ (icon-512.png, feature-1024x500.png).

Where things stand
- Tasks 1–8 and 10A–10D are merged and live. The app is not published; only test APKs from GitHub Actions exist.
- Worker: https://called-it.morenmirdita.workers.dev (new Cloudflare account). Never use the Cloudflare connector
  in Claude sessions (it is my other account) and no Cloudflare tool without asking me first.
- I build and sign the release AAB in Android Studio on my Windows PC, as in my KAJ app. Never anything secret on
  GitHub: no signing key, no passwords. GitHub Actions only builds the test APK.
- Cost stays €0.

What I want, in this order, one step at a time
1. Android Studio: build the signed release AAB (keystore created or reused as in KAJ, IDs in
   android/local.properties, version 1.0.0 / code 1). Tell me where the AAB lands and how to check it is signed.
2. Play Console: create the app "Called It!" (game, free, English).
3. Store listing: write the texts for me to approve before I paste them: app name, short description
   (≤ 80 characters), full description (≤ 4,000 characters), category, tags, contact email and website,
   graphics from docs/store/ and the screenshots I need (sizes and which screens).
4. App content, each one with the exact answers to give, checked against the code: privacy policy link, app access
   (sign-in needs only a nickname), ads (yes, AdMob), content rating questionnaire (IARC; age rating result),
   target audience and content (age groups; no children under 13), Data safety (what is collected, shared,
   encrypted, deletion via the delete-account page), government app, financial features, health, news (no).
   It is a free prediction game with no money, no prizes and no odds: say how to answer the gambling questions.
5. Closed test track: upload the AAB, release notes, testers list (12 testers for 14 days), countries.
6. AdMob: link the app once it is on Play; app-ads.txt on the developer website listed in Play (PLAN §10 item 8).
7. Remind me of PLAN §10 item 9 (football-data.org: confirm a free public app is fine) before production.

How to work
- First: a short plan of the steps above with anything that needs a decision from me (e.g. contact email, website
  for app-ads.txt, countries), and wait for my "approved".
- Texts and questionnaire answers: show them to me first; I paste them only after my "approved".
- If repo changes are needed (version, privacy page, app-ads.txt), explain first and wait for my "approved".
- Do not commit or push before my "approved", even if a stop hook asks for it.
- At the end: update docs/PLAN.md (status table: 9 done or how far it got; what was filled in; decision log)
  only after my "approved"; then push and open a pull request; I merge.
