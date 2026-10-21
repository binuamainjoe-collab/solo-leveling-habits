# The System — Vision

A personal AI assistant and life coach modelled on the System from *Solo Leveling*. Built with React
Native and Expo (SDK 57, expo-router), with a Supabase backend. The code lives in the
`solo-leveling-habits` repository.

This document says what the app is for and how it should work. It also compares that intent with
the code. The status columns were first written on 14 October 2026 and were re-checked against the
code on 21 October 2026 (branch `feature/assistant-core`, with the redesign and model change
applied).

---

## Purpose

*In my own words:*

> I want the System to be my personal AI assistant and life coach, the way JARVIS is to Tony Stark
> and Alfred is to Batman. It knows my goals, my schedule, my progress and my habits. It keeps me
> on track, plans my day with me, and nudges me at the right moments, with as few decisions as
> possible from me. The Solo Leveling frame (quests, XP, ranks, stats, the System's voice) is how
> it motivates me and makes progress feel real. The AI is the core. The game layer is how it talks
> to me.

What that means in practice:

- **The assistant is the product.** The System's job is to understand my life well enough to run
  the day-to-day for me: what matters, what's next, and when to act. Every screen exists to
  feed it information or to carry its voice.
- **The game layer is the interface, not the point.** Quests are how the System gives me
  instructions. XP, ranks and stats are how it shows me progress. The System's voice is how it
  speaks. These make following the assistant feel rewarding rather than like a to-do list.
- **Few decisions, by design.** The System proposes and I confirm. It asks one thing at a time and
  fills in sensible defaults, so the cost of staying on track stays close to zero.
- **Supporting reason: ADHD.** Daily planning takes too many decisions, and I lose track of my
  studies and career goals. An assistant that holds the plan and nudges me at the right moment
  takes that load off. This is a big reason it suits me, but it's not the whole vision.

## Who it is for

Just me. One person, one set of goals, one daily routine. It is not a product for other users.

(The code is currently written for a generic "student" and supports several accounts: see
[Gaps](#gaps-and-open-questions).)

## The assistant

What the System should do as my assistant. Each point is stated by me. The status column shows how
far the current code gets.

| # | Capability | Source | Status in code |
|---|---|---|---|
| A1 | **Know my goals.** Hold my long-term goals and what each one needs, and keep them in mind in everything it plans or says. | Stated by me | Built: several goals, one of them the focus (Goal tab). The assistant and the planner read every goal, the focus and its unread findings on the server. |
| A2 | **Know my schedule.** Know my fixed commitments, classes, deadlines and free time, ideally straight from my calendar. | Stated by me | Built (read only): wake and sleep are remembered, and the day's Google Calendar events and open Google Tasks reach the assistant and the planner (`src/lib/calendar.ts`). Code merges overlapping events, cuts events at midnight and to the waking hours, and keeps all-day events as context. Writing plans into the calendar is open question 19. |
| A3 | **Know my progress and habits.** Track what I actually do each day, my streaks and patterns, and where I keep slipping. | Stated by me | Built: the day log, streaks and stats stay on the device; a daily snapshot goes to the server (`log-snapshot`), and the assistant and planner read the last seven days. |
| A4 | **Plan proactively.** Plan my day with me with minimal input, starting from what it already knows rather than a blank page. | Stated by me | Built: the planning chat starts from goals, server memory, recent days, open loops, the calendar and open Google Tasks, with a draft timeline and one-tap finalize. |
| A5 | **Remind me at the right moments.** Nudge me when something should start, when I'm drifting, and when it's time to plan, even with the app closed. | Stated by me | Built (local notifications): morning briefing, planning time, and missed block / drifting (`src/data/reminders.ts`). Block-start nudges were not chosen. |
| A6 | **Coach me on progress.** Tell me honestly how I'm doing against my goals, what's working and what to change. | Stated by me | Partial: the Steward writes a short report on demand or daily (paused); the assistant coaches in conversation. |
| A7 | **Answer questions about my life and goals.** For example, "What should I focus on this week?", "How did my studying go this month?" or "What did Beru find about X?" | Stated by me | Built: the floating ◆ assistant on every tab screen, typed or push-to-talk with spoken replies, with server-side memory. It can also change the app on request (quests, targets, progress, schedule, goals), with Undo. |
| A8 | **Act through agents.** Delegate research, judging, reporting, scheduling and task work to specialised agents, coordinated by a top-level agent. | Stated by me | Partial: the assistant acts on the app itself; Beru, Igris and the Steward exist (paused). There is no coordinating agent over the shadows and no separate tasks agent; the planner turns goals into each day's tasks. |

**Models (21 October 2026).** The typed and spoken assistant, the planner, Beru, Igris and the
Steward are set to `gemini-4-argon`, with `gemini-3.8-flash` taking over when Argon is slow,
unavailable or sends something unusable (`supabase/functions/_shared/models.ts`). Each tier can be
changed with a Supabase secret. Every model a run asked is recorded in `agent_runs.model`
(assistant, shadows, Steward; a fallback reads `gemini-4-argon:<why>>gemini-3.8-flash`) and
logged as `planner: answered by …` (planner). A fallback counts against the daily caps and in
the Steward's cost line like any other model call. Not yet confirmed
on a deployed call.

## How the assistant coaches me

Design rules for how the System talks to me and paces the day. Each rule is stated by me. The
"why" names the research area behind it in plain words — these are design choices drawn from
published work on attention and executive function, not medical advice, and the System never
presents them as treatment. The rationale is for this document; the assistant itself just behaves
this way without explaining itself, and names a reason only when I ask (design principle 2).

| # | Rule | Source | Why (research area) |
|---|---|---|---|
| C1 | **External structure.** Lay the day out visibly, at real clock times, with a marker for where "now" is. Never a bare list without times. | Stated by me | Work on time perception finds that judging how long something takes, and how much of it is left, is unreliable without an external reference. Putting the day somewhere I can see it moves that job out of my head. |
| C2 | **Short next steps.** Always show the one next action. The rest of the plan stays available but out of the way. | Stated by me | Research on task initiation and goal pursuit finds that a plan shown all at once competes for attention, while a single concrete next step is what actually gets started. |
| C3 | **Fast reward.** Every completion gets immediate, visible, audible feedback. Never save the payoff for the end of the day. | Stated by me | Work on delay discounting finds that rewards lose motivating force quickly as they get further away, so feedback has to land at the moment of doing. |
| C4 | **Low working-memory load.** The System keeps every open loop — unfinished tasks, what's next, what got pushed — so I never have to hold them in my head. | Stated by me | Research on working memory finds that holding several open items at once crowds out the thinking the task itself needs. |
| C5 | **Start easy.** When I'm stuck, offer the smallest possible first step: "open the file", "two minutes", "write one line". Never restate the whole task as the way in. | Stated by me | Work on task initiation finds that the barrier is usually starting, not doing, and that shrinking the first step past the point of effort is what gets past it. |
| C6 | **Recover without shame.** A missed day starts clean. No pile of yesterday's unfinished tasks, no apology, no guilt, and streak loss stated plainly without reproach. | Stated by me | Research on self-criticism and motivation finds that shame after a lapse predicts avoiding the task again, while a neutral restart predicts returning to it. |
| C7 | **Plan with defaults.** Decide sensible defaults and ask at most one question at a time. State what was assumed in a few words and move on. | Stated by me | Work on choice overload and decision fatigue finds that each extra open choice makes stalling more likely and the decision worse. |
| C8 | **Check in at the right time.** Nudge at moments I've set — the planning hour, the start of a block — not at random, and not repeatedly. | Stated by me | Research on implementation intentions finds that a cue tied to a specific, expected moment is what turns an intention into an action; unpredictable interruptions mostly cost attention. |
| C9 | **Interest-based pull.** Tie a task to the thing I actually care about: the goal it serves, what it unlocks, what it's for. Not just that it's due. | Stated by me | Work on motivation and attention regulation finds that interest and personal relevance sustain focus more reliably than deadline pressure alone, which works late and at a cost. |
| C10 | **Ask before overloading.** When the day already holds too much, propose cutting something before adding anything. Never quietly stack a fuller day. | Stated by me | Research on planning and time estimation finds that people systematically underestimate how long work takes, so an over-full day reliably becomes a failed one. |

**Examples of the voice these rules produce.** Nothing here names a condition or a mechanism; the
System just behaves this way.

- C5, stuck on a task: "Start with opening the notes file. That's the whole step."
- C6, after a missed day: "Yesterday is closed. Today starts with one thing: the 09:00 block."
- C10, an over-full day: "That's six hours of focused work. Which one comes out — laundry or the reading?"
- C9, connecting a task to the goal: "This one feeds the exam on Friday. Thirty minutes buys you the formula sheet."

## Core loop

What I do each day, and how the app responds today.

| When | What I do | What the app does |
|---|---|---|
| **Open the app** | Nothing to decide | A short box-breathing exercise (skippable), then the Quests board. A Solo Leveling theme plays quietly underneath (it can be switched off). |
| **During the day** | Tick or step through quests on the board | Each completion pays XP and raises the quest's stats, with a burst animation and a sound. The level bar, rank, streak and "Today x/y" counter update live. Clearing the mandatory quests turns the warning banner from red to green. Hitting milestones unlocks trophies and collectible cards, each with its own reveal. |
| **During the day** | Look at the Planner tab | Today's plan is shown as a timeline split into Morning, Noon and Evening, at real clock times, with a "now" marker. Tapping a task block ticks it off; this is the same quest as on the board. Daily quests without a set time sit in an "All day" strip. |
| **Evening (from 21:30 by default)** | Tap "Plan it" on the board's nudge, or open the Planner | A chat with The System (Gemini) asks one short question at a time: what's fixed tomorrow, what I want to get done, and when I wake and sleep (only if it doesn't know yet). It keeps a draft timeline with buffers and breaks up to date, and offers tap-to-send suggestions. |
| **End of the planning chat** | Say "this is it" or "lock it in", or press Finalize | The draft is checked in code for overlaps, wake/sleep bounds and priority limits. If it fails, it gets one automatic repair attempt. Then it is saved for that date. The task blocks become one-tap quests, there is a one-time +200 XP bonus, and planned tasks pay 1.5× XP when cleared. |
| **Any time** | Open the Goal tab | Several goals, one of them the focus. Shadows can be sent out: Beru searches for material on the focus goal, Igris rates each finding, and the Steward writes a report. Marking a "must-read" finding as read pays 150 XP. |
| **Any time** | Tap ◆, then type or talk | The System answers from my goals, memory, progress, calendar and tasks, and can change the app on request (a quest target, a new quest, logged progress, the schedule, a goal). Every change can be undone. |
| **Midnight** | Nothing | The day is archived to the log, streaks and perfect days are recalculated from that log, and the board resets. |

## Design principles

| # | Principle | Source |
|---|---|---|
| 1 | **The AI is the central character, not an add-on. Quests and XP serve the assistant.** | Stated by me |
| 2 | **The assistant adapts to how my attention works, using research on executive function. It names the reason only when I ask.** See [How the assistant coaches me](#how-the-assistant-coaches-me). | Stated by me |
| 3 | **Fewer decisions, not more features.** Every daily interaction should remove a choice, not add one. | Stated by me |
| 4 | **Studies and career come first.** Everything else in the app supports them. | Stated by me |
| 5 | **AI runs on Gemini, through Supabase edge functions.** No Anthropic calls. The app never holds a model key. | Stated by me; confirmed in code (`gemini-4-argon` with `gemini-3.8-flash` behind it, all through edge functions) |
| 6 | **The model proposes; code decides.** Every AI draft is cleaned up and checked by pure, tested TypeScript (`src/data/timeline.ts`) before anything is saved. A bad draft gets one repair attempt, never a silent save. | Inferred from code |
| 7 | **Never trap, never guilt.** The old 21:30 screen takeover was replaced with a nudge you can dismiss. The planner's prompt forbids guilt, urgency and hype. Re-planning is allowed but is only paid once. | Inferred from code |
| 8 | **One question at a time, and draft early.** The planner asks exactly one question per reply, never repeats one, assumes sensible defaults, and shows a draft after about two exchanges. | Inferred from code |
| 9 | **Under-fill the day.** Real clock times, 10–15 minute buffers, a break after anything over an hour, at most 3 high-priority tasks, and anything over 90 minutes split into parts. | Inferred from code |
| 10 | **Immediate, visible cause and effect.** Every tap gives sound, a haptic pulse and an animation. The Done counter pulses when a quest moves there. XP floats up from the card. | Inferred from code |
| 11 | **Local-first, sync optional.** Progress is saved on the device and never waits on the network. Google sign-in only adds a background sync. Merges never lose a day or un-earn a reward. | Inferred from code |
| 12 | **Derived, not counted.** Streaks, perfect days and discipline coverage are rebuilt from the day log after every change, so they can't drift. | Inferred from code |
| 13 | **Pay for planning, and pay more for planned work.** +200 XP for a plan, and 1.5× XP for tasks you committed to the night before. | Inferred from code; matches "accepting a plan gives an XP bonus" (stated by me) |
| 14 | **Hard spending caps.** Each AI feature has its own daily budget of model calls, enforced on the server: 80 for the assistant, 60 for the planner and 30 for the agents. One message is one call; a message the flagship could not answer and Flash then did is two. | Inferred from code |
| 15 | **Secrets stay on the server.** The Google refresh token goes straight to an edge function, and model keys live only in Supabase secrets. | Inferred from code |
| 16 | **Faithful to the source material.** The System's voice, E→S ranks, a daily-quest warning in the style of "Preparation to become strong", and shadow names (Beru, Igris). | Inferred from code |

## Phased roadmap

Ordered by how close each item gets the app to the assistant vision. Items that help the assistant
*know me* come first. Status comes from the code, not from intent.

| Order | Item | What it adds to the assistant | Status |
|---|---|---|---|
| 1 | **The goal reaches the planner** (Gap 1) | The nightly plan is shaped by my long-term goal and Igris's must-read findings, not only by what I say that night. (A1, A4) | **Done.** The planner reads every goal, the focus and its findings on the server. |
| 2 | **Reminders outside the app** (Gap 2) | The System can reach me with the app closed: time to start a block, time to plan, a slipping streak. (A5) | **Done (local).** Morning briefing, planning time, missed block / drifting. |
| 3 | **The CEO agent, with several goals** (Gap 3) | One agent holds all my goals, briefs the others and decides what matters this week. This is the "JARVIS" layer. (A1, A8) | **Partial.** Several goals with one focus are built, and the ◆ assistant holds them all. There is no agent that briefs the shadows yet; they are paused, and their cadence is open question 20. |
| 4 | **The daily snapshot reaches the server** (Gap 4) | The assistant sees today's progress even when the app is closed, which both coaching and reminders need. (A3) | **Done.** The app sends the daily snapshot. |
| 5 | **Calendar scheduling ("Tusk")** | The System knows my real schedule and writes the plan into it. (A2, A4) | **Read built.** The day's events reach the assistant and the planner, made placeable in code. Writing the plan into the calendar waits on open question 19. |
| 6 | **Google Tasks sync** | The System's tasks and my Google Tasks stay in step. (A2, A8) | **Read built.** Open tasks (overdue and due first) reach the assistant and the planner, which can offer them as task blocks. Completing or adding Google Tasks from the app is not built yet. |
| 7 | **Ask the System** (Gap 5) | A general chat where I can ask about my goals, progress and findings. (A7) | **Done.** The floating ◆ assistant, typed and push-to-talk. |
| 8 | **AI planner** | Plans the day with me by conversation, with minimal decisions. (A4) | **Done, being polished.** `plan-tomorrow` (Gemini, its own 60-a-day budget), the chat, the Planner tab, saved and resumed chats, finalize and the XP bonus. Web fixes sit on `bugfix/overnight-2026-10-13`, not yet merged. The public Netlify site is still on an 8 October build and behind a team login. |
| 9 | **Supervisor report (the Steward)** | Coaches me on progress with an honest daily reading. (A6) | **Built, paused.** Shown in the app. It emails only if a Resend key is configured. The daily 20:00 schedule is a SQL script you run by hand. |
| 10 | **Scout and judge (Beru and Igris)** | Finds and filters material for my goal. (A8) | **Built, paused.** Deployed. Beru does a grounded Google search, and Igris rates each finding skip, skim, read or must-read. |
| 11 | **Daily-task agent** | Turns goals into each day's concrete tasks without me deciding them. (A4, A8) | **Partial.** The planner already turns the focus goal, open loops and open Google Tasks into each day's task blocks, which become quests. There is no separate agent that does it without a conversation. |
| 12 | **Accounts and sync** | My data follows me between phone and browser. (A3) | **Done.** Google sign-in, more than one account per device, and merges that never lose data. |
| 13 | **Core habit loop (the game layer)** | How the assistant talks to me and rewards progress. | **Done.** 106 quests, XP and levels, E→S ranks, six stats, streaks, a calendar, 43 trophies, 17 cards, onboarding, sound, music and the breathing gate. |
| 14 | **Game-layer extras** | Richer motivation, using titles, jobs, a real penalty zone and stat allocation. | **Not started** (Gaps 7–11). |

---

## Gaps and open questions

Where the code disagrees with the vision, ranked by priority, followed by questions only I can
answer. The number in brackets is the gap's number in the previous version of this document.

### Top priority: the assistant knowing me

1. **Closed (21 Oct 2026).** ~~The planner doesn't know your goal.~~ The planner reads every goal,
   the focus and its findings.
2. **Closed (21 Oct 2026).** ~~Nothing reminds you outside the app.~~ Local reminders: morning
   briefing, planning time, missed block / drifting.
3. **(was 13) The daily-task agent and the CEO agent are not separate agents yet.** Several goals
   with one focus are built. The planner turns goals into tasks in conversation; nothing does it
   unattended, and nothing briefs the shadows (paused; see question 20).
4. **Closed (21 Oct 2026).** ~~`log-snapshot` is never called by the app.~~ The app sends the
   daily snapshot.

### New, from the assistant vision

5. **Closed (21 Oct 2026).** ~~You can't ask the System anything outside planning.~~ The ◆
   assistant on every tab screen answers and can change the app, with Undo.

### Remaining gaps, unchanged

6. **(was 16) Re-check against this vision.** The code has features the vision doesn't mention:
   the breathing gate on every launch, background music, collectible cards, the 106-quest Archive
   and the onboarding wizard. Decide for each whether it serves the assistant, now that the game
   layer is defined as the assistant's voice.
7. **(was 1) There are six stats, not five.** The code also has **SEN**, which 27 of the 106
   quests reward. *Keep SEN, or fold it into PER?*
8. **(was 2) Stats are never allocated.** They rise automatically by fixed amounts per quest, and
   fall again if a quest is unticked. There are no free points to spend. *Do you want Solo
   Leveling-style free points per level?*
9. **(was 3) The penalty zone is only words.** Failing the mandatory quests shows red warning
   text, and coming back after a failure earns one card ("Right Here, Right Now"). Nothing else
   happens: no XP loss, no penalty quest, no lockout. *What should a failed day actually cost?*
10. **(was 4) Titles don't exist.** The nearest things are trophies (43) and cards (17). *Should
    titles be a separate, equippable thing, or can the trophies count as titles?*
11. **(was 5) There is no job progression.** Rank E→S exists, but it is derived purely from level.
    There are no jobs or classes and no job-change quest.
12. **(was 6) The app is built for "a student", not just me.** There's a 7-step onboarding with
    name and age band, more than one Google account per device, cross-device sync, a public GitHub
    repo and a public web deploy. *Keep this generality, or strip it back for a single user?*
13. **(was 7) Studies and career aren't central yet.** The quest catalogue is a broad lifestyle
    list covering body, nutrition, mind, craft, discipline, care, social and wealth. Nothing tracks
    a course, an exam date, applications or career milestones.
14. **(was 9) Only part of an accepted plan becomes quests.** Task blocks become new quests.
    Daily-quest blocks just schedule quests you already have. Fixed commitments and breaks stay on
    the timeline only. This matches "it becomes quests and gives an XP bonus" closely, but not
    exactly.
15. **(was 11) Email is optional.** The Steward only emails if a Resend key is set; otherwise the
    report stays in the app. Whether the 20:00 schedule script has been run can't be told from the
    code.
16. **(was 12) Calendar and Tasks are read, not written.** The day's events and open tasks reach
    the assistant and the planner. Writing plans into Calendar (question 19) and completing or
    adding Google Tasks from the app are not built yet; the server already supports both.
17. **(was 15) The app secret isn't secret on the web.** The edge functions are protected by an
    `EXPO_PUBLIC_` app secret, which is built into the public web bundle, so anyone who opens the
    site can read it. The daily caps limit the cost, but anyone could use up your Gemini budget.

### Open questions

18. What counts as "career development" in the app: courses, applications, a portfolio, skills?
    And should the board have a fixed slot for it every day?
19. Should accepting a plan also put its fixed blocks and tasks into Google Calendar automatically
    (Phase 4), or only on request?
20. When the agents un-pause, what order and cadence do you want? Daily automatic runs, or only
    when you press "summon"?
21. Is the public web build meant to stay, given that this is a single-user app?
22. **(new)** How proactive should the System be? Which moments justify a reminder: block starts,
    missed blocks, planning time, a streak at risk? And what are the quiet hours when it must stay
    silent?
    *Answered: morning briefing, planning time, and missed block / drifting. Quiet hours are still
    open.*
23. **(new)** Where should the assistant "live": its own chat tab, a voice on every screen, or
    notifications first?
    *Answered: a floating ◆ on every screen.*
24. **(new)** Which of these coaching rules should be visible to me, and which should work
    silently? For example, should it say "I cut the reading because the day was full" (C10) or just
    quietly plan a lighter day?
25. **(new)** How much should it remember? Should the assistant keep a running memory of past
    conversations and decisions, and should that memory be stored on the server (needed for
    reminders while the app is closed) or only on the device?
    *Answered: a running memory, stored on the server.*
