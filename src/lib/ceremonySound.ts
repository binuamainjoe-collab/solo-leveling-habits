import { Platform } from 'react-native';

import { soundEnabled } from '@/lib/feedback';
import { duckMusic } from '@/lib/music';

/**
 * The sound of a level and a rank, the only two moments that get one. Made
 * in the browser rather than shipped as files: a rush and an impact for
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

/**
 * A level, as a Release: a rush of air that climbs as the hunter rises, cut
 * off dead at `impactMs`, where a deep drop and a struck chord land together
 * with the impact frame.
 */
export function releaseSound(impactMs: number) {
  const a = audio();
  if (!a || performance.now() < busyUntil) return;
  busyUntil = performance.now() + impactMs + 1800;
  duckMusic(impactMs + 1800);
  const out = master(a, 0.24);
  const start = a.currentTime;
  const hit = start + impactMs / 1000;

  const noise = (seconds: number) => {
    const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * seconds)), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    return src;
  };

  // The rush: noise through a band that climbs, swelling until the impact.
  const rush = noise(impactMs / 1000);
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(260, start);
  band.frequency.exponentialRampToValueAtTime(5200, hit);
  const rushGain = a.createGain();
  rushGain.gain.setValueAtTime(0.0001, start);
  rushGain.gain.exponentialRampToValueAtTime(0.5, hit - 0.03);
  rushGain.gain.linearRampToValueAtTime(0.0001, hit);
  rush.connect(band).connect(rushGain).connect(out);
  rush.start(start);
  rush.stop(hit + 0.01);

  // The impact: a crack on top and a drop underneath.
  const crack = noise(0.09);
  const high = a.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 1800;
  const crackGain = a.createGain();
  crackGain.gain.setValueAtTime(0.7, hit);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.09);
  crack.connect(high).connect(crackGain).connect(out);
  crack.start(hit);
  crack.stop(hit + 0.1);

  const drop = a.createOscillator();
  const dropGain = a.createGain();
  drop.type = 'sine';
  drop.frequency.setValueAtTime(140, hit);
  drop.frequency.exponentialRampToValueAtTime(38, hit + 0.7);
  dropGain.gain.setValueAtTime(0.0001, hit);
  dropGain.gain.exponentialRampToValueAtTime(1, hit + 0.015);
  dropGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.9);
  drop.connect(dropGain).connect(out);
  drop.start(hit);
  drop.stop(hit + 0.95);

  [392, 523.25, 659.25, 783.99].forEach((f, i) => bell(a, out, hit + 0.06 + i * 0.03, f, 1.5, 0.3));
  bell(a, out, hit + 0.26, 1568, 1.3, 0.14);
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
