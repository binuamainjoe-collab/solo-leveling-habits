import { useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { flightPath, type Box } from '@/lib/flourish';

/** Somewhere a cleared quest can fly to. */
export type FlightTarget = 'ring';

const targets = new Map<FlightTarget, HTMLElement>();
const inAir = new Map<FlightTarget, number>();
const watchers = new Set<() => void>();
const landers = new Set<(target: FlightTarget) => void>();

function notify() {
  for (const w of watchers) w();
}

function bump(target: FlightTarget, by: number) {
  inAir.set(target, Math.max(0, (inAir.get(target) ?? 0) + by));
  notify();
}

function subscribe(fn: () => void) {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

/** Where flights to `name` land. Pass null when it unmounts. */
export function setFlightTarget(name: FlightTarget, node: HTMLElement | null) {
  if (node) targets.set(name, node);
  else targets.delete(name);
}

/** Runs `fn` each time something lands. Returns the way to stop. */
export function onLanding(fn: (target: FlightTarget) => void): () => void {
  landers.add(fn);
  return () => {
    landers.delete(fn);
  };
}

const box = (r: DOMRect): Box => ({ x: r.left, y: r.top, width: r.width, height: r.height });

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
const DOCK = 64;
const DOCK_R = 26;
const DOCK_C = 2 * Math.PI * DOCK_R;
/** How long the stand-in ring stays after the last landing before it fades. */
const DOCK_STAY_MS = 900;
/** How long it stays when a big moment is waiting for it: just long enough to see it fill. */
const DOCK_HURRY_MS = 600;
/** Matches the real ring's fill. */
const FILL = '520ms';

let dock: {
  el: HTMLElement;
  arc: SVGCircleElement;
  head: SVGGElement;
  label: HTMLElement;
  leave?: ReturnType<typeof setTimeout>;
  landedAt?: number;
} | null = null;
/** Stand-ins on the screen, counting one still fading out. */
let docks = 0;
/** Whether the stand-in should leave as soon as it has filled. */
let hurry = false;

const percent = (r: number) => `${Math.round(Math.max(0, Math.min(1, r)) * 100)}%`;

/**
 * A small copy of the ring that drops in at the top of the screen when the real
 * one is scrolled away, so a card cleared far down the board still has
 * somewhere you can see it land. Returns where to aim.
 */
function openDock(ring: DOMRect, before: number): Box {
  const left = Math.min(Math.max(ring.left + ring.width / 2 - DOCK / 2, 12), window.innerWidth - DOCK - 12);
  if (dock?.el.isConnected) {
    clearTimeout(dock.leave);
    dock.el.style.transform = 'none';
  } else {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      `position:fixed;left:${left}px;top:calc(env(safe-area-inset-top, 0px) + 14px);width:${DOCK}px;height:${DOCK}px;` +
      'z-index:61;pointer-events:none;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(27,21,17,.94);box-shadow:0 10px 26px rgba(0,0,0,.5),0 0 0 1px rgba(255,165,82,.22);' +
      `transform:translateY(-${DOCK + 40}px);transition:transform 280ms ${EASE};` +
      "color:#F7ECDF;font:15px 'Outfit_700Bold',system-ui;font-variant-numeric:tabular-nums";
    const offset = DOCK_C * (1 - Math.max(0, Math.min(1, before)));
    const turn = Math.max(0, Math.min(1, before)) * 360;
    // The same groove, ember gradient and hot point as the ring it stands in for.
    el.innerHTML =
      `<svg width="${DOCK}" height="${DOCK}" style="position:absolute;inset:0">` +
      '<defs><linearGradient id="dock-ember" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#FFB061"/><stop offset="1" stop-color="#C93E16"/></linearGradient></defs>' +
      `<circle cx="32" cy="32" r="${DOCK_R}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="7"/>` +
      `<circle cx="32" cy="32" r="${DOCK_R + 2.9}" fill="none" stroke="rgba(247,236,223,.1)" stroke-width="1.2"/>` +
      `<circle cx="32" cy="32" r="${DOCK_R}" fill="none" stroke="url(#dock-ember)" stroke-width="7" stroke-linecap="round" ` +
      `stroke-dasharray="${DOCK_C} ${DOCK_C}" transform="rotate(-90 32 32)" ` +
      `style="stroke-dashoffset:${offset};opacity:${before > 0 ? 1 : 0};transition:stroke-dashoffset ${FILL} ${EASE},opacity 200ms"/>` +
      `<g style="transform:rotate(${turn}deg);transform-origin:32px 32px;opacity:${before > 0 ? 1 : 0};transition:transform ${FILL} ${EASE},opacity 200ms">` +
      '<circle cx="32" cy="6" r="5.5" fill="rgba(255,165,82,.22)"/><circle cx="32" cy="6" r="2.4" fill="#FFF1DA"/></g>' +
      '</svg><span style="position:relative"></span>';
    const label = el.querySelector('span') as HTMLElement;
    label.textContent = percent(before);
    document.body.appendChild(el);
    docks += 1;
    notify();
    dock = { el, arc: el.querySelectorAll('circle')[2], head: el.querySelector('g') as SVGGElement, label };
    // Read once so the slide starts from above the screen.
    void el.offsetHeight;
    el.style.transform = 'none';
  }
  const r = dock.el.getBoundingClientRect();
  // Aim where it is heading, not where it is mid-slide.
  const shift = new DOMMatrix(getComputedStyle(dock.el).transform).m42;
  return { x: r.left, y: r.top - shift, width: r.width, height: r.height };
}

function landInDock(after: number) {
  if (!dock) return;
  const { el, arc, head, label } = dock;
  const share = Math.max(0, Math.min(1, after));
  arc.style.opacity = head.style.opacity = after > 0 ? '1' : '0';
  arc.style.strokeDashoffset = String(DOCK_C * (1 - share));
  head.style.transform = `rotate(${share * 360}deg)`;
  label.textContent = percent(after);
  el.animate([{ scale: '1' }, { scale: '1.1' }, { scale: '1' }], { duration: 460, easing: EASE });
  dock.landedAt = performance.now();
  clearTimeout(dock.leave);
  dock.leave = setTimeout(() => leaveDock(el), hurry ? DOCK_HURRY_MS : DOCK_STAY_MS);
}

function leaveDock(el: HTMLElement) {
  // Let go of it first, so a quest cleared while it fades gets a fresh one.
  if (dock?.el === el) dock = null;
  hurry = false;
  // It leaves quieter than it came: a short lift as it fades, not the full slide back.
  el.style.transition = `transform 220ms ${EASE},opacity 220ms ${EASE}`;
  el.style.transform = 'translateY(-10px)';
  el.style.opacity = '0';
  setTimeout(() => {
    el.remove();
    docks -= 1;
    notify();
  }, 240);
}

/**
 * A big moment is waiting: the stand-in ring goes as soon as it has shown
 * its fill, instead of resting, so the moment isn't kept waiting for it.
 */
export function hurryDock() {
  if (!dock) return;
  hurry = true;
  // Still in the air: it takes the short stay when it lands.
  if (dock.landedAt === undefined) return;
  const { el } = dock;
  clearTimeout(dock.leave);
  dock.leave = setTimeout(() => leaveDock(el), Math.max(0, dock.landedAt + DOCK_HURRY_MS - performance.now()));
}

/**
 * Sends a copy of `source` flying into `target`, where it burns down to an
 * ember on the way. The real element is left alone to leave the page however
 * it already does, under the copy. The copy is the page's own markup, so it
 * looks exactly like what you touched, and it moves on the compositor, so a
 * busy page can't make it stutter.
 *
 * When the ring is scrolled off screen, `before` and `after` (how full it was
 * and will be) let a small stand-in drop in at the top to catch it instead.
 *
 * Returns false when nothing flies (not the web, reduced motion, nothing to
 * aim at), so whatever waits for the landing can update straight away.
 */
export function fly(
  source: unknown,
  target: FlightTarget,
  { before, after, corner = 16 }: { before?: number; after?: number; corner?: number } = {},
): boolean {
  if (Platform.OS !== 'web' || !(source instanceof HTMLElement)) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const end = targets.get(target);
  if (!end?.isConnected) return false;
  const from = source.getBoundingClientRect();
  const ring = end.getBoundingClientRect();
  if (from.width < 1 || ring.width < 1) return false;
  const seen = (Math.min(ring.bottom, window.innerHeight) - Math.max(ring.top, 0)) / ring.height;
  const docked = seen < 0.5 && before !== undefined && after !== undefined;
  const path = flightPath(box(from), docked ? openDock(ring, before) : box(ring));

  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60;overflow:hidden;contain:strict';

  const card = source.cloneNode(true) as HTMLElement;
  // The copy must not pick up the scroll reveal, which has no scroller out here.
  card.removeAttribute('data-reveal');
  for (const el of card.querySelectorAll('[data-reveal]')) el.removeAttribute('data-reveal');
  card.style.cssText +=
    `;position:absolute;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;` +
    `margin:0;transform:none;border-radius:${corner}px;will-change:transform,opacity;` +
    'box-shadow:0 0 0 1px rgba(255,165,82,.45),0 14px 34px rgba(255,112,32,.3)';

  const ember = document.createElement('div');
  ember.style.cssText =
    `position:absolute;left:${path.start.x - 22}px;top:${path.start.y - 22}px;width:44px;height:44px;` +
    'border-radius:50%;opacity:0;will-change:transform,opacity;' +
    'background:radial-gradient(circle,#FFF1DA 0%,#FFA552 28%,rgba(255,112,32,.55) 52%,rgba(255,112,32,0) 72%)';

  layer.append(card, ember);
  document.body.appendChild(layer);
  bump(target, 1);

  const timing = { duration: path.duration, easing: 'linear', fill: 'forwards' as const };
  const run = card.animate(path.card as unknown as Keyframe[], timing);
  ember.animate(path.ember as unknown as Keyframe[], timing);

  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    layer.remove();
    if (docked) landInDock(after ?? 0);
    bump(target, -1);
    for (const fn of landers) fn(target);
  };
  run.finished.then(land, land);
  // A hidden tab holds animations back, and the ring must not wait for ever.
  setTimeout(land, path.duration + 400);
  return true;
}

/**
 * Whether anything is on its way to `target` right now, or the stand-in ring
 * it landed in is still on the screen, which sits above everything else.
 */
export function useAirborne(target: FlightTarget): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (inAir.get(target) ?? 0) > 0 || docks > 0,
    () => false,
  );
}

/**
 * `value`, held back while anything is flying to `target`, so what the flight
 * stands for arrives with it: the ring fills when the card lands, not before.
 */
export function useHeldWhileFlying<T>(value: T, target: FlightTarget): T {
  const airborne = useSyncExternalStore(
    subscribe,
    () => inAir.get(target) ?? 0,
    () => 0,
  );
  const [kept, setKept] = useState(value);
  if (airborne === 0 && !Object.is(kept, value)) setKept(value);
  return airborne > 0 ? kept : value;
}
