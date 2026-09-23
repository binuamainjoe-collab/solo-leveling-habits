import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Sound and haptics for the app, behind one switch.
 *
 * Built for ADHD use, which sets two hard requirements. Feedback has to be
 * *immediate* — a reward that lands 300ms late stops reading as caused by you —
 * so every clip is preloaded at module scope rather than fetched on press. And
 * it has to be *optional*, because the same cue that helps one person is
 * intolerable to the next, and a student in a lecture needs it off entirely.
 */

const SOURCES = {
  /** Short, quiet transient — fires on every press, so it must not grate. */
  tap: require('@/assets/sfx/tap.wav'),
  /** Fuller chime for clearing a quest: the moment worth savouring. */
  complete: require('@/assets/sfx/complete.wav'),
  /** The full flourish — card reveals and achievement unlocks only. */
  fanfare: require('@/assets/sfx/fanfare.wav'),
} as const;

export type SoundName = keyof typeof SOURCES;

const players: Partial<Record<SoundName, AudioPlayer>> = {};
let soundOn = true;
let hapticsOn = true;
let started = false;

/**
 * Audio problems must never be silent.
 *
 * The first version of this module swallowed every error into an empty catch,
 * so when playback broke the app simply made no sound and reported nothing.
 * Failures are recorded here and warned once each, so the next fault is
 * diagnosable instead of invisible.
 */
const problems: string[] = [];
function note(message: string): void {
  if (problems.includes(message)) return;
  problems.push(message);
  console.warn(`[feedback] ${message}`);
}

/** Snapshot for debugging: which players exist and what has gone wrong. */
export function feedbackStatus() {
  return {
    started,
    soundOn,
    hapticsOn,
    loaded: (Object.keys(SOURCES) as SoundName[]).filter((n) => Boolean(players[n])),
    missing: (Object.keys(SOURCES) as SoundName[]).filter((n) => !players[n]),
    problems: [...problems],
  };
}

/**
 * Build every player once, up front. Creating them lazily on first press costs
 * a decode on the very tap that most needs to feel instant.
 */
export function initFeedback(): void {
  if (started) return;
  started = true;

  // Reachable from a debugger during development, so "there's no sound" can be
  // answered with facts instead of guesswork.
  if (__DEV__) {
    (globalThis as unknown as Record<string, unknown>).__feedback = {
      status: feedbackStatus,
      play: playSound,
    };
  }

  // Sound effects should still be heard with the ringer silenced — a student
  // who has muted notifications has not asked to mute their own app.
  setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});

  for (const name of Object.keys(SOURCES) as SoundName[]) {
    try {
      players[name] = createAudioPlayer(SOURCES[name]);
    } catch (err) {
      // Audio is a nicety — a device that refuses to build a player still gets
      // a working app — but the failure gets recorded rather than vanishing.
      note(`could not create player for "${name}": ${String(err)}`);
    }
  }
}

export function setSoundEnabled(on: boolean): void {
  soundOn = on;
}

export function setHapticsEnabled(on: boolean): void {
  hapticsOn = on;
}

/**
 * Play a cue. Rapid repeats restart the clip rather than layering copies —
 * ten stacked glitter hits from ten quick taps is noise, not feedback.
 */
export function playSound(name: SoundName): void {
  if (!soundOn) return;

  const player = players[name];
  if (!player) {
    note(`no player for "${name}" — initFeedback may not have run`);
    return;
  }

  // Rewinding is best-effort and must be kept OUT of the play path. `seekTo`
  // is async in expo-audio, and having it share a try block with `play()` was
  // enough to silence the whole app: one throw and playback never ran.
  try {
    const seek = player.seekTo(0) as unknown;
    if (seek && typeof (seek as Promise<void>).catch === 'function') {
      (seek as Promise<void>).catch(() => {});
    }
  } catch {
    // A player mid-teardown can refuse to seek; play anyway.
  }

  try {
    player.play();
  } catch (err) {
    note(`play("${name}") threw: ${String(err)}`);
  }
}

type HapticKind = 'light' | 'medium' | 'success';

export function haptic(kind: HapticKind): void {
  // Web has no haptics API worth using; calling through is a no-op at best.
  if (!hapticsOn || Platform.OS === 'web') return;
  const run =
    kind === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(
          kind === 'light'
            ? Haptics.ImpactFeedbackStyle.Light
            : Haptics.ImpactFeedbackStyle.Medium,
        );
  run.catch(() => {});
}

/** The common case: a cue you both hear and feel. */
export function feedback(name: SoundName, kind: HapticKind): void {
  playSound(name);
  haptic(kind);
}
