# The System — a Solo Leveling self-improvement tracker

A habit tracker styled as the System's holographic interface: quests instead of
habits, XP and ability scores instead of checkmarks, and an achievement fanfare
when you cross a threshold.

One Expo codebase ships to **web (desktop + mobile browser)** and to **iOS /
Android**.

```bash
npm run web     # website at http://localhost:8081
npm start       # dev server; scan the QR with Expo Go for the phone build
```

> On this machine Node isn't on `PATH`. Prefix commands with
> `$env:Path = "C:\Program Files\nodejs;" + $env:Path` in PowerShell, or use
> `& "C:\Program Files\nodejs\npx.cmd"` directly.

## What's in it

| Screen | Route | What it does |
|---|---|---|
| **Quests** | `/` | Today's board, grouped by discipline, with the mandatory daily-quest warning |
| **Archive** | `/archive` | All 106 quests, filterable by discipline; accept one to add it to the board |
| **Trophies** | `/achievements` | 41 achievements across four tiers, with live progress on locked ones |
| **Status** | `/hunter` | Ability scores, lifetime record, discipline coverage, reset |

The route is `/hunter`, not `/status` — Metro's dev server serves its own
`/status` endpoint, which would shadow an app route of that name.

## The quest model

`src/data/quests.ts` holds 106 quests across eight disciplines — **body,
nutrition, mind, craft, discipline, care, social, wealth**. Each has a rank
(E→S), an XP reward, and ability-score gains (STR / AGI / VIT / INT / PER / SEN).

Five `kind`s decide which control the card renders. Adding a kind means adding a
branch in `QuestCard`:

| kind | Control | Example |
|---|---|---|
| `counter` | `−` / `+` stepper | Drink 8 glasses of water |
| `duration` | stepper in minute increments | Study for 120 minutes |
| `value` | stepper at 10% of target | Hit 150g of protein |
| `binary` | whole card toggles | Complete your evening skincare |
| `window` | whole card toggles, shows the clock window | In bed before 23:00 |

Three `value` quests are **ceiling** quests — you stay *under* the target rather
than clearing it (calories, screen time, social media). `isCeilingQuest` in
`src/store/progress.tsx` lists them.

Quests carrying a `penalty` form the mandatory daily set, which drives the
warning panel on the board.

## Achievements

`src/data/achievements.ts`. Four tiers (bronze → mythic) drive frame colour,
shimmer and the size of the particle burst. Seven `track` types measure
progress; each needs a branch in `achievementProgress`.

Unlocks are computed **inside the state transition that earns them**, not in an
effect — evaluating them in an effect cascades renders (React's
`set-state-in-effect` rule catches this). Two paths exist:

- `applyUnlocks` — live progress: records the unlock *and* queues its fanfare.
- `absorbUnlocks` — app launch and reset: records unlocks *without* queueing, so
  a returning hunter isn't greeted by every trophy they earned last week.

Secret achievements never show a progress bar; a hidden objective that displays
`215 / 1` gives itself away.

## Design language

The visual system mirrors **Life Reset: 66 Day Habit**. Its character, and the
rules to keep if you extend the UI:

| | |
|---|---|
| Ground | `#0A0A0B` near-black, faintly warm |
| Surface | `#17171A` cards, `#232327` nested boxes |
| Accent | `#FF6A00` at full saturation — **one or two elements per screen**, no more |
| Text | `#F3EDE3` warm cream, never `#FFF` — this is what stops it reading cold |
| Radius | 16px cards · 12px inner boxes · pill chips and buttons |
| Type | Anton (hero caps) · Archivo Black (numerals) · Outfit (everything else) |

Four signature moves worth preserving:

1. **Segmented XP meter** — discrete blocks that light left-to-right, not a
   smooth bar (`StatusHeader`).
2. **Solid orange level block** — the loudest thing on any screen.
3. **Giant right-aligned numerals** with a tiny caps label on the left; the
   number is the hero, the label is furniture (`hunter.tsx` ability scores).
4. **Art under a scrim** — every card carries an illustration, knocked back by
   a flat overlay plus a left-heavy gradient so the copy column stays legible
   while the art breathes on the right (`Card`).

Artwork lives in `assets/cards/` and is wired up in `src/data/cardArt.ts`:
`QUEST_ART` pins images to specific quests where the subject genuinely matches
(Luffy drinking → water, Goku push-up → push-ups), and `CATEGORY_ART` supplies
a rotating pool for everything else so neighbouring cards differ. The images
are third-party fan art — fine personally, but they need licensing thought
before this ships anywhere public.

## Layout

`src/components/system/Screen.tsx` centres a measured column (max 1120px) and
reports the column count: 1 below 760px, 2 from 760, 3 from 1180. Quest,
archive and trophy grids all read from it.

The tab bar stays docked at the bottom on every size — this navigator has no
option to reposition it, and a bottom HUD strip suits the System's look on
desktop too. Past the breakpoint its triggers stop stretching and centre.

## Notes for anyone extending it

- **Dark only, deliberately.** `src/constants/theme.ts` has no light palette.
- **Never nest pressables.** `accessibilityRole="button"` on a `View` renders a
  real `<button>` in react-native-web, so a wrapper inside `RectButton`
  produces invalid `<button>` in `<button>`. Put a11y props on the button
  component itself. This is why only *toggle* quests make the whole card
  pressable — stepper quests keep their controls separate.
- **Entering animations are duration-based, not `.springify()`.** Spring layout
  animations are unsupported on web.
- **Progress bars animate `scaleX` with `transformOrigin`**, never `width` —
  animating width forces a layout pass every frame.
- **Reanimated 4 has no `runOnJS`.** Use `scheduleOnRN` from
  `react-native-worklets`.
- Horizontal `ScrollView`s inside a flex column get squeezed until their
  children clip; the filter rows use wrapping `View`s instead.

## Demo data

`demoSeed()` in `src/store/progress.tsx` gives a cold start something to show —
a level-8 hunter, a 12-day streak, 16 unlocked trophies, partially-filled
quests. **It is not real progress.** For a clean slate, delete `demoSeed` and
the spread that uses it in `initialState()`, then clear stored state (the
Status screen's *Reset all progress* does the same thing at runtime).

Progress persists to `AsyncStorage` under `system.progress.v1` — `localStorage`
on web. The fanfare queue is stripped before saving so a reload never replays
old unlocks.

## Stack

Expo SDK 57 · React Native 0.86 · React 19 · Expo Router · Reanimated 4.5 ·
Gesture Handler 2.32 · TypeScript 6. Fonts are Orbitron (display), Rajdhani
(body) and Share Tech Mono (readouts).
