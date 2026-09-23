import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

/**
 * The looping background bed.
 *
 * Kept apart from `feedback.ts` because the two behave nothing alike: a sound
 * effect is fired and forgotten, whereas the music is a long-lived thing that
 * has to loop, duck, pause when the app leaves the screen and resume when it
 * comes back.
 */

const SOURCE = require('@/assets/music/theme.mp3');

/**
 * Deliberately quiet. The bed sits under the interface, not beside it — the
 * completion chime has to cut through it without either being raised.
 */
const BASE_VOLUME = 0.22;

let player: AudioPlayer | null = null;
let enabled = true;
/** True while the app is backgrounded, so resuming doesn't fight the setting. */
let suspended = false;
let started = false;

const problems: string[] = [];
function note(message: string): void {
  if (problems.includes(message)) return;
  problems.push(message);
  console.warn(`[music] ${message}`);
}

export function musicStatus() {
  return {
    started,
    enabled,
    suspended,
    hasPlayer: Boolean(player),
    playing: safeRead(() => player?.playing ?? false, false),
    problems: [...problems],
  };
}

function safeRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function initMusic(): void {
  if (started) return;
  started = true;

  if (__DEV__) {
    (globalThis as unknown as Record<string, unknown>).__music = {
      status: musicStatus,
      enable: setMusicEnabled,
    };
  }

  try {
    player = createAudioPlayer(SOURCE);
  } catch (err) {
    note(`could not create the music player: ${String(err)}`);
    return;
  }

  // Each property is set on its own, so an API that lacks one of them still
  // gets the others rather than losing the lot to a single throw.
  try {
    player.loop = true;
  } catch (err) {
    note(`loop unsupported: ${String(err)}`);
  }
  try {
    player.volume = BASE_VOLUME;
  } catch (err) {
    note(`volume unsupported: ${String(err)}`);
  }

  if (enabled) start();
}

function start(): void {
  if (!player) return;
  try {
    player.play();
  } catch (err) {
    note(`play failed: ${String(err)}`);
  }
}

function stop(): void {
  if (!player) return;
  try {
    player.pause();
  } catch (err) {
    note(`pause failed: ${String(err)}`);
  }
}

/** Turn the bed on or off. Restarts from the top rather than resuming. */
export function setMusicEnabled(on: boolean): void {
  enabled = on;
  if (!player) return;

  if (on) {
    if (!suspended) start();
  } else {
    stop();
    // Coming back should feel like putting the record on again, not like
    // resuming mid-phrase from wherever it happened to be cut off.
    try {
      const seek = player.seekTo(0) as unknown;
      if (seek && typeof (seek as Promise<void>).catch === 'function') {
        (seek as Promise<void>).catch(() => {});
      }
    } catch {
      // Rewinding is a nicety; being paused is the part that matters.
    }
  }
}

/** Called when the app leaves the foreground — music must not play on top of
 *  whatever the student switched to. */
export function suspendMusic(): void {
  suspended = true;
  stop();
}

export function resumeMusic(): void {
  suspended = false;
  if (enabled) start();
}
