import { useSyncExternalStore } from 'react';

/**
 * Who has the stage. Big moments wait for the launch to settle (the breathing
 * screen and the day's opening), and the card and trophy reveals wait for a
 * big moment to finish, so two full-screen moments never play over each other.
 */
let settled = false;
let ceremony = false;
let focus = false;
const watchers = new Set<() => void>();

function tell() {
  for (const w of watchers) w();
}

function subscribe(fn: () => void) {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

/** The launch screens are done: the board is what is on screen now. */
export function settleLaunch() {
  if (settled) return;
  settled = true;
  tell();
}

export function setCeremony(on: boolean) {
  if (ceremony === on) return;
  ceremony = on;
  tell();
}

/** A boss Gate is open: you are focusing, so moments wait until you come out. */
export function setFocusOpen(on: boolean) {
  if (focus === on) return;
  focus = on;
  tell();
}

export function useFocusOpen(): boolean {
  return useSyncExternalStore(subscribe, () => focus, () => false);
}

export function useLaunchSettled(): boolean {
  return useSyncExternalStore(subscribe, () => settled, () => false);
}

export function useCeremonyPlaying(): boolean {
  return useSyncExternalStore(subscribe, () => ceremony, () => false);
}
