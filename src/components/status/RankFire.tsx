import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Text } from 'react-native-svg';

import { canDrawEmbers } from '@/components/assistant/EmberOrb';
import { usePageOnScreen } from '@/components/motion/SwipeTabs';
import { FIRE_FRAGMENT, FIRE_VERTEX } from '@/components/status/rankFireShader';
import { makeCanvas, setUpQuad, type QuadGpu } from '@/components/status/facetGL';
import { RankSeal } from '@/components/moments/RankSeal';
import { SystemText } from '@/components/system/SystemText';
import { alpha, display, palette, rankMeta, RANKS, space, type Rank } from '@/constants/theme';
import { hexRgb, rankLadder } from '@/lib/status';
import { useDayStats, useProgress } from '@/store/progress';

/** The seal's size: the distance from its middle to a point, in px. */
const SEAL = 50;
const HEIGHT = 236;
/** Where the seal's middle sits, from the top: low, so the flames have room. */
const SEAT = 0.6;
/** Fire looks no worse at 30 frames a second, and the phone does half the work. */
const FRAME_MS = 33;
/** Coming back after this long, the fire lights again instead of carrying on. */
const RELIGHT_MS = 12000;
const IGNITE_MS = 700;

/**
 * The top of the Status page: your rank's seal on fire, your aura rising off
 * it, and the road from E to S beneath with how far along it you are.
 *
 * The fire is the one thing on this page that moves by itself, so it earns
 * its place: it burns only while you can see it, at 30 frames a second, and
 * holds still as a single frame with reduced motion or Low power on.
 */
export function RankHero({ width }: { width: number }) {
  const { level, rank } = useDayStats();
  const ladder = rankLadder(level);
  const w = Math.min(width, 360);
  const said = ladder.next
    ? `${ladder.toNext} ${ladder.toNext === 1 ? 'level' : 'levels'} to ${ladder.next}-rank`
    : 'The top of the road';

  return (
    <View
      style={styles.hero}
      {...({ dataSet: { fly: 'object' } } as object)}
      accessible
      accessibilityLabel={`${rank}-rank. ${said}.`}>
      <View style={{ width: w, height: HEIGHT }}>
        {canDrawEmbers() ? (
          <RankFire rank={rank} width={w} aura={0.3 + 0.55 * (ladder.index / 5) + 0.15 * ladder.within} />
        ) : (
          <View style={[styles.sealFallback, { top: HEIGHT * SEAT - 60, left: w / 2 - 60 }]}>
            <RankSeal rank={rank} size={120} />
          </View>
        )}
        {canDrawEmbers() ? <Letter rank={rank} width={w} /> : null}
      </View>
      <RankRoad current={ladder.index} fill={ladder.fill} width={Math.min(w, 300)} />
      <SystemText variant="body" color={palette.textMuted} style={styles.said}>
        {said}
      </SystemText>
    </View>
  );
}

/** The rank letter over the fire, set in the seal like the rank-up ceremony's. */
function Letter({ rank, width }: { rank: Rank; width: number }) {
  const cy = HEIGHT * SEAT;
  return (
    <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Text
        x={width / 2}
        y={cy}
        dy={17}
        textAnchor="middle"
        fontFamily={display.bold}
        fontSize={48}
        fill={rankMeta[rank].color}
        stroke="#FFF1DA"
        strokeOpacity={0.35}
        strokeWidth={0.8}>
        {rank}
      </Text>
    </Svg>
  );
}

/** E to S along a line, lit as far as you have come. */
function RankRoad({ current, fill, width }: { current: number; fill: number; width: number }) {
  const step = width / (RANKS.length - 1);
  return (
    <View style={{ width, height: 30, marginTop: space.xs }}>
      <View style={[styles.track, { width }]} />
      <View
        style={[
          styles.track,
          styles.trackLit,
          {
            width,
            transform: [{ scaleX: fill }],
            transformOrigin: 'left center',
            transitionProperty: 'transform',
            transitionDuration: '600ms',
            transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
          } as object,
        ]}
      />
      {RANKS.map((r, i) => {
        const reached = i <= current;
        return (
          <View key={r} style={[styles.stop, { left: i * step - 14 }]}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: reached ? rankMeta[r].color : palette.bg,
                  borderColor: reached ? rankMeta[r].color : palette.borderStrong,
                },
                i === current && styles.dotHere,
              ]}
            />
            <SystemText
              variant="label"
              color={i === current ? palette.text : reached ? palette.textMuted : palette.textFaint}
              style={styles.stopLabel}>
              {r}
            </SystemText>
          </View>
        );
      })}
    </View>
  );
}

