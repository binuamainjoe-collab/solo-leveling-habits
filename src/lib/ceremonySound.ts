import { Platform } from 'react-native';

import { soundEnabled } from '@/lib/feedback';
import { duckMusic } from '@/lib/music';

/**
 * The sound of a level and a rank, the only two moments that get one. Made
 * in the browser rather than shipped as files: a rising run of bell tones for
 * a level, and for a rank a low strike as the old rank burns, then a chord as
 * the new one is forged.
 *
 * It plays only straight after a tap (a cleared quest), which is when a phone
 * lets a page make sound, follows the Sound effects switch, plays one
 * ceremony at a time, lowers the background music under itself, and lets
 * every voice go when it ends. The ceremony on screen says everything the
 * sound does, for anyone with sound off.
 */

let ctx: AudioContext | null = null;
let busyUntil = 0;

function audio(): AudioContext | null {
  if (Platform.OS !== 'web' || typeof AudioContext === 'undefined' || !soundEnabled()) return null;
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** One bell-like tone: a sine with a quiet octave above, struck and left to ring. */
function bell(a: AudioContext, out: AudioNode, at: number, freq: number, length: number, level: number) {
  for (const [mult, share] of [
    [1, 1],
    [2.01, 0.28],
  ] as const) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level * share, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

function master(a: AudioContext, level: number) {
  const out = a.createGain();
  out.gain.value = level;
  out.connect(a.destination);
  return out;
}

/** A level: four notes climbing to the octave, then a soft shimmer on top. */
export function levelUpSound(delayMs = 0) {
  const a = audio();
  if (!a || performance.now() < busyUntil) return;
  busyUntil = performance.now() + delayMs + 1400;
  duckMusic(delayMs + 1400);
  const out = master(a, 0.22);
  const t = a.currentTime + delayMs / 1000;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(a, out, t + i * 0.075, f, 0.9 - i * 0.08, 0.5));
  bell(a, out, t + 0.32, 1568, 1.1, 0.18);
}

/**
 * A rank: a deep strike that falls in pitch as the old rank breaks at
 * `burnMs`, then a rising chord as the new one is forged at `forgeMs`.
 */
export function rankUpSound(burnMs: number, forgeMs: number) {
  const a = audio();
  if (!a || performance.now() < busyUntil) return;
  busyUntil = performance.now() + forgeMs + 1800;
  duckMusic(forgeMs + 1800);
  const out = master(a, 0.26);
  const burn = a.currentTime + burnMs / 1000;
  const low = a.createOscillator();
  const lowGain = a.createGain();
  low.type = 'sine';
  low.frequency.setValueAtTime(92, burn);
  low.frequency.exponentialRampToValueAtTime(41, burn + 0.9);
  lowGain.gain.setValueAtTime(0.0001, burn);
  lowGain.gain.exponentialRampToValueAtTime(0.9, burn + 0.02);
  lowGain.gain.exponentialRampToValueAtTime(0.0001, burn + 1.1);
  low.connect(lowGain).connect(out);
  low.start(burn);
  low.stop(burn + 1.15);

  const forge = a.currentTime + forgeMs / 1000;
  [261.63, 329.63, 392, 523.25].forEach((f, i) => bell(a, out, forge + i * 0.04, f, 1.6, 0.36));
  bell(a, out, forge + 0.2, 1046.5, 1.4, 0.16);
}
