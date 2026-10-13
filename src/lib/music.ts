import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

/**
 * The looping background bed.
 *
 * Kept apart from `feedback.ts` because the two behave nothing alike: a sound
 * effect is fired and forgotten, whereas the music is a long-lived thing that
 * has to loop, duck, pause when the app leaves the screen and resume when it
 * comes back.
 *
 * "Off" means there is no player at all, not a paused one. On Android,
 * expo-audio remembers every player it paused itself — when the app went to
 * the background, or another sound took audio focus — and plays it again when
 * the app comes back. A pause from JS does not clear that memory, so a paused
 * bed could start again on its own after the student had switched it off. A
 * released player cannot be resumed by anything.
 */

const SOURCE = require('@/assets/music/theme.mp3');

/**
 * Deliberately quiet. The bed sits under the interface, not beside it — the
 * completion chime has to cut through it without either being raised.
 */
const BASE_VOLUME = 0.22;

let player: AudioPlayer | null = null;
/**
 * Off until the saved setting says otherwise. Starting on the default and
 * correcting after the store loads played the bed at every launch for as
 * long as loading took — seconds, when signed in and waiting on the network.
 */
let enabled = false;
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

/** Arms the bed. Nothing plays until `setMusicEnabled(true)`. */
export function initMusic(): void {
  if (started) return;
  started = true;

  if (__DEV__) {
    (globalThis as unknown as Record<string, unknown>).__music = {
      status: musicStatus,
      enable: setMusicEnabled,
    };
  }

  // The setting may have arrived first.
  if (enabled && !suspended) start();
}

/** The player, built on first use. Null if the device refuses to make one. */
function ensurePlayer(): AudioPlayer | null {
  if (player) return player;

  try {
    player = createAudioPlayer(SOURCE);
  } catch (err) {
    note(`could not create the music player: ${String(err)}`);
    return null;
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
  return player;
}

function start(): void {
  const p = ensurePlayer();
  if (!p) return;
  try {
    p.play();
  } catch (err) {
    note(`play failed: ${String(err)}`);
  }
}

/**
 * Stop and destroy the player. Coming back builds a fresh one, which also
 * means switching the music on again starts the track from the top rather
 * than mid-phrase.
 */
function release(): void {
  const p = player;
  if (!p) return;
  player = null;
  try {
    p.pause();
  } catch {
    // Being released is the part that matters.
  }
  try {
    p.remove();
  } catch (err) {
    note(`release failed: ${String(err)}`);
  }
}

/** Turn the bed on or off. Call only once the saved setting is known. */
export function setMusicEnabled(on: boolean): void {
  enabled = on;
  if (!started) return;

  if (on) {
    if (!suspended) start();
  } else {
    release();
  }
}

/** Called when the app leaves the foreground — music must not play on top of
 *  whatever the student switched to. */
export function suspendMusic(): void {
  suspended = true;
  if (!player) return;
  try {
    player.pause();
  } catch (err) {
    note(`pause failed: ${String(err)}`);
  }
}

export function resumeMusic(): void {
  suspended = false;
  if (enabled) start();
}
