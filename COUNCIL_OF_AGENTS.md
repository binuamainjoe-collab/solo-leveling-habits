# Council of Agents Architecture & Workflow Specification
> **Project:** Solo Leveling Habits / Solo Leveling System  
> **Target Scope:** Goal Section & Shadow Army Edge Functions (`beru-scout`, `igris-judge`, `steward-report`)  
> **Audience:** Claude Code / AI Engineers continuing work on this system

---

## 1. Executive Summary & Purpose

The **Shadow Army** is a 3-agent autonomous council engineered to help a student with ADHD pursue and complete a single long-term focus goal.

Because ADHD focus is scarce and easily depleted, single-model generation loops (where an agent finds, filters, and approves its own material) suffer from blind spots, hallucinated quality, and recommendation bloat. The **Council of Agents** pattern divides responsibilities across three specialized roles:

1. **Beru (`beru-scout`) — Lead Scout & Proposer (Rank S)**
   * *Purpose:* Explores external sources across multiple strategic angles, inspects full web pages, filters out fluff, and presents structured candidate findings.
2. **Igris (`igris-judge`) — Chief Judge & Adversarial Deliberator (Rank A)**
   * *Purpose:* Cross-examines Beru's candidates comparatively in a single batch, evaluates cognitive friction vs. yield, scores each item (1–10), assigns Hunter Ranks (E–S), and rules with strict verdicts.
3. **The Steward (`steward-report`) — Council Overseer & Chairman (Rank S)**
   * *Purpose:* Collects objective progress telemetry from Postgres, audits system anomalies, enforces zero-hallucination fact verification, and synthesizes top findings and daily directives.

---

## 2. The 3-Stage Deliberation Protocol

```
[ User Focus Goal ]
        │
        ▼
[ Stage 1: Beru (Scout & Multi-Perspective Proposer) ]
   ├── Angle A: Hands-on Practice / Exercises / Tools / Past Papers
   ├── Angle B: Structured Milestones / Curricula / Syllabuses
   └── Angle C: Insider Case Studies / First-Hand Accounts
        │  (URL Context: opens up to 6 pages, verifies content)
        │  (Deduplicates & saves max 5 candidates to DB)
        ▼
   [ Webhook: Beru autonomously raises Igris ]
        │
        ▼
[ Stage 2: Igris (Adversarial Deliberation & Peer Review) ]
   ├── Batch Comparative Deliberation (up to 12 items evaluated together)
   ├── Cognitive Friction vs. Yield Analysis (ADHD usability filter)
   └── Assigns Score (1-10), Hunter Rank (E-S), Time Cost, & Verdict
        │
        ▼
[ User Interface (Goal Tab) ]
   └── Findings rendered pre-ranked; user earns +150 XP on 'must-read'
        │
        ▼
[ Stage 3: The Steward (Executive Chairman & Synthesis) ]
   ├── Collects hard telemetry from 5 tables (runs, usage, goals, findings, snapshots)
   ├── Deterministic code calculates numbers & audits 7 anomaly rules
   ├── Synthesizes top finding comment & tomorrow focus directives (max 3)
   └── Validates every number against facts (fallback template on failure)
```

---

## 3. Agent Implementation Details

### Stage 1: Beru (`supabase/functions/beru-scout/`)
* **Model:** `gemini-3.8-flash` (fast retrieval, cost-effective).
* **Two Decoupled Passes (Gemini constraint):**
  1. *Search & Read Call:* Google Search grounding + URL context tool. Beru visits and reads the actual pages (up to 6) to avoid relying on search snippets.
  2. *Structuring Call:* Formats findings into `FINDING_SCHEMA` (max 5 items, clean URLs, 2-sentence summaries).
* **URL Normalization & Deduplication (`sources.ts`):** Strips UTM tags, tracking parameters, and trailing slashes; matches loosely against `findings` table to avoid repeating known content.
* **Autonomous Handoff:** Fires an internal HTTP POST to `igris-judge` before exiting so findings arrive already ranked.

