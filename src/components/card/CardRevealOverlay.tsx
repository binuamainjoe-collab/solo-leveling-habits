import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, {
  cubicBezier,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { CollectibleCard } from '@/components/card/CollectibleCard';
import { useDeviceTilt } from '@/components/collection/tilt';
import { Sparks } from '@/components/moments/Sparks';
import { Scramble } from '@/components/motion/Scramble';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { tiltAt } from '@/lib/collection';
import { feedback } from '@/lib/feedback';
import { SPRING } from '@/lib/motion';
import { rarityMeta, type CardDef } from '@/data/cardRules';
import { useProgress } from '@/store/progress';

interface Props {
  card: CardDef;
  onDismiss: () => void;
}

/** A first guess at the hero card's height, until it has been laid out. */
const CARD_H = 360 + 150;
/** When the card starts up out of the gate, and how long it takes to clear it. */
const RISE_AT = 220;
const RISE_MS = 880;
/** The gate's whole life: it opens fast, holds while the card comes up, and closes faster than it opened. */
const GATE_MS = 1420;
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** When the card is clear and the gate closes behind it. */
const CLEAR_AT = RISE_AT + RISE_MS;
/** Room round the card for the sparks to fly into. */
const SPRAY = { side: 70, above: 120, below: 140 };

/** The gate: a ring of light opening flat on the floor, then shutting. */
const GATE = {
  '0%': { opacity: 0, transform: [{ scaleX: 0.2 }, { scaleY: 0 }] },
  '22%': { opacity: 1, transform: [{ scaleX: 1 }, { scaleY: 1 }] },
  '80%': { opacity: 1, transform: [{ scaleX: 1 }, { scaleY: 1 }] },
  '100%': { opacity: 0, transform: [{ scaleX: 0.6 }, { scaleY: 0 }] },
};

/** The light standing up out of the gate while the card rises through it. */
const BEAM = {
  '0%': { opacity: 0 },
  '25%': { opacity: 0.9 },
  '78%': { opacity: 0.45 },
  '100%': { opacity: 0 },
};

/** Up out of the gate: from below its line, tipped back, settling face-on. */
const RISE = {
  from: { transform: [{ perspective: 1000 }, { translateY: CARD_H * 1.04 }, { rotateX: '28deg' }, { scale: 0.94 }] },
  to: { transform: [{ perspective: 1000 }, { translateY: 0 }, { rotateX: '0deg' }, { scale: 1 }] },
};

/**
 * A new card: a gate opens in the floor in the card's rarity, the card rises
 * up out of it in a column of light, and the gate shuts behind it in a spray
 * of sparks. About a second and a half, then the card is yours to look at:
 * it tips toward a finger and with the phone, its foil and layers shifting,
 * and a rare card's art moves. Tap to continue.
 */
export function CardRevealOverlay({ card, onDismiss }: Props) {
  const rarity = rarityMeta[card.rarity];
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - space.xl * 2, 330);
  const reduced = useReducedMotion();
  const { state } = useProgress();
  const lowPower = state.settings?.lowPower ?? false;
  // Clipped at the gate's line while it rises, free to tip once it is out.
  const [risen, setRisen] = useState(reduced);
  // The card's own height, once laid out: the gate opens at its foot.
  const [cardH, setCardH] = useState(CARD_H);

  useEffect(() => {
    feedback('fanfare', 'success');
    if (reduced) return;
    const t = setTimeout(() => setRisen(true), CLEAR_AT + 40);
    return () => clearTimeout(t);
  }, [reduced]);

  // A finger on the card tips it toward itself. Being a drag, it keeps the
  // tap-to-continue behind it from firing; a plain tap still goes through.
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const tip = useMemo(() => {
    const follow = (ex: number, ey: number) => {
      'worklet';
      const t = tiltAt(ex, ey, cardWidth, cardH);
      fx.set(withSpring(t.x, { duration: 160, dampingRatio: 1 }));
      fy.set(withSpring(t.y, { duration: 160, dampingRatio: 1 }));
    };
    const drag = Gesture.Pan()
      .minDistance(4)
      .maxPointers(1)
      .onStart((e) => follow(e.x, e.y))
      .onUpdate((e) => follow(e.x, e.y))
      .onFinalize(() => {
        fx.set(withSpring(0, SPRING.settle));
        fy.set(withSpring(0, SPRING.settle));
      });
    // A plain tap on the card continues, like a tap anywhere else.
    const tap = Gesture.Tap().onEnd((_e, ok) => {
      if (ok) scheduleOnRN(onDismiss);
    });
    return Gesture.Race(drag, tap);
  }, [cardH, cardWidth, fx, fy, onDismiss]);
  const gyro = useDeviceTilt(risen);
  const x = useDerivedValue(() => Math.max(-1, Math.min(1, fx.get() + gyro.x.get())));
  const y = useDerivedValue(() => Math.max(-1, Math.min(1, fy.get() + gyro.y.get())));
  const tipStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${x.get() * 10}deg` }, { rotateX: `${-y.get() * 10}deg` }],
  }));

  const gateW = cardWidth * 1.3;
  const gateH = 58;
  // Reanimated takes its own cubicBezier(); it rejects the CSS string.
  const cue = (name: object, duration: number, delay: number, easing: string | ReturnType<typeof cubicBezier> = EASE_OUT): object | null =>
    reduced
      ? null
      : {
          animationName: name,
          animationDuration: `${duration}ms`,
          animationDelay: `${delay}ms`,
          animationTimingFunction: easing,
          animationFillMode: 'both',
        };

  return (
    <Animated.View entering={FadeIn.duration(240)} exiting={FadeOut.duration(200)} style={StyleSheet.absoluteFill}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Add to collection" />
        <Animated.View pointerEvents="none" entering={FadeIn.delay(120).duration(360)}>
          <Scramble variant="label" color={rarity.color} style={styles.kicker}>
            ◆ New card acquired ◆
          </Scramble>
        </Animated.View>

        <View style={{ width: cardWidth, height: cardH }}>
          {/* The light column and the gate stand behind the card. */}
          {!reduced ? (
            <>
              <Animated.View
                pointerEvents="none"
                style={[styles.beam, { width: cardWidth * 0.86, left: cardWidth * 0.07, height: cardH }, cue(BEAM, GATE_MS, 0, 'linear')]}>
                <LinearGradient colors={[alpha(rarity.glow, 0), alpha(rarity.glow, 0.42)]} style={StyleSheet.absoluteFill} />
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={[styles.gate, { width: gateW, height: gateH, left: (cardWidth - gateW) / 2, top: cardH - gateH / 2 }, cue(GATE, GATE_MS, 0, 'linear')]}>
                <Svg width={gateW} height={gateH}>
                  <Defs>
                    <RadialGradient id="gate-void" cx="50%" cy="50%" r="50%">
                      <Stop offset="0" stopColor={rarity.glow} stopOpacity={0.95} />
                      <Stop offset="0.45" stopColor={rarity.color} stopOpacity={0.55} />
                      <Stop offset="1" stopColor={palette.bg} stopOpacity={0.2} />
                    </RadialGradient>
                  </Defs>
                  <Ellipse cx={gateW / 2} cy={gateH / 2} rx={gateW / 2 - 2} ry={gateH / 2 - 2} fill="url(#gate-void)" />
                  <Ellipse cx={gateW / 2} cy={gateH / 2} rx={gateW / 2 - 2} ry={gateH / 2 - 2} fill="none" stroke={rarity.glow} strokeWidth={2.5} />
                  <Ellipse cx={gateW / 2} cy={gateH / 2} rx={gateW / 2 - 9} ry={gateH / 2 - 7} fill="none" stroke="#FFF1DA" strokeOpacity={0.5} strokeWidth={1} />
                </Svg>
              </Animated.View>
            </>
          ) : null}

          <View style={[styles.window, { height: cardH }, risen && styles.windowOpen]}>
            <Animated.View style={reduced ? null : cue(RISE, RISE_MS, RISE_AT)}>
              <GestureDetector gesture={tip} touchAction="none">
                <Animated.View style={tipStyle} onLayout={(e) => setCardH(Math.round(e.nativeEvent.layout.height))}>
                  <CollectibleCard card={card} owned size="hero" tilt={{ x, y }} alive={risen && !lowPower} />
                </Animated.View>
              </GestureDetector>
            </Animated.View>
          </View>

          {/* Sparks thrown up out of the gate as it shuts behind the card. */}
          <View
            pointerEvents="none"
            style={[styles.spray, { left: -SPRAY.side, right: -SPRAY.side, top: -SPRAY.above, bottom: -SPRAY.below }]}>
            <Sparks
              duration={2200}
              drift={false}
              tone={card.rarity === 'legendary' ? 'gold' : 'ember'}
              bursts={[
                {
                  at: CLEAR_AT - 60,
                  x: 0.5,
                  y: (SPRAY.above + cardH) / (SPRAY.above + cardH + SPRAY.below),
                  count: 26 + Math.round(rarity.particles / 2),
                  power: 0.8,
                },
              ]}
            />
          </View>
        </View>

        <Animated.View pointerEvents="none" entering={FadeIn.delay(reduced ? 200 : CLEAR_AT + 150).duration(420)} style={styles.footer}>
          <View style={[styles.addPill, { borderColor: alpha(rarity.color, 0.6) }]}>
            <SystemText variant="label" color={rarity.color}>
              Added to your collection
            </SystemText>
          </View>
          <SystemText variant="label" style={styles.dismiss}>
            Tap anywhere to continue
          </SystemText>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(palette.bg, 0.94),
    padding: space.xl,
    gap: space.lg,
  },
  kicker: { fontSize: 10, letterSpacing: 3 },
  beam: { position: 'absolute', bottom: 0 },
  gate: { position: 'absolute' },
  spray: { position: 'absolute' },
  // Hides the card below the gate's line while it rises.
  window: { overflow: 'hidden' },
  windowOpen: { overflow: 'visible' },
  footer: { alignItems: 'center', gap: space.md },
  addPill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 7,
  },
  dismiss: { fontSize: 9, letterSpacing: 2.5 },
});
