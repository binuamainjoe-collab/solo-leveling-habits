# Overnight bug sweep — 13 October 2026

Branch: `bugfix/overnight-2026-10-13` (cut from `main` at `31be2e6`). Nothing was pushed, nothing was
deployed, and nothing on Supabase was touched. Every fix is its own commit, so any one can be reverted
with `git revert <commit>`.

**Result:** 10 bugs fixed in 10 commits. The typecheck and lint pass with 0 errors and 0 warnings, and
every local test suite passes. 15 items need a decision from you, listed below.

## Fixed

| # | Bug | File:line | Cause | Fix | Commit | Status |
|---|---|---|---|---|---|---|
| 1 | `.env` was not ignored by git (only `.env*.local` was) | `.gitignore:34` | Missing ignore rule | Added `.env`. `.env.example` is still tracked | `cea47b9` | Fixed |
| 2 | After **Sign out**, the Status screen still said "Signed in as …" and still offered Sign out | `src/app/(tabs)/hunter.tsx:306` | It treated the first saved account as signed in, but sign-out keeps the saved account list. It also read the list only once, and the tab stays open underneath the sign-in screen | It now asks for the live session and matches that account. It re-reads every time the screen is shown | `35ce8b9` | Fixed (checked in the browser: signed out shows the sign-in text) |
| 3 | XP from the Goal screen (a must-read finding) could cross a level or rank line without unlocking that trophy or card until some later quest tap | `src/store/progress.tsx:736` | `addXp` changed the XP but never checked unlocks | `addXp` now runs the same unlock and card checks as every other XP change | `6e489c8` | Fixed |
| 4 | Backing out of a half-finished planning chat left the Planner tab saying "Create plan" instead of "Resume planning" | `src/app/(tabs)/planner.tsx:73` | The saved chat was read only when the tab first opened, and the tab stays open underneath the chat | Re-reads the saved chat each time the tab is shown | `11b1e66` | Fixed (Planner tab checked in the browser) |
| 5 | A finished planning chat could come back after the plan was sealed, so **Re-plan** reopened the old conversation | `src/app/planner-chat.tsx:135` | The clear ran inside `seal()`. The auto-save from the previous screen update could land after it on the phone, where storage calls are asynchronous | The clear now runs in an effect after the sealed state has rendered, so it always lands after any earlier save | `72932f2` | Fixed (reasoned through; not tested on a phone) |
| 6 | Onboarding said "Nothing leaves your device" about your name, which isn't true once you sign in | `src/app/onboarding.tsx:109` | Text written before sync existed | "It stays on this device unless you sign in to sync." | `fa02527` | Fixed |
| 7 | In the Status calendar, a day's list of cleared quests left out planner tasks, though the day's count included them | `src/components/system/MonthCalendar.tsx:60` | It looked quests up only in the fixed catalogue | Also looks up planner tasks | `351f906` | Fixed |
| 8 | If Gemini repeated a suggestion chip, it showed twice and React got duplicate keys | `src/data/planner.ts:349` | Chips are keyed by their text and were not de-duplicated | Repeated chips are dropped | `48e2d16` | Fixed |
| 9 | If Gemini gave two blocks the same id (for example when splitting one in two), they collided. Two tasks would become one quest with a shared tick | `src/data/timeline.ts:264` | `normaliseDraft` kept any `blk:` id without checking it was unique | A repeated id gets a fresh one. A new test fails on the old code and passes on the new | `efbd590` | Fixed (test added) |
| 10 | Quest cards showed the base XP for planner tasks, which actually pay 1.5× | `src/components/quest/QuestCard.tsx:53` | The label used `quest.xp` and ignored the planning bonus | The label shows what the store actually pays | `10df1e7` | Fixed |

No `runOnJS` exists anywhere in `src`, so the Reanimated rule needed no change.

## Checks

The full output is in `bug-log.txt`. Each check was run once at the start and again on the final commit.

| Check | Start | Final | Notes |
|---|---|---|---|
| `npm install` | Pass | — | Already up to date. `package-lock.json` did not change. npm reports 61 known vulnerabilities in dependencies (1 critical, 34 high, 25 moderate, 1 low): see Needs decision |
| `npx tsc --noEmit` | Pass, 0 errors | Pass, 0 errors | Re-run after every fix |
| `npm run lint` | Pass, 0 problems | Pass, 0 problems | |
| `npx expo-doctor` | Fail, 4 of 21 checks | Fail, 4 of 21 checks | All four are dependency issues, not code: see Needs decision |
| `npm test` | Not run | Not run | `package.json` has no `test` script |
| Local Node suites (`scratch/*-check.ts`) | — | Pass: agents, cloud, steward, sync, timeline, catalogue | `scratch/` is gitignored, so these are not committed |

## Needs decision

Each of these was found but not fixed, because it needs a dependency change, a design choice, or more
than about 20 lines.