### Stage 2: Igris (`supabase/functions/igris-judge/`)
* **Model:** Flagship model (`gemini-4-argon` / Gemini Pro).
* **Batch Deliberation (`MAX_BATCH = 12`):** Deliberates on all unjudged candidates in a single call to allow comparative ranking (preventing score inflation).
* **Cognitive Load & Friction Filter:**
  * Penalizes walls of text, dense theory without application, and passive video playlists.
  * Rewards bite-sized, interactive, step-by-step utility.
* **Hunter Rank Mapping (`rankForScore`):**
  * `9-10`: **S-Rank** (transformative impact only)
  * `8`: **A-Rank**
  * `7`: **B-Rank**
  * `5-6`: **C-Rank**
  * `3-4`: **D-Rank**
  * `1-2`: **E-Rank**
* **Verdicts & XP Incentive:**
  * Verdicts: `skip`, `skim`, `read`, `must-read`.
  * **XP Rule:** Only `must-read` awards **+150 XP** (`FINDING_XP`). Skimming or skipping pays 0 XP so the system cannot be gamed.
* **Security Guard:** Only IDs queried from Postgres can be updated; hallucinated IDs are discarded.

### Stage 3: The Steward (`supabase/functions/steward-report/` & `_shared/steward.ts`)
* **Execution Trigger:** Automatically at 20:00 (Europe/Vienna) via pg_cron or on-demand via Goal screen summon (`force: true`).
* **Core Rule: Code Computes Numbers, the Model Only Writes Words:**
  1. Pure TypeScript gathers facts and computes all percentages and totals (`deriveFacts`).
  2. 7 deterministic anomaly checks run (`detectAnomalies`): e.g. agent failures, missing runs, usage > 80%, planned completion < 50%, quest completion dropping 3 consecutive days.
  3. Narration generated with `NARRATION_SCHEMA` (`headline`, `wins`, `problems` with concrete `fix` & `fix_minutes`, `top_finding_comment`, `tomorrow_focus`).
  4. `validateNarration`: Strict regex validator checks that every number in the text matches computed facts JSON (except `fix_minutes`). If validation fails, it retries with feedback or safely falls back to a deterministic template.

---

## 4. Standing Architectural Rules (Follow Strictly)

1. **Add, Never Replace (UI Freeze):**
   * The Goal screen layout (`src/app/(tabs)/goal.tsx`), count rings, cards, sheets, and animations are fixed and approved.
   * All Council upgrades must happen in the backend/edge function layer. Never propose replacing or redesigning the existing screens or controls.
2. **Daily Call Budget (30 Calls/Day Cap):**
   * Shared daily budget is strictly enforced by the server (`sys.from('usage')`).
   * A full scout-judge cycle must cost at most 3 calls (Beru = 2, Igris = 1). The Steward costs 1 call.
   * Never introduce unbatched multi-agent loops that scale linearly with the number of findings.
3. **Pure Logic Separation (`node-testable-pure-modules`):**
   * Any reasoning or calculation logic must be kept in modules free of `react-native` imports.
   * All business rules must be testable under plain Node via `scratch/*-check.ts`.
4. **Security & Data Isolation:**
   * User data is scoped to their authenticated Supabase account (`caller(req)`).
   * No API keys or secrets (`APP_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY`) may ever appear in prompt payloads or database reports.

---

## 5. Verification Commands

Run these commands before committing any changes to verify the system's integrity:

```bash
# 1. Verify agent scoring, rank ladder, deduplication, and XP payout
npx tsx scratch/agents-check.ts

# 2. Verify Beru's URL resolution, brief formatting, and source checks
npx tsx scratch/beru-check.ts

# 3. Verify The Steward's time gates, anomaly rules, number validator, and fallback
npx tsx scratch/steward-check.ts

# 4. TypeScript typecheck
node node_modules/typescript/bin/tsc --noEmit

# 5. Deno Edge Functions typecheck
node node_modules/typescript/bin/tsc -p scratch/denocheck/tsconfig.beru.json --noEmit
```