function RankFire({ rank, width, aura }: { rank: Rank; width: number; aura: number }) {
  const host = useRef<View | null>(null);
  const reduced = useReducedMotion();
  const onScreen = usePageOnScreen();
  const { state } = useProgress();
  const lowPower = state.settings?.lowPower ?? false;
  const still = reduced || lowPower;
  const aim = useRef({ rank, aura, still, onScreen });
  const kickRef = useRef<() => void>(() => {});
  useEffect(() => {
    aim.current = { rank, aura, still, onScreen };
    kickRef.current();
  });

  useEffect(() => {
    const parent = host.current as unknown as HTMLElement | null;
    if (!parent || !canDrawEmbers()) return;
    const { canvas, dpr } = makeCanvas(width, HEIGHT, 1.5);
    let gpu: QuadGpu | null = setUpQuad(canvas, FIRE_VERTEX, FIRE_FRAGMENT);
    if (!gpu) return;
    parent.appendChild(canvas);

    let inView = true;
    let frame = 0;
    let lastDraw = 0;
    let litAt = 0;
    let stoppedAt = 0;
    let drawnStill = '';

    const draw = (t: number, life: number) => {
      if (!gpu) return;
      const { gl, at } = gpu;
      gpu.draw();
      const colour = hexRgb(rankMeta[aim.current.rank].color);
      gl.uniform2f(at('uRes'), canvas.width, canvas.height);
      gl.uniform2f(at('uC'), (width / 2) * dpr, HEIGHT * (1 - SEAT) * dpr);
      gl.uniform1f(at('uR'), SEAL);
      gl.uniform1f(at('uPx'), dpr);
      gl.uniform1f(at('uT'), t);
      gl.uniform1f(at('uLife'), life);
      gl.uniform3f(at('uAura'), colour[0], colour[1], colour[2]);
      gl.uniform1f(at('uAuraK'), aim.current.aura);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const live = () => inView && aim.current.onScreen && !document.hidden;

    const step = (now: number) => {
      frame = 0;
      if (!live()) {
        if (!stoppedAt) stoppedAt = now;
        return;
      }
      if (aim.current.still) {
        // One frame, designed as a still: fully lit, flames mid-lick.
        const key = `${aim.current.rank}|${aim.current.aura.toFixed(3)}`;
        if (key !== drawnStill) {
          drawnStill = key;
          draw(2.7, 1);
        }
        return;
      }
      drawnStill = '';
      if (!litAt || (stoppedAt && now - stoppedAt > RELIGHT_MS)) litAt = now;
      stoppedAt = 0;
      if (now - lastDraw >= FRAME_MS) {
        lastDraw = now;
        const k = Math.min(1, (now - litAt) / IGNITE_MS);
        // Catches fast and settles: the strong ease-out, as a cubic.
        const life = 1 - Math.pow(1 - k, 3);
        draw(now / 1000, life);
      }
      frame = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    kickRef.current = kick;

    const seen = new IntersectionObserver(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting);
        kick();
      },
      { threshold: 0 },
    );
    seen.observe(canvas);
    document.addEventListener('visibilitychange', kick);

    const onLost = (ev: Event) => {
      ev.preventDefault();
      gpu = null;
    };
    const onRestored = () => {
      gpu = setUpQuad(canvas, FIRE_VERTEX, FIRE_FRAGMENT);
      drawnStill = '';
      kick();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    kick();

    return () => {
      cancelAnimationFrame(frame);
      kickRef.current = () => {};
      seen.disconnect();
      document.removeEventListener('visibilitychange', kick);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gpu?.free();
      canvas.remove();
    };
  }, [width]);

  return <View ref={host} aria-hidden pointerEvents="none" style={StyleSheet.absoluteFill} />;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: -space.md, marginBottom: space.lg },
  sealFallback: { position: 'absolute' },
  said: { fontSize: 14, marginTop: space.xs },
  track: {
    position: 'absolute',
    left: 0,
    top: 4,
    height: 2,
    borderRadius: 1,
    backgroundColor: alpha(palette.text, 0.1),
  },
  trackLit: { backgroundColor: palette.accent },
  stop: { position: 'absolute', top: 0, width: 28, alignItems: 'center', gap: 3 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  dotHere: { width: 14, height: 14, borderRadius: 7, marginTop: -2, borderColor: palette.text },
  stopLabel: { fontSize: 11, lineHeight: 13, letterSpacing: 0 },
});