1. **16 Expo packages are a patch version behind SDK 57**, including `expo` (57.0.21 vs ~57.0.28), `expo-router`, `@expo/ui`, `expo-constants` and `expo-web-browser`. You'd fix this with `npx expo install --check`. I didn't, because your rules forbid dependency upgrades.
2. **The `expo-asset` peer dependency is missing.** `expo-audio` requires it, and expo-doctor warns the app "may crash outside of Expo Go" (an EAS or standalone build) without it. Adding it means adding a package.
3. **Some native modules are installed twice.** There are two versions of `expo-constants` (57.0.17 and 57.0.21) and of `expo-web-browser` (57.0.2 and 57.0.3), pulled in by `expo-auth-session` and `expo-linking`. Native builds can fail on that. Upgrading per item 1 usually de-duplicates them.
4. **`eas-cli` is in devDependencies.** Expo recommends running it globally or through `npx`. Removing it is a dependency change.
5. **npm audit reports 61 vulnerabilities** (1 critical, 34 high). Fixing them means upgrades, possibly breaking ones, so they're left for you.
6. **"Reset all progress" wipes everything with a single tap and no confirmation** (`src/app/(tabs)/hunter.tsx`, `DangerButton`). The label says it can't be undone. A confirm step would be new UX, so it's left for you.
7. **Reset doesn't stick across devices when signed in.** Sync keeps the highest XP and counters, so another device with the old progress brings it all back on its next sync. Fixing that needs a design change to sync, such as a reset marker.
8. **Gemini could reuse a block id from another day's plan.** If it invents a short id like `blk:1` that matches a task from another day, the newer plan overwrites that task's details. Fix #9 only covers repeats within one draft. A full fix means passing the previous draft into `normaliseDraft`.
9. **The README is out of date.** It lists a Trophies tab and an `/achievements` route, which no longer exist. It says there are 41 achievements (there are 43). It doesn't mention the Planner, Goal or Collection tabs. It's documentation, so I left it.
10. **A save that keeps failing is retried every 250 ms forever** (`src/store/storage.ts`, `flush`), for example when storage is full. Nothing is lost, but the screen redraws 4 times a second. A backoff would be better.
11. **`addProgress` and `clearQuest` in the store are never used.** `addProgress` also reads the value from the last screen update, not the latest, so it would need fixing if it's ever used. Delete it or keep it: your call.
12. **The breathing exercise's first "Breathe in" starts with the circle already large**, so the first inhale shows no growth. It's cosmetic.
13. **Double-tapping a finding very fast (on the Goal screen) could, in theory, award its XP twice**, because both taps would read the same old state. It's very unlikely at normal tap speed. Fixing it means a busy flag on that row.
14. **The Netlify site is still out of date.** This is from earlier, not tonight. The `main` branch still needs deploying, and the site still needs its visitor login turned off. Per your rules, nothing was deployed tonight.
15. **The music fix and fixes #2 and #5 still need testing on your Android phone in Expo Go.** I could only test in the browser here.

## Decisions I made

- **Branch date:** I used 13 October, the local date when the sweep started (23:38).
- **Committed the report and log:** `REPORT.md` and `bug-log.txt` are committed to the branch so they travel with it. The log contains environment variable *names* only. I scanned it for key patterns and found none.
- **`npm install`:** I ran it as asked. It changed nothing, so there was nothing to commit.
- **Dependencies:** I didn't touch any expo-doctor finding, since all of them are dependency changes.
- **Treated as bugs (judgement calls):**
  - The onboarding privacy line (#6), because it stopped being true.
  - The XP label (#10), because the screen understated what you're paid.
- **Left as "Needs decision" instead of fixing:**
  - The single-tap reset (Needs decision item 6), because adding a confirmation is new behaviour.
  - Sync resets and cross-day block ids, because each needs a design change.
- **Tests:** I added a test for #9 and a catalogue consistency check in `scratch/`. They aren't committed because `scratch/` is gitignored. I briefly used `git stash` to confirm the new test fails on the old code, then restored the fix.
- **Planner focus re-read:** It re-reads with no dependencies. The saved chat doesn't depend on which day is shown, and the linter flagged `date` as unneeded.
- **If the live session can't be read,** the Status screen shows the signed-out state. That's the safer of the two wrong answers.
- **Browser data:** For checking in the browser, I only read the existing local data. I didn't make plans, toggle quests or change settings, because the browser already held a plan you made.
- **A stale console error:** `useFocusEffect is not defined` appeared in the browser log. It came from a hot reload while my edit was half-applied (the edit landed before its import). It persisted in the tool's log buffer, but the screen mounts and renders fine on a fresh load.
- **Dev server:** I switched from the Expo Go server to the web server to check pages, then switched back to the Expo Go server at the end so the phone QR code works again.
