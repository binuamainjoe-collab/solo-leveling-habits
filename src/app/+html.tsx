import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { palette } from '@/constants/theme';

/**
 * The web page around the app. Runs only while the page is being built, so
 * there is no browser here.
 *
 * The first part stops a phone treating this as a website: no grey flash on
 * tap, no double-tap delay, no pull-to-refresh or swipe-back fighting our own
 * gestures, no zoom when an input takes focus, and paint under the notch.
 * Zoom itself stays allowed, because some people need it.
 *
 * Then the small pieces that live on Today: the streak flame, XP pouring into
 * its tube and the day's first opening. All of it is transform and opacity
 * only, which the browser runs on its own, and reduced motion stills it. The
 * flame is the one loop, and it pauses when it can't be seen or on Low power.
 *
 * The last part is scroll motion. Things rise and brighten as they arrive
 * and sink back as they leave. It is CSS tied to the scroll position, so the
 * browser runs it away from the app's main thread and it cannot stutter when
 * React is busy. Browsers without it simply show everything in place.
 */
const CSS = `
html {
  -webkit-tap-highlight-color: transparent;
  -webkit-text-size-adjust: 100%;
  overscroll-behavior: none;
  background: ${palette.bg};
}
body { overscroll-behavior: none; background: ${palette.bg}; }
/* Clips burst effects and the like, which would otherwise widen a phone's page. */
#root { overflow: clip; }
button, a, [role="button"], [role="tab"] {
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
@media (pointer: coarse) {
  input, textarea, select { font-size: 16px !important; }
}
@media (prefers-reduced-motion: no-preference) {
  /* A press pushes a button down into the page: it sinks a pixel and a half,
     shrinks a hair and darkens a touch, at once. Let go and it rises back a
     little slower, so the release is felt too. */
  [role="button"] {
    transition: transform 180ms cubic-bezier(0.23, 1, 0.32, 1), filter 180ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  [role="button"]:active { transform: translateY(1.5px) scale(0.97); filter: brightness(0.9); transition-duration: 70ms; }

  /* A screen's big heading, word by word, the first time it is seen in a
     session (src/components/motion/WordReveal.tsx): each word rises a
     little and fades in, 60ms after the one before. */
  @keyframes word-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  [data-word] { display: inline-block; animation: word-in 600ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  [data-word="1"] { animation-delay: 60ms; }
  [data-word="2"] { animation-delay: 120ms; }
  [data-word="3"] { animation-delay: 180ms; }
  [data-word="4"] { animation-delay: 240ms; }
  [data-word="5"] { animation-delay: 300ms; }
  [data-word="6"] { animation-delay: 360ms; }
  [data-word="7"] { animation-delay: 420ms; }
  [data-word="8"] { animation-delay: 480ms; }
  [data-word="9"] { animation-delay: 540ms; }
  [data-word="10"] { animation-delay: 600ms; }
  [data-word="11"] { animation-delay: 660ms; }

  /* The streak flame. Three tongues at three paces, so it never reads as a loop. */
  @keyframes sys-lick {
    0%, 100% { transform: scale(1, 1); }
    25% { transform: translateX(-2%) scale(0.96, 1.06); }
    50% { transform: scale(1.03, 0.95); }
    75% { transform: translateX(2%) scale(0.98, 1.03); }
  }
  [data-flame] { transform-origin: 50% 100%; animation: sys-lick 2.4s ease-in-out infinite; }
  [data-flame="mid"] { animation-duration: 1.7s; animation-delay: -0.6s; }
  [data-flame="core"] { animation-duration: 1.15s; animation-delay: -0.3s; }

  /* XP pouring into the tube: the fire rushes along three bands, slows and
     fades, and the tube is still again. It plays once per pour, never on a loop. */
  @keyframes sys-pour {
    from { transform: none; opacity: 1; }
    65% { opacity: 1; }
    to { transform: translateX(120px); opacity: 0; }
  }
  [data-flow] {
    background-image: linear-gradient(90deg, rgba(255,241,218,0) 0%, rgba(255,241,218,0.3) 50%, rgba(255,241,218,0) 100%);
    background-size: 40px 100%;
    animation: sys-pour 1.2s cubic-bezier(0.23, 1, 0.32, 1) both;
  }

  /* A flame on a page you can't see, or with Low power on, holds still. */
  [data-flame][data-rest] { animation-play-state: paused; }

  /* The next quest on the Planner's clock, when it is close: one ring swells
     off it and fades, then a long rest, like sonar. The one pulse the app
     keeps, because it was asked for as the warning: only ever one quest,
     only in the 45 minutes before it, every 8s while it is a way off and
     every 3s in its last quarter hour. Each ping takes the same 1.2s.
     Reduced motion, a page you can't see or Low power leave the ring
     standing still around it instead. */
  @keyframes sys-ping-far {
    0% { transform: scale(1); opacity: 0.7; }
    15%, 100% { transform: scale(1.8); opacity: 0; }
  }
  @keyframes sys-ping-near {
    0% { transform: scale(1); opacity: 0.7; }
    40%, 100% { transform: scale(1.8); opacity: 0; }
  }
  [data-ping="far"] { animation: sys-ping-far 8s cubic-bezier(0.23, 1, 0.32, 1) infinite; }
  [data-ping="near"] { animation: sys-ping-near 3s cubic-bezier(0.23, 1, 0.32, 1) infinite; }
  [data-ping][data-rest] { animation: none; }

  /* Beerus's window unrolls down from the top as he flies up to it, a beat
     behind him so he arrives first. Opened a few times a day, so it gets a
     drawer's curve and stays under 400ms. */
  @keyframes sys-unroll { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
  [data-unroll] { animation: sys-unroll 380ms cubic-bezier(0.32, 0.72, 0, 1) 90ms both; }

  /* Big moments (src/components/moments/Ceremonies.tsx). Each part plays as it
     mounts, at the step its ceremony puts it on. Arrivals use the strong
     ease-out; only the forging of a new rank overshoots, because a rank is the
     biggest moment there is. The flash happens once, well under the limit of
     three flashes a second. */
  @keyframes cer-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes cer-rise { from { opacity: 0; transform: translateY(14px) scale(0.97); } to { opacity: 1; transform: none; } }
  @keyframes cer-flash { 0% { opacity: 0; } 18% { opacity: 0.5; } 100% { opacity: 0; } }
  @keyframes cer-burn { to { opacity: 0; transform: scale(1.14); filter: brightness(2.2) blur(3px); } }
  @keyframes cer-forge {
    0% { opacity: 0; transform: scale(1.3); filter: brightness(2.4); }
    55% { opacity: 1; transform: scale(0.96); filter: brightness(1.3); }
    100% { opacity: 1; transform: none; filter: none; }
  }
  @keyframes cer-wave { from { opacity: 0.8; transform: scale(0.4); } to { opacity: 0; transform: scale(2.6); } }
  /* A shake that dies away, not a jitter: each swing smaller than the last. */
  @keyframes cer-shake {
    0%, 100% { transform: none; }
    20% { transform: translate(-4px, 2px); }
    40% { transform: translate(3px, -2px); }
    60% { transform: translate(-2px, 1px); }
    80% { transform: translate(1px, -1px); }
  }
  @keyframes cer-ignite {
    0% { opacity: 0; transform: scale(0.5) rotate(-20deg); }
    45% { opacity: 1; transform: scale(1.2) rotate(6deg); }
    100% { opacity: 1; transform: none; }
  }
  [data-cer="in"] { animation: cer-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both; }
  [data-cer="rise"] { animation: cer-rise 380ms cubic-bezier(0.23, 1, 0.32, 1) both; }
  [data-cer="flash"] { animation: cer-flash 420ms cubic-bezier(0.23, 1, 0.32, 1) both; }
  [data-cer="burn"] { animation: cer-burn 380ms cubic-bezier(0.23, 1, 0.32, 1) both; }
  [data-cer="forge"] { animation: cer-forge 460ms cubic-bezier(0.23, 1, 0.32, 1) both; }
  [data-cer="wave"] { animation: cer-wave 640ms cubic-bezier(0.23, 1, 0.32, 1) both; }
  [data-cer="shake"] { animation: cer-shake 300ms linear both; }
  [data-cer="ignite"] { animation: cer-ignite 560ms cubic-bezier(0.23, 1, 0.32, 1) both; }

  /* A boss Gate (src/components/moments/FocusGate.tsx), on the browser's own
     view transition. Going in, the new view opens through a ring that grows
     from the Gate button while the board dives in after it; coming out, the
     Gate closes back down to the button, faster than it opened. */
  @keyframes gate-open {
    from { clip-path: circle(0px at var(--gate-x) var(--gate-y)); }
    to { clip-path: circle(150vmax at var(--gate-x) var(--gate-y)); }
  }
  @keyframes gate-dive { to { transform: scale(1.2); opacity: 0.5; } }
  @keyframes gate-close {
    from { clip-path: circle(150vmax at var(--gate-x) var(--gate-y)); }
    to { clip-path: circle(0px at var(--gate-x) var(--gate-y)); }
  }
  @keyframes gate-return { from { transform: scale(1.1); opacity: 0.6; } to { transform: none; opacity: 1; } }
  html[data-gate]::view-transition-old(root),
  html[data-gate]::view-transition-new(root) { mix-blend-mode: normal; transform-origin: var(--gate-x) var(--gate-y); }
  html[data-gate="in"]::view-transition-old(root) { animation: gate-dive 480ms cubic-bezier(0.77, 0, 0.175, 1) both; }
  html[data-gate="in"]::view-transition-new(root) { animation: gate-open 480ms cubic-bezier(0.77, 0, 0.175, 1) both; }
  html[data-gate="out"]::view-transition-old(root) { z-index: 2; animation: gate-close 380ms cubic-bezier(0.77, 0, 0.175, 1) both; }
  html[data-gate="out"]::view-transition-new(root) { animation: gate-return 380ms cubic-bezier(0.23, 1, 0.32, 1) both; }

  /* The day's first open: a seam of light, then the dark parts like a gate. */
  @keyframes sys-part-up { 0%, 26% { transform: none; } 100% { transform: translateY(-101%); } }
  @keyframes sys-part-down { 0%, 26% { transform: none; } 100% { transform: translateY(101%); } }
  @keyframes sys-seam {
    0% { opacity: 0; transform: scaleX(0.12); }
    26% { opacity: 1; transform: scaleX(1); }
    100% { opacity: 0; transform: scaleX(1); }
  }
  [data-open="top"] { animation: sys-part-up 520ms cubic-bezier(0.77, 0, 0.175, 1) both; }
  [data-open="bottom"] { animation: sys-part-down 520ms cubic-bezier(0.77, 0, 0.175, 1) both; }
  [data-open="seam"] { animation: sys-seam 520ms cubic-bezier(0.23, 1, 0.32, 1) both; }
  [data-open][data-late] { animation-delay: 280ms; }
}
/* With motion turned down a press still answers, by darkening, not moving. */
@media (prefers-reduced-motion: reduce) {
  [role="button"]:active { filter: brightness(0.9); }
}
/* View transitions play instantly for anyone who turns motion down. */
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*),
  ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    @keyframes sys-rise {
      from { opacity: 0; transform: translateY(30px) scale(0.93); }
      to { opacity: 1; transform: none; }
    }
    @keyframes sys-leave {
      to { opacity: 0.35; transform: translateY(-12px) scale(0.975); }
    }
    @keyframes sys-brighten {
      from { opacity: 0.2; transform: translateY(16px); }
      to { opacity: 1; transform: none; }
    }
    [data-reveal] {
      animation: sys-rise linear both, sys-leave linear forwards;
      animation-timeline: view(), view();
      animation-range: entry 0% entry 70%, exit 40% exit 100%;
    }
    [data-reveal="1"] { animation-range: entry 8% entry 78%, exit 40% exit 100%; }
    [data-reveal="head"] {
      animation: sys-brighten linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 85%;
    }
    [data-fill-line] {
      animation: sys-fill linear both;
      animation-timeline: view();
      animation-range: cover 10% cover 70%;
      transform-origin: top center;
    }
    @keyframes sys-fill { from { transform: scaleY(0); } to { transform: scaleY(1); } }

    /* The Status page's camera flight (src/app/(tabs)/hunter.tsx). Each
       chapter's object, the burning seal and the crystal, comes up out of
       the distance as its chapter scrolls in, settling as it arrives, and
       flies past the camera as it leaves, while the cards travel with the
       page. Tied to the scroll, so the finger is the clock: it runs on the
       compositor and stops the moment the scroll does. */
    @keyframes fly-near {
      from { opacity: 0.15; transform: translateY(16%) scale(0.72); }
      to { opacity: 1; transform: none; }
    }
    @keyframes fly-past {
      to { opacity: 0; transform: translateY(-6%) scale(1.16); }
    }
    [data-fly] {
      animation: fly-near cubic-bezier(0.33, 1, 0.68, 1) both, fly-past linear forwards;
      animation-timeline: view(), view();
      animation-range: entry 0% cover 42%, exit 25% exit 100%;
    }
  }
}
/* The line down the Status page's right edge fills with the page's own
   scroll. It says where you are, so it stays with reduced motion too. Where
   a browser cannot tie it to the scroll, it steps from chapter to chapter. */
@supports (timeline-scope: --status) {
  [data-status-root] { timeline-scope: --status; }
  [data-status-scroll] { scroll-timeline: --status block; }
  @keyframes rail-fill { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  [data-rail-fill] { animation: rail-fill linear both; animation-timeline: --status; }
}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="theme-color" content={palette.bg} />
        <meta name="color-scheme" content="dark" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
