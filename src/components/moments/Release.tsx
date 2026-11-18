import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Hint, Later, Stage, usePhases } from '@/components/moments/Ceremonies';
import { Sparks } from '@/components/moments/Sparks';
import { Rolling } from '@/components/motion/Rolling';
import { SystemText } from '@/components/system/SystemText';
import { alpha, display, palette } from '@/constants/theme';
import { releaseSound } from '@/lib/ceremonySound';
import { haptic } from '@/lib/feedback';

/** Marks a part of the Release for its CSS (src/app/+html.tsx). */
const rel = (name: string, extra?: Record<string, string>) => ({ dataSet: { rel: name, ...extra } }) as object;

const WORD = 'RELEASE';

/* When each beat lands, in ms from the start. */
const LINES = 300;
const IMPACT = 1100;
const STAMP = 1560;
const OUT = 2400;
const HINT = 2700;
const LENGTH = 3300;

/**
 * The hunter: a hooded figure whose long coat is thrown out by the power
 * rising under it, torn tails flying wider on the left, arms held away from
 * the body, eyes lit. Drawn for this app, in a 200 x 300 box, as one
 * silhouette so it reads as ink cut out of the fire behind it.
 */
const HUNTER =
  'M100 18 C88 18 78 28 76 44 C75 54 77 62 80 68 C70 74 56 80 48 92 ' +
  'L34 146 C33 154 36 160 42 160 C48 160 51 154 50 146 L60 110 ' +
  'L58 168 C50 208 28 246 4 266 L28 266 L18 288 L44 276 L50 297 L70 281 L84 298 L95 240 ' +
  'L105 240 L114 298 L128 283 L146 296 L151 279 L174 289 L168 268 L188 262 C168 244 150 208 142 168 L140 110 ' +
  'L150 146 C149 154 152 160 158 160 C164 160 167 154 166 146 L152 92 ' +
  'C144 80 130 74 120 68 C123 62 125 54 124 44 C122 28 112 18 100 18 Z';

function Hunter({ width, aura }: { width: number; aura: boolean }) {
  const height = width * 1.5;
  return (
    <View style={{ width, height }}>
      {aura ? (
        <View {...rel('aura')} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={width} height={height} viewBox="0 0 200 300">
            <Path d={HUNTER} fill="none" stroke={palette.accentSoft} strokeWidth={5} strokeLinejoin="round" />
          </Svg>
        </View>
      ) : null}
      <View {...rel('hunter-ink', { relGlow: '1' })} style={StyleSheet.absoluteFill}>
        <Svg width={width} height={height} viewBox="0 0 200 300">
          <Defs>
            {/* Light from behind and above: hot at the hood, dying out toward the hem. */}
            <LinearGradient id="relRim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFD39A" />
              <Stop offset="0.45" stopColor={palette.accent} />
              <Stop offset="1" stopColor={palette.accentDeep} stopOpacity={0.35} />
            </LinearGradient>
          </Defs>
          {/* The rim is a wide stroke under the fill, so only its outer edge shows and the seams inside stay hidden. */}
          <Path d={HUNTER} fill="none" stroke="url(#relRim)" strokeWidth={5} strokeLinejoin="round" />
          <Path d={HUNTER} fill="#090605" />
          <Ellipse cx={100} cy={50} rx={14} ry={16} fill="#020101" />
          <Polygon points="88,46 97,49 96,53 89,50" fill="#FFE1B8" />
          <Polygon points="112,46 103,49 104,53 111,50" fill="#FFE1B8" />
        </Svg>
      </View>
    </View>
  );
}

/** A small seeded random, so the speed lines are the same every time. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Anime focus lines: thin wedges from past the screen's edge toward a clear
 * middle where the hunter stands. One path, so it is one shape to draw.
 */
function focusLines(w: number, h: number, cx: number, cy: number, seed: number): string {
  const rand = seeded(seed);
  const count = 64;
  const outer = Math.hypot(w, h);
  const clear = Math.min(w, h) * 0.36;
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.08;
    const spread = (Math.PI / count) * (0.25 + rand() * 0.55);
    const inner = clear * (1 + rand() * 0.7);
    const p = (r: number, t: number) => `${(cx + Math.cos(t) * r).toFixed(1)} ${(cy + Math.sin(t) * r).toFixed(1)}`;
    d += `M${p(inner, a)} L${p(outer, a - spread)} L${p(outer, a + spread)} Z `;
  }
  return d;
}

/**
 * A level up, told like an anime transformation. Bars close in and the app
 * goes dark; the hunter rises out of the fire as speed lines rush in; then one
 * impact frame (two frames inverted, a shake that dies away) and the word
 * RELEASE is slammed in letter by letter while a ring of fire and sparks
 * blow out. The new level stamps in under it, the bars pull away, and the
 * app comes back. About two and a half seconds, and a tap skips it.
 */
