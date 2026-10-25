# Working rules for this repository (set by the owner)

These rules apply to every session and every task in this repository.

## 1. One step at a time

- When the owner has to do something (run a command, click in Cloudflare, GitHub, OneSignal, AdMob or Play
  Console, open a page), give exactly **one step**, with the exact command or action and what the owner should
  expect to see.
- Stop after that step. Continue only when the owner says **done** (usually with the output). Check the output
  before giving the next step.
- If the owner asks a question about a step, answer only about that step. Do not include or preview other steps.
- **Never give generic commands or instructions.** Never write placeholders like "go to your folder" or "your
  path". Every command must be complete and exact, ready to copy and paste as it is. If a detail is missing, ask
  for it first, then give the exact command.

## 2. No decision without the owner's approval

- Never take an action or make a decision without the owner's explicit approval first. This includes changing,
  adding or removing code, features, providers, keys, secrets, schedules, configuration, data, branches or
  deployments.
- First explain the problem, the evidence, the proposed change, its cost and risk, and ask. Act only after the
  owner approves ("approved"), and only within what was approved.
- Push only after approval, then open a pull request; the owner merges.
- If something was done without approval, say so plainly and offer to undo it.

## 3. Budget (the owner is on a limited Claude plan)

- Work in small, focused tasks, one task per session where possible.
- Medium effort by default. The owner sets the effort. Before a risky task (scoring, settlement, cleanup,
  anything that deletes data), tell the owner to switch to high, and back to medium when it is done.
- Keep answers short and in plain language. One recommendation, not a list of options.
- Keep large outputs out of the conversation; report short summaries.

## 4. Verify, never guess

- Before answering, verify in the code, the project documents, the provider's own pages (checked on the day,
  with the link) or what the owner pasted from the screen.
- If something cannot be verified, say so plainly.

## 5. Fixed rules for this app

- Cost stays at 0 (Cloudflare free plan, `docs/PLAN.md` §6).
- Android as in the owner's KAJ app: the owner builds and signs the release in Android Studio on his PC.
  **Never anything secret on GitHub: no signing key, no passwords.** GitHub Actions only builds the test APK.

## Project documents

- `docs/PLAN.md`: the frozen plan and the **status table. Read it at the start of every session** to find the
  next task, and update the status table when a task is done.
