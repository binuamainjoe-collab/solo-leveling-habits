# Gap plan — the app today vs. docs/VISION.md

Measured on 14 October 2026, against branch `bugfix/overnight-2026-10-13` (on top of `main` at
`31be2e6`). No app code, packages or database were changed to produce this.

Scoring: **0** not started · **1** idea only, no code · **2** partly built · **3** built and works ·
**4** built, works, and connected to the AI assistant.

---

## 1. Match score

| Area | Score | Evidence (file:line) | Missing piece |
|---|:--:|---|---|
| **Purpose: the assistant is the core, not an add-on** | 2 | [`src/app/(tabs)/_layout.tsx:22`](../src/app/(tabs)/_layout.tsx#L22) — five tabs, one of which is the planner; the AI appears in one chat screen and one Goal tab | The AI never speaks outside planning. Four of five tabs work entirely without it. |
| **Knows my goals** (the goal reaches the AI) | 2 | [`src/app/planner-chat.tsx:156`](../src/app/planner-chat.tsx#L156) sends `state.profile?.goals` — onboarding interest IDs like `grades`, not the real goal. Beru and Igris *do* use the Goal tab's goal ([`supabase/functions/goal-api/index.ts:57`](../supabase/functions/goal-api/index.ts#L57)) | The planner never sees the active goal or Igris's must-read findings, so it can't turn the goal into tomorrow's tasks. |
| **Knows my schedule** (calendar read and write) | 2 | [`supabase/functions/google/index.ts:159`](../supabase/functions/google/index.ts#L159) `calendar.list`, `:173` `calendar.insert` | Server-only. No screen or agent calls either operation, so the planner still asks "what's fixed tomorrow?" every night. |
| **Knows my progress and habits** (history feeds the AI) | 2 | Full day log in [`src/store/progress.tsx:88`](../src/store/progress.tsx#L88); [`supabase/functions/log-snapshot/index.ts`](../supabase/functions/log-snapshot/index.ts) exists but no client calls it; the Steward reports `no_snapshot_today` ([`supabase/functions/_shared/steward.ts:239`](../supabase/functions/_shared/steward.ts#L239)) | The history is rich but stays on the device. The AI only sees it indirectly, and only when signed in. |
| **Proactive planning** (the AI starts planning) | 2 | [`src/data/planner.ts:249`](../src/data/planner.ts#L249) `openingLine` is written locally with no API call; the chat then waits for me | The System never opens the conversation itself, and starts from a blank page rather than from what it knows. |
| **Reminders outside the app** (push or email) | 1 | Only the Steward's optional email ([`supabase/functions/steward-report/index.ts:215`](../supabase/functions/steward-report/index.ts#L215)), which is a report, not a reminder. `expo-notifications` is not in `package.json` | No push notifications at all. If I don't open the app, nothing reaches me. |
| **C1 External structure** (visible day, real clock times) | 4 | [`src/components/planner/Timeline.tsx:57`](../src/components/planner/Timeline.tsx#L57) now-marker, `:116` the NOW row; the plan itself comes from the AI | — |
| **C2 Short next steps** (one next action) | 1 | [`src/components/planner/Timeline.tsx:158`](../src/components/planner/Timeline.tsx#L158) highlights the current block, and that is all | Nothing anywhere shows "the one next action". The board shows every quest at once. |
| **C3 Fast reward** | 3 | [`src/components/quest/QuestCard.tsx:65`](../src/components/quest/QuestCard.tsx#L65) completion sound and haptic, `:198` floating XP | Works, but is pure local game layer — the assistant never acknowledges a completion. |
| **C4 Low working-memory load** (holds my open loops) | 2 | Planned tasks are kept forever ([`src/store/progress.tsx:96`](../src/store/progress.tsx#L96)); today's board holds today's loops | Nothing carries an unfinished task into tomorrow, and the AI is never told what was left open. |
| **C5 Start easy** (smallest first step) | 2 | [`supabase/functions/plan-tomorrow/index.ts:53`](../supabase/functions/plan-tomorrow/index.ts#L53) "Give a task a concrete first move in its title" | Only at planning time. Nothing to press when I'm stuck mid-day, so the rule never fires when it is most needed. |
| **C6 Recover without shame** | 3 | Clean rollover, no pile-up ([`src/store/progress.tsx:300`](../src/store/progress.tsx#L300)); "Never guilt, never urgency" ([`plan-tomorrow/index.ts:63`](../supabase/functions/plan-tomorrow/index.ts#L63)) | The board's own banner still reads "Failure to complete the daily quest will result in an appropriate penalty" ([`src/app/(tabs)/index.tsx:114`](../src/app/(tabs)/index.tsx#L114)), and no AI line meets me after a missed day. |
| **C7 Plan with defaults** (one question at a time) | 4 | [`plan-tomorrow/index.ts:33`](../supabase/functions/plan-tomorrow/index.ts#L33) exactly one question, `:38` assume 07:30/23:00 and move on | — |
| **C8 Check in at the right time** | 2 | [`src/components/planner/PlanNudge.tsx:35`](../src/components/planner/PlanNudge.tsx#L35) uses my saved hour, `:39` after that hour or before 04:00 | In-app only: it is a card I see *if* I open the app. No block-start or drift check-ins. |
| **C9 Interest-based pull** (ties a task to what I care about) | 1 | Quest cards show XP only ([`QuestCard.tsx:110`](../src/components/quest/QuestCard.tsx#L110)) | Nothing connects a task to the goal it serves, because the planner doesn't know the goal (see row 2). |
| **C10 Ask before overloading** | 2 | "Under-fill rather than over-fill" ([`plan-tomorrow/index.ts:52`](../supabase/functions/plan-tomorrow/index.ts#L52)); hard cap of 16 blocks ([`src/data/timeline.ts:322`](../src/data/timeline.ts#L322)); `busyMinutes` exists ([`src/data/timeline.ts:401`](../src/data/timeline.ts#L401)) | It under-fills silently but never says "that's six hours — which one comes out?" There is no load threshold that triggers a question. |
| **Multi-goal support (CEO agent)** | 0 | One active goal is enforced: the old one is stood down on create ([`supabase/functions/goal-api/index.ts:126`](../supabase/functions/goal-api/index.ts#L126)) | No second goal, no agent that holds them, no weekly "what matters" decision. |
| **Daily-task agent** | 0 | No file | Nothing turns goals into each day's concrete tasks without me listing them. |
| **Google Tasks two-way sync** | 1 | Server ops only: [`supabase/functions/google/index.ts:197`](../supabase/functions/google/index.ts#L197) `tasks.list`, `:205` `tasks.insert`, `:219` `tasks.complete` | No client, no sync loop, no conflict handling. The pieces exist; the sync does not. |
| **Calendar scheduling** (the plan written into the calendar) | 1 | The `calendar.insert` op exists ([`google/index.ts:173`](../supabase/functions/google/index.ts#L173)) and nothing calls it | No "Tusk" agent, no write-back when a plan is finalised. |
| **Voice or conversational interface (JARVIS-style)** | 1 | Text chat exists but only for planning ([`src/app/planner-chat.tsx`](../src/app/planner-chat.tsx)); no speech package in `package.json` | No voice in or out, and no general conversation — I can't ask "what should I focus on this week?" |

**Overall: 38 / 84 = 45%.**

Read another way: the game layer and the planner are real and working; everything that would make the
System *know me and reach me* is at 0–2.

---

## 2. Work estimate

Every row below 4, ordered so the cheapest high-impact work comes first. Sizes: **S** under 2 h,
**M** 2–8 h, **L** 1–3 days, **XL** over 3 days (my working time, with Claude Code writing the code).

"Who" means who has to act: *CC* = Claude Code can do it end to end; *You* = a step only you can do
(an account, a device, a decision); *Dev* = genuinely needs a developer's judgement.

| Order | Area | Size | Depends on | Impact | Who |
|:--:|---|:--:|---|:--:|---|
| 1 | **Knows my goals** — pass the active goal and Igris's must-read findings into `PlannerContext`, plus two prompt lines | S | — | **High** | CC |
| 2 | **C9 Interest-based pull** — prompt rule "name the goal a task serves", shown on the block | S | 1 | **High** | CC |
| 3 | **Knows my progress** — call `log-snapshot` after rollover and after finalising a plan | S | — | **High** | CC |
| 4 | **C10 Ask before overloading** — a load threshold from `busyMinutes`, and a prompt rule to propose a cut | S | — | Med | CC |
| 5 | **C5 Start easy** — an "I'm stuck" action on a block that asks for the smallest first step | S | — | **High** | CC |
| 6 | **C2 Short next steps** — a "next action" card at the top of the board, from the current plan | M | — | **High** | CC |
| 7 | **C6 Recover without shame** — soften the penalty banner; one AI restart line after a missed day | S | 3 | Med | CC |
| 8 | **Reminders outside the app** — `expo-notifications`, local reminders scheduled from the finalised plan | M | — | **High** | CC + You (dev build for remote push; local works in Expo Go) |
| 9 | **C8 Check in at the right time** — block-start and planning-hour notifications, quiet hours respected | M | 8 | **High** | CC |
| 10 | **C4 Low working-memory load** — carry unfinished tasks forward and tell the planner what was left open | M | 3 | Med | CC |
| 11 | **Knows my schedule** — client calls `calendar.list`, real events go into the planner context | M | You signing in once | **High** | CC + You |
| 12 | **Proactive planning** — the AI writes the opening line from goal + calendar + yesterday, instead of the local template | M | 1, 3, 11 | **High** | CC |
| 13 | **C3 Fast reward** — the assistant reacts to completions (a line, not just a chime) | S | 3 | Low | CC |
| 14 | **Calendar scheduling** — write the finalised plan into Google Calendar, and update it on re-plan | L | 11 | Med | CC |
| 15 | **Voice interface** — `expo-speech` out, speech-to-text in, over the existing chat | L | You: dev build | Med | CC + You |
| 16 | **Google Tasks two-way sync** — sync loop, change detection, conflict rules | L | 11 | Low | CC + Dev (sync conflicts are where quiet data loss lives) |
| 17 | **Multi-goal support (CEO agent)** — several active goals, plus an agent that holds them and briefs the others | XL | 1, 3 | **High** | CC + Dev |
| 18 | **Daily-task agent** — turns goals into each day's tasks on its own | XL | 17 | **High** | CC + Dev |
| 19 | **Purpose: the assistant as the core** — an always-available System voice; a general "ask me anything" surface | XL | 1, 3, 11, 12, 17 | **High** | CC + Dev |

Items 1–7 are a single sitting's work between them, and together they move five rows up a band.

---

## 3. Free tools

Checked on 14 October 2026 against each project's own repository. Everything listed is free to use
and was updated within the last 12 months, unless marked otherwise. **Nothing here is installed.**

### Agent framework / orchestration

| Name | Where | License | Last updated | What it fills | Risk |
|---|---|---|---|---|---|
| Google Gen AI SDK (JS/TS) | [googleapis/js-genai](https://github.com/googleapis/js-genai) | Apache-2.0 | 2026-10-14 | Google's own Gemini SDK: tool calling, structured output, streaming. Would replace the hand-rolled `fetch` in every edge function. | Low. Runs in Deno via `npm:` specifiers; one dependency to keep current. |
| Vercel AI SDK | [vercel/ai](https://github.com/vercel/ai) | Apache-2.0 | 2026-10-14 | Agent loops, tool calling and streaming with a Gemini provider; explicitly supports Deno and edge runtimes. | Low–med. Large surface area for one app; agent abstractions change between major versions. |
| Genkit | [firebase/genkit](https://github.com/firebase/genkit) | Apache-2.0 | 2026-10-14 | Google's agent framework: flows, tools, tracing and evals, Gemini-native. Good fit for the CEO agent. | Med. Node-first; running it inside Supabase Edge (Deno) needs checking before committing. |

*Considered and set aside:* [mastra-ai/mastra](https://github.com/mastra-ai/mastra) (updated 2026-10-14)
is well maintained, but parts of it under `ee/` carry a separate enterprise licence rather than being
plain open source, so it is not a clean "free" answer.

### Voice input and output

| Name | Where | License | Last updated | What it fills | Risk |
|---|---|---|---|---|---|
| `expo-speech` | [expo/expo](https://github.com/expo/expo/tree/main/packages/expo-speech) | MIT | 2026-10-14 | Text-to-speech on iOS, Android and web, in Expo Go. The System's voice, said aloud. | Low. Platform voices are robotic, and iOS stays silent in silent mode. |
| `react-native-executorch` (Whisper) | [software-mansion/react-native-executorch](https://github.com/software-mansion/react-native-executorch) | MIT | 2026-10-13 | On-device speech-to-text. No audio leaves the phone and there is no per-minute cost. | Med. Needs a development build (not Expo Go), and the model adds tens of MB to the app. |
| `whisper.rn` | [mybigday/whisper.rn](https://github.com/mybigday/whisper.rn) | MIT | 2026-10-07 | The other on-device Whisper binding, smaller and more established. | Med. Development build required; you manage the model file yourself. |

*Note:* Gemini can also take audio directly, which would need no new package at all — it costs
model budget instead of app size. Worth testing before adding a speech library.

### Calendar and task sync

| Name | Where | License | Last updated | What it fills | Risk |
|---|---|---|---|---|---|
| `googleapis` (Node client) | [googleapis/google-api-nodejs-client](https://github.com/googleapis/google-api-nodejs-client) | Apache-2.0 | 2026-10-13 | Typed Calendar and Tasks clients for the edge functions, replacing hand-written REST calls. | Low–med. A big package for Deno; the current hand-rolled calls already work. |
| `expo-calendar` | [expo/expo](https://github.com/expo/expo/tree/main/packages/expo-calendar) | MIT | 2026-10-14 | Reads the phone's own calendar, including non-Google ones, without any OAuth. | Med. Needs a development build and a calendar permission prompt. |
| `ical.js` | [mozilla-comm/ical.js](https://github.com/mozilla-comm/ical.js) | MPL-2.0 | 2026-10-13 | Parses `.ics` feeds and recurring-event rules — a university timetable, for instance. | Low. Only needed if a timetable arrives as an `.ics` URL. |

*Considered and set aside:* [jkbrzt/rrule](https://github.com/jkbrzt/rrule) handles recurrence rules
well but was last updated in June 2024, outside the 12-month rule.

### Push notifications for Expo

| Name | Where | License | Last updated | What it fills | Risk |
|---|---|---|---|---|---|
| `expo-notifications` | [expo/expo](https://github.com/expo/expo/tree/main/packages/expo-notifications) | MIT | 2026-10-14 | Local scheduled reminders (block starts, planning hour) and remote push. Expo's push service is free. | Med. Since SDK 53 remote push does not work in Expo Go, so it needs a development build. Local notifications still work in Expo Go on Android. |
| `expo-server-sdk-node` | [expo/expo-server-sdk-node](https://github.com/expo/expo-server-sdk-node) | MIT | 2026-09-29 | Lets a Supabase edge function or cron job send a push — the Steward or CEO agent reaching me unprompted. | Low. Needs the device's push token stored server-side. |
| `expo-task-manager` + `expo-background-task` | [expo/expo](https://github.com/expo/expo/tree/main/packages/expo-task-manager) | MIT | 2026-10-14 | Background work, e.g. sending the daily snapshot without the app being opened. | Med–high. Both platforms throttle background execution hard; not a reliable timer. |

### Long-term memory for the assistant

| Name | Where | License | Last updated | What it fills | Risk |
|---|---|---|---|---|---|
| `pgvector` | [pgvector/pgvector](https://github.com/pgvector/pgvector) | PostgreSQL License | 2026-10-08 | Vector search inside the Supabase database you already pay nothing extra for. With Gemini embeddings this is a complete memory store with no new service. | Low. The most work to build yourself, and the least to operate. **Recommended starting point.** |
| Mem0 | [mem0ai/mem0](https://github.com/mem0ai/mem0) | Apache-2.0 | 2026-10-12 | A ready-made memory layer: extracts facts from conversations, stores and retrieves them. Can sit on Postgres/pgvector. | Med. Python-first; the hosted version is paid, and self-hosting means another service beside Supabase. |
| Letta (ex-MemGPT) | [letta-ai/letta](https://github.com/letta-ai/letta) | Apache-2.0 | 2026-09-10 | A full stateful-agent runtime with managed long-term memory and self-editing memory blocks. | High for this project. It wants to *be* the agent runtime, which would replace the edge functions rather than slot into them. |

### ADHD / executive-function coaching resources

Open prompts and reference material only. None of these is a medical tool, and none should be
treated as clinical guidance.

| Name | Where | License | Last updated | What it fills | Risk |
|---|---|---|---|---|---|
| awesome-adhd | [XargsUK/awesome-adhd](https://github.com/XargsUK/awesome-adhd) | CC0-1.0 | 2026-10-07 | A curated list of ADHD tools, books and techniques — a source of patterns worth copying into the System's coaching rules. | Low. A reading list, not code; quality varies by entry. |
| `i-have-adhd` output style | [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) | MIT | 2026-10-11 | A working prompt that reshapes replies to lead with the next action and number multi-step work — directly comparable to rules C2 and C5. | Low. One person's prompt, not a validated framework. |
| awesome-openclaw-skills (`adhd-daily-planner`) | [sundial-org/awesome-openclaw-skills](https://github.com/sundial-org/awesome-openclaw-skills) | **No licence file** | 2026-03-07 | A planning prompt that picks a strategy by time horizon (next 2 hours → month), including an emergency "one next action" mode. | **Med. With no licence, you have no right to copy the text.** Read it for ideas; write your own wording. |

*Considered and set aside:* the **AnnoMI** motivational-interviewing dataset is the best-known open
corpus of coaching dialogue, but its Hugging Face mirrors were last touched in 2025 or earlier and
the original repository has no licence file, so it fails both the freshness and the licence test.
There is no paid tool in this section; nothing above needs an API key.

---

## 4. What I need to do

Five things, in order. Everything else can be done by Claude Code once these are cleared.

| # | Action | Time | Why it is first |
|:--:|---|:--:|---|
| 1 | **Approve merging `bugfix/overnight-2026-10-13` into `main`.** Say "merge the bugfix branch". It holds 11 fixes, including the one that made every switch and pill on the web build dead. | 5 min | Every item in section 2 builds on this branch. Leaving it unmerged means the next work either forks off it or redoes it. |
| 2 | **Open the app and sign in with Google once**, approving the Calendar and Tasks consent screen. On the phone, or on the web build once it is deployed. | 10 min | Rows 11, 14 and 16 are blocked until a real refresh token exists on the server. The code is already written and waiting. |
| 3 | **Decide: one goal, or several.** One active goal is enforced in the database today. The CEO agent in your vision implies several. Tell me which, and whether a goal needs a deadline. | 10 min thinking | It changes the database schema. Deciding later means a migration and rewriting the goal screen. |
| 4 | **Create a free Expo account and run one development build** (`npx eas build --profile development --platform android`). I'll write the config; you run the command and install the result on your phone. | 1 h, mostly waiting | Unblocks push notifications (row 8), the right-time check-ins (row 9) and voice (row 15). None of them work in Expo Go. |
| 5 | **Turn off the Netlify team login, or decide the web build is private**, in Project configuration → Access & security. | 5 min | The public site is still behind a login and on an 8 October build. Until this is settled I can't verify anything on the deployed app, only locally. |

---

## Needs my decision

Open points that change what gets built. None of them blocks sections 1–3 above.

1. **One goal or several** (also item 3 above). Several goals means a schema change and a way to say
   which one matters this week.
2. **How proactive should the System be?** Which moments justify a notification: a block starting, a
   block missed, the planning hour, a streak at risk? And what are the quiet hours when it must stay
   silent? Row 9 cannot be built without this.
3. **Where does the assistant live?** Its own chat tab, a voice on every screen, or notifications
   first? This decides whether row 19 is a new tab or a rework of the existing screens.
4. **How much should it remember, and where?** Server-side memory is required for anything that
   reaches me while the app is closed, but it means my history leaves the device.
5. **Which coaching rules are visible, and which work silently?** For example, should it say "I cut
   the reading because the day was full" (C10), or just quietly plan a lighter day?
6. **Voice: on-device or through Gemini?** On-device (Whisper) is private and free but needs a
   development build and tens of MB. Gemini audio needs no package and spends model budget instead.
7. **Does the public web build stay?** This is a single-user app with a shared app secret in the web
   bundle (gap 17 in VISION.md). Keeping it public means anyone who finds it can spend the Gemini
   budget, within the daily caps.
8. **What counts as "career development"**: courses, applications, a portfolio, skills? Rows 17 and
   18 need a definition before they can turn a goal into daily tasks.