export function Release({ from, to, into, need, onDone }: { from: number; to: number; into: number; need: number; onDone: () => void }) {
  const { width: w, height: h } = useWindowDimensions();
  const phase = usePhases([LINES, IMPACT, STAMP, OUT, HINT]);
  useEffect(() => releaseSound(IMPACT), []);
  useEffect(() => {
    if (phase === 1) haptic('light');
    if (phase === 2) haptic('success');
  }, [phase]);

  const cx = w / 2;
  const cy = h * 0.4;
  const hunterW = Math.min(w * 0.58, 250);
  const hunterH = hunterW * 1.5;
  const bar = Math.round(h * 0.11);
  const letter = Math.min(76, (w - 40) / 4.9);
  const linesA = useMemo(() => focusLines(w, h, cx, cy, 7), [w, h, cx, cy]);
  const linesB = useMemo(() => focusLines(w, h, cx, cy, 19), [w, h, cx, cy]);
  const out = phase >= 4;

  return (
    <Stage duration={LENGTH} onDone={onDone} label={`Level up. Level ${to}. Release`}>
      <View style={[StyleSheet.absoluteFill, styles.ink]} pointerEvents="none" />

      <View {...(phase >= 2 ? rel('shake') : {})} style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Fire behind the hunter, so the ink reads as a shape cut out of light. */}
        <View {...rel('glow')} style={[styles.abs, { left: cx - w * 0.75, top: cy - w * 0.75, width: w * 1.5, height: w * 1.5 }]}>
          <Svg width={w * 1.5} height={w * 1.5}>
            <Defs>
              <RadialGradient id="relFire" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#FFB061" stopOpacity={0.75} />
                <Stop offset="0.3" stopColor={palette.accent} stopOpacity={0.4} />
                <Stop offset="0.65" stopColor={palette.accentDeep} stopOpacity={0.14} />
                <Stop offset="1" stopColor={palette.accentDeep} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={w * 1.5} height={w * 1.5} fill="url(#relFire)" />
          </Svg>
        </View>

        {phase >= 1 ? (
          <View {...rel('lines')} style={StyleSheet.absoluteFill}>
            <View {...rel('boil-a')} style={StyleSheet.absoluteFill}>
              <Svg width={w} height={h}>
                <Path d={linesA} fill="#F7ECDF" fillOpacity={0.9} />
              </Svg>
            </View>
            <View {...rel('boil-b')} style={StyleSheet.absoluteFill}>
              <Svg width={w} height={h}>
                <Path d={linesB} fill="#F7ECDF" fillOpacity={0.9} />
              </Svg>
            </View>
          </View>
        ) : null}

        {phase >= 2 ? <View {...rel('wave')} style={[styles.wave, { left: cx - 110, top: cy - 110 }]} /> : null}

        <View {...rel('hunter')} style={[styles.abs, { left: cx - hunterW / 2, top: cy - hunterH * 0.52 }]}>
          <Hunter width={hunterW} aura={phase >= 2} />
        </View>

        {phase >= 2 ? (
          <View style={[styles.word, { top: cy + hunterH * 0.3, transform: [{ skewX: '-9deg' }] }]}>
            {WORD.split('').map((c, i) => (
              <View key={i} {...rel('letter', { i: String(i) })}>
                <Text style={[styles.letterBack, { fontSize: letter, lineHeight: letter * 1.08 }]}>{c}</Text>
                <Text style={[styles.letter, { fontSize: letter, lineHeight: letter * 1.08 }]}>{c}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* Placed from the start, unseen, so the level doesn't jump when it stamps in. */}
      <View style={[styles.stampRow, { bottom: bar + 72 }]} pointerEvents="none">
        <View {...(phase >= 3 ? rel('stamp') : {})} style={[styles.stamp, phase < 3 && styles.unseen]}>
          <SystemText variant="label" color={palette.accentSoft} style={styles.stampKicker}>
            LEVEL
          </SystemText>
          <Rolling text={String(phase >= 3 ? to : from)} lineHeight={60} style={styles.stampNumber} />
        </View>
        <Later on={phase >= 4}>
          <SystemText variant="body" color={palette.textMuted}>
            {(need - into).toLocaleString('en-US')} XP to level {to + 1}
          </SystemText>
        </Later>
      </View>

      {/* Bars sit over everything, the way a film's frame does. */}
      <View {...rel(out ? 'bar-top-out' : 'bar-top-in')} style={[styles.bar, { top: 0, height: bar }]} pointerEvents="none" />
      <View {...rel(out ? 'bar-bottom-out' : 'bar-bottom-in')} style={[styles.bar, { bottom: 0, height: bar }]} pointerEvents="none" />

      <Sparks
        duration={2600}
        bursts={[
          { at: IMPACT, x: 0.5, y: 0.4, count: 64, power: 1.5 },
          { at: IMPACT + 180, x: 0.5, y: 0.58, count: 26, power: 0.9 },
        ]}
      />

      {phase === 2 ? <View {...rel('impact')} style={StyleSheet.absoluteFill} pointerEvents="none" /> : null}
      <Hint show={phase >= 5} />
    </Stage>
  );
}

const styles = StyleSheet.create({
  ink: { backgroundColor: '#060403' },
  abs: { position: 'absolute' },
  bar: { position: 'absolute', left: 0, right: 0, backgroundColor: '#000' },
  wave: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 4, borderColor: alpha(palette.accentSoft, 0.9) },
  word: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center' },
  letter: { fontFamily: display.bold, color: '#FFF3E2', textShadowColor: alpha(palette.accent, 0.85), textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 } },
  letterBack: { position: 'absolute', left: 5, top: 5, fontFamily: display.bold, color: palette.accentDeep },
  stampRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 6 },
  stamp: { alignItems: 'center' },
  unseen: { opacity: 0 },
  stampKicker: { letterSpacing: 4, fontSize: 13 },
  stampNumber: { fontSize: 52, lineHeight: 60 },
});
