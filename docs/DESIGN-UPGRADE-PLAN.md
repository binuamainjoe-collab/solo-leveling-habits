# Design upgrade plan: phone audit, references, and build order

Audited 2026-11-18 at phone size (375 x 812) on a fresh profile, using screenshots of all five tabs plus a script that measured every element on screen.
House rule throughout: every screen, card, chart and button stays where it is. The fix is in how they are drawn, not where they are.

## 1. Measured, not guessed

Counted by script across the screens loaded in the phone view (Quests plus the tabs kept ready beside it):

| What | Found | What a top-tier app does | Verdict |
|---|---|---|---|
| Text in grey | **296 of 522 words (57%)** | Most words are the main text colour; grey is for the odd label | ❌ More than half of what you read is captions |
| Small print (13 px or less) | **192 of 300 text pieces (64%)** | Body text at 15-17 px; small print for metadata only | ❌ The screen reads as fine print |
| Text colours | **13** | 3-4 (main, secondary, accent, maybe one status colour) | ❌ No clear hierarchy |
| Bordered boxes | **38**, **7 of them inside another box** | Separation by spacing and a change of surface; few or no outlines | ❌ The "AI dashboard" look |
| Corner roundings | **8 different** (5, 8, 16, 22, 26, 90 px, pills, square) | 2-3 radii, used by rule | ❌ Shapes don't match |
| Buttons under 44 px | **33 of 71** | Every tap target at least 44 x 44 (Apple's rule) | ❌ Day dots, chart bars and "2 wk/30 d" are fiddly on a phone |
| Solid orange fills | **22** | One loud colour, on the one next action | ❌ Orange stops meaning "do this" |
| Faint text contrast | `#6F6157` on `#1B1511` = **3.0 : 1** | 4.5 : 1 minimum for small text | ❌ Hard to read outdoors |

The detector Impeccable ships found 0 issues. It reads web HTML, so it can't see React Native screens. Every number above comes from the measuring script, not from that tool.

## 2. What it looks like on the phone, screen by screen

**Quests**
- The greeting wraps over three lines ("Good / evening, / Hunter") because the % ring takes the right half of a 375 px screen.
- The hero card holds a second bordered card (the next quest), which holds two buttons.
- Seven grey day dots with flame icons are 24 px each: tiny, low contrast, and every one is a tap target.
- The quest grid has nine orange "+" squares on muddy art. The chip, XP, title, counter and button are crammed into a tile about 170 px wide.
- Momentum, Consistency, This week and Today's plan all use the same card template: icon tile, bold title, grey sentence explaining how to read it. On day 1 they are all empty (a flat line, 56 grey squares, "No timeline yet").

**Planner**
- 9 icon circles, two colours of arc, a planet, a clock, hour labels and a "0 of 9 done" all share one ring. On a phone they blur together.
- The Morning/Noon/Evening rows are three more bordered cards, each with an empty bar.

**Goal**
- A heading and a bare form. Nothing to look at until a goal is set: no sense of what you'll get.

**Collection**
- A stats strip, 7 filter pills and 2 switches come before the first card: four rows of controls before content.
- The carousel shows three "Undiscovered" placeholders, so the first impression is "locked".
- The ALL CAPS "COLLECTION" heading doesn't match "Goals" and "Planner".

**Status**
- The crystal's six faces use six colours (red, green, orange, blue, violet, gold) that fight the ember theme.
- Six rows of "Strength 10" with a big coloured number each. Every row shouts equally.

**Everywhere**
- Beerus sits over the bottom-right corner on every tab, covering buttons and numbers.
- Every section starts with the same icon-in-a-square tile. Identical headers at every level are the strongest "generated" tell.

## 3. Notes from Apple

Sources: the `apple-design` skill (Apple's WWDC talks, chiefly *Designing Fluid Interfaces*) and Apple's long-standing iPhone guidelines. apple.com was blocked from this session, so I couldn't re-check those pages today.

1. **One type family, hierarchy from size and weight.** A screen leans on 3-4 styles: Large Title 34, Headline 17 semibold, Body 17, Footnote 13. Body text is never 13.
2. **Tap targets are at least 44 x 44 pt**, even when the visible dot is smaller. Grow the touch area, not the drawing.
3. **Separate with space and surface, not lines.** Grouped content sits on a slightly lighter surface; outlines are a last resort.
4. **One margin, everywhere:** 16-20 pt at the sides, spacing in steps of 4 or 8.
5. **Full-bleed backgrounds, inset text.** Images and colour run to the screen edges; words and buttons keep the margin.
6. **Feedback on press, not on release.** The app already does this (buttons sink on touch). Keep it.
7. **One hero per screen.** Fitness leads with the rings and App Store Today with one big card. Everything else is quieter.
8. **Restraint.** Few colours, few shapes, and nothing decorative that doesn't do something. This matches your own rule that every element must work.

## 4. Notes from Netflix

Netflix has published no mobile design spec (its Hawkins design system is internal), so these are patterns anyone can see in its app, not quoted rules.

1. **The artwork is the interface.** Tiles are pictures with no border, no box and no grey caption, on a near-black page that gives the art nothing to compete with.
2. **One cinematic hero at the top:** full-width art fading into the page under a dark gradient, the title set big *on* the art, and two buttons (one solid, one quiet).
3. **Rows, not grids of boxes.** Horizontal rows where the next tile peeks in at the edge, so you know to swipe.
4. **Never empty.** A new account still sees full rows ("Popular", "Because you watched…"). The page never shows a blank chart.
5. **One solid button.** "Play" is the only solid white button; everything else is an outline or an icon.
6. **Labels are tiny and few.** A row title, then pictures. Nothing tells you how to read a row.

## 5. What this means for your app (keeping every screen and button)

| Fix | Apple / Netflix note behind it | Screens |
|---|---|---|
| **Ink, not boxes.** Remove the outline from cards; separate sections with 32 px of space and a slightly lighter surface. No card inside a card. | Apple 3, Netflix 1 | All |
| **One type scale.** Large title 34, title 22, headline 17, body 15-17, footnote 13. Body text never drops to 13. Greeting on one line. | Apple 1 | All |
| **Three text colours.** Cream for reading, muted for labels, ember for the one action. Faint text lifted to at least 4.5 : 1. | Apple 8 | All |
| **One solid orange per screen.** Only the next quest's button is solid; the other quest buttons become quiet outlines. | Netflix 5 | Quests, Planner |
| **Quest tiles as artwork.** Art runs to the tile's edge with a dark fade at the bottom; title and counter sit on the art; no chip box. | Netflix 1-2 | Quests grid, group sheets |
| **Hero as a poster.** The Quests hero gets full-bleed art behind it, a one-line greeting, and the % ring as the one big figure. | Netflix 2, Apple 7 | Quests |
| **Captions only on request.** The "how to read this chart" sentences are removed and shown on a long press or an ⓘ. | Netflix 6 | Quests, Status |
| **Designed day-1 states.** Empty charts show a shaped preview ("Your first week fills in here") instead of grey squares and flat lines. | Netflix 4 | Quests, Planner, Goal, Collection |
| **44 px touch areas.** Day dots, chart bars and small toggles get bigger touch areas; how they look stays the same. | Apple 2 | Quests, Status |
| **Two corner sizes.** 22 px for big surfaces, 12 px for small; pills only for chips. | Apple 8 | All |
| **Controls collapse.** Collection's filters become one scrolling row under the carousel, so the cards come first. | Netflix 3 | Collection |
| **Ember shades for data.** The crystal and ability scores use ember tones, with one colour for the weakest ability. | Apple 8 | Status |
| **Beerus gets a parking spot.** He rests just above the tab bar, never over content. | Apple 4 | All |

## 6. Notes from games and Instagram

- **Games (gacha pulls in Genshin / Star Rail, Persona 5 menus):** a level-up *stops the world*: letterbox bars, a white flash, slow motion, then a slam. Menus use diagonal cuts, very large type and two colours at full contrast.
- **Instagram:** content goes edge to edge. Feedback is one icon doing one big thing (the double-tap heart). Chrome stays thin and quiet.

## 7. The level-up "RELEASE" cinematic (built, not live)

You chose an original anime cinematic and the shout **RELEASE**. Bleach footage or a drawing of Ichigo can't go in the app, because both are copyrighted and the app is on the web. So the cinematic uses the same anime grammar with an original hooded hunter in ember ink.

| Time | Beat |
|---|---|
| 0.0 s | Letterbox bars slam in and the app drains to ink-black. A rush of air starts climbing. |
| 0.3 s | Speed lines rush in, redrawn on 4s like hand-drawn animation. The hunter rises out of the fire, ember cracks across the coat, eyes lit. |
| 1.1 s | Impact frame: two frames inverted, a shake that dies away, a crack and a deep drop in the sound. RELEASE slams in letter by letter while a ring of fire and sparks blows out. |
| 1.56 s | "LEVEL 7" stamps in, with the number rolling up. |
| 2.4 s | The bars pull away, "XP to level 8" rises, and the app comes back. A tap skips at any point. |

- With reduced motion it shows a still frame: no speed lines, no flash, no shake.
- It plays on level-ups only; rank-ups keep their bigger forge ceremony.
- Code is in `src/components/moments/Release.tsx`, the CSS is in `src/app/+html.tsx`, and the sound is `releaseSound` in `src/lib/ceremonySound.ts`.

## 8. Order of work

1. ✅ **RELEASE cinematic**: built, checked against the motion audit, waiting for your phone test.
2. ✅ **Quests screen** (the one you open most), built 2026-11-18, waiting for your phone test:
   - **Hero:** the greeting gets the full width on phones (one line), no outline, and the next quest is no longer a box inside it (a hairline instead). The "Next mandatory quest" label moved into the line under the title.
   - **Quest tiles:** the art shows clear at the top and fades to dark under the words; the category is a plain word, not a boxed chip; only the next quest's button is solid ember, the rest are frosted.
   - **Panels everywhere:** no outline and no icon tile. How to read a chart sits behind an ⓘ (This week, Consistency, Ability scores).
   - **Day 1:** Momentum and Consistency step back with one line on what fills them.
   - **Touch and contrast:** the day dots get a 44 px touch area, and the faint grey is lifted from 3.0 : 1 to 4.6 : 1.
   - **Measured after:** bordered boxes 38 → 18, boxes inside boxes 7 → 0, solid orange fills 22 → 12.
   - **Not done on purpose:** a full-bleed poster image behind the hero. The only art in the app is the quest-card art, which raises the problem below.

3. ✅ **One original art set for the quest cards** (2026-11-18). The 15 card pictures were in 15 different styles, so the board never looked like one app. They are now one hand: the app's own hooded hunter as an ink silhouette, rim-lit by ember light, one scene per quest type:
   - water: dawn lake · pushup: plank across the rising sun · power: pull-up on an old branch
   - statue: boulder overhead, red sun · study: lamp-lit desk, moon in the window · read: under a tree, the book glowing
   - focus: rooftop over the city at night · resolve: summit in the wind, staff planted · storm: leaning into rain and lightning
   - burden: rock up a slope · fire: hammer and anvil, sparks · mastery: high kick at sunset
   - bonds: two hunters by a campfire · dusk: a small figure on a ridge at first light · sleep: asleep by the embers under a crescent moon

   Every scene is built the same way: a sky, one light, hazy ridges that darken toward you, the rim-lit hunter, embers, film grain and a vignette. The hunter always sits in the top half, which is what a card shows above its title. It is drawn in code by `scratch/card-art.ts` and saved over `assets/cards/*.jpg`, so `src/data/cardArt.ts` didn't change. To redraw, run `npx tsx scratch/card-art.ts <dir>`, then render each SVG to JPG at 520 x 650 (x1.25).
3. ✅ **App-wide pass** on Planner, Goal, Collection and Status (2026-11-18):
   - **Outlines gone:** switches, sheets, plan cards, chips, Body/Mind/Life rings, the To do/Done pills, Goal's cards, and Status's header and buttons. Selection now shows as a soft fill.
   - **Orange kept for the main action:** selected switches are a neutral raised fill, not solid orange, and the Status toggles are green when on.
   - **Labels:** the "Planner" eyebrow is gone, and Status's section labels are real titles. Tags and filters are sentence case.
   - **How-to text:** the Planner's long instructions sit behind "How it works".
   - **Touch areas:** chips, switches and calendar days are 44 px.
   - **Kept as it was:** the week-view rows (44 px would overflow the 7-row layout), the collectible card frames, and the Goal screen's layout.
4. **Collection, Planner, Status cleanup**: filters under the carousel, quieter clock icons with only the next quest lit, ember crystal.
5. **Beerus's parking spot** above the tab bar.

Every step goes through the design and motion audits (design-motion-principles, game-feel, Emil's standards) and gets a phone test link. Nothing goes live without your go-ahead.

## 9. Skills used

must-skills → using-agent-skills (plan, then build in small slices), impeccable (critique and craft floor), frontend-design, apple-design, game-ui-design, game-feel, peak-end-rule, expo-animation, emil-design-eng, design-motion-principles, mobile-native.
