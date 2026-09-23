import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { SystemText } from '@/components/system/SystemText';
import { alpha, categoryMeta, palette, radius, space } from '@/constants/theme';
import { feedback, playSound } from '@/lib/feedback';
import { artFor } from '@/data/cardArt';
import type { QuestDef } from '@/data/quests';
import { windowState } from '@/data/completion';

interface Props {
  quest: QuestDef;
  value: number;
  onChange: (next: number) => void;
  /** Ceiling quests (stay UNDER the target) invert the completion logic. */
  ceiling?: boolean;
}

/** How much one press of `+` is worth, per quest kind. */
function stepFor(quest: QuestDef): number {
  switch (quest.kind) {
    case 'counter':
    case 'duration':
      return quest.step ?? 1;
    case 'value':
      return Math.max(1, Math.round(quest.target / 10));
    default:
      return quest.target; // binary / window — one press completes
  }
}

function QuestCardBase({ quest, value, onChange, ceiling = false }: Props) {
  const cat = categoryMeta[quest.category];

  const ratio = quest.target > 0 ? Math.min(1, value / quest.target) : 0;
  const done = ceiling ? value > 0 && value <= quest.target : value >= quest.target;
  const over = ceiling && value > quest.target;

  const bar = done ? palette.positive : over ? palette.negative : palette.accent;

  /* --- completion burst: one-shot, fired when `done` flips to true --------- */
  const burst = useSharedValue(0);
  const wasDone = useRef(done);

  useEffect(() => {
    if (done && !wasDone.current) {
      burst.value = withSequence(
        withTiming(1, { duration: 170, easing: Easing.out(Easing.quad) }),
        withDelay(140, withTiming(0, { duration: 620, easing: Easing.in(Easing.quad) })),
      );
      feedback('complete', 'success');
    }
    wasDone.current = done;
  }, [done, burst]);

  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.value * 0.9 }));
  const xpFloatStyle = useAnimatedStyle(() => ({
    opacity: burst.value,
    transform: [{ translateY: -26 * burst.value }],
  }));

  /* ------------------------------------------------------------- handlers */
  const step = stepFor(quest);
  // The tick fires on press; the completion chime is raised separately by the
  // effect above, so finishing a quest is heard as a distinct, better sound.
  const toggle = useCallback(() => {
    playSound('tap');
    onChange(done ? 0 : quest.target);
  }, [done, quest.target, onChange]);
  const increase = useCallback(() => {
    playSound('tap');
    onChange(value + step);
  }, [value, step, onChange]);
  const decrease = useCallback(() => {
    playSound('tap');
    onChange(Math.max(0, value - step));
  }, [value, step, onChange]);

  const isToggle = quest.kind === 'binary' || quest.kind === 'window';

  // Recomputed each render; the board re-renders on every tap and at midnight,
  // which is often enough for a window measured in hours.
  const clock = windowState(quest);
  // A completed quest stays tappable so it can be undone outside its window.
  const shut = !clock.open && !done;

  const face = (
    <>
      <View style={styles.topRow}>
        <View style={[styles.chip, { borderColor: alpha(cat.color, 0.5), backgroundColor: alpha(cat.color, 0.18) }]}>
          <SystemText variant="label" color={cat.color} style={styles.chipText}>
            {cat.glyph} {cat.short}
          </SystemText>
        </View>
        <SystemText variant="label" color={done ? palette.positive : palette.accent} style={styles.xp}>
          +{quest.xp}
        </SystemText>
      </View>

      <View style={styles.spacer} />

      <SystemText
        variant="title"
        color={done ? palette.positive : palette.text}
        numberOfLines={2}
        style={styles.title}>
        {quest.title}
      </SystemText>

      <SystemText
        variant="meta"
        color={shut ? palette.negative : undefined}
        style={styles.count}>
        {quest.kind === 'window'
          ? clock.label
          : `${ceiling ? '≤ ' : ''}${fmt(value)} / ${fmt(quest.target)} ${quest.unit}`}
      </SystemText>
    </>
  );

  return (
    <Card
      art={artFor(quest.id, quest.category)}
      scrim={0.78}
      style={styles.card}
      contentStyle={styles.inner}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: alpha(palette.positive, 0.16) }, burstStyle]}
      />

      {isToggle ? (
        // Only toggle quests make the whole card pressable. A stepper card
        // keeps its controls separate so no pressable ever nests inside
        // another — on web that renders an invalid <button> in <button>.
        <PressSurface
          onPress={toggle}
          disabled={shut}
          label={`${quest.title}. ${quest.objective}`}
          selected={done}>
          {face}
          <View style={styles.footer}>
            <View
              style={[
                styles.checkWide,
                done && { borderColor: palette.positive, backgroundColor: alpha(palette.positive, 0.2) },
                shut && styles.checkShut,
              ]}>
              <SystemText
                variant="label"
                color={done ? palette.positive : shut ? palette.textFaint : palette.textMuted}>
                {done ? '✓ Done' : shut ? '🔒 Locked' : 'Mark done'}
              </SystemText>
            </View>
          </View>
        </PressSurface>
      ) : (
        <View>
          {face}
          <View style={styles.footer}>
            <StepButton label="−" hint="Decrease" onPress={decrease} disabled={value <= 0} />
            <StepButton label="+" hint="Increase" onPress={increase} accent />
          </View>
        </View>
      )}

      {/* progress rides the bottom edge of the card */}
      <View style={styles.track} pointerEvents="none">
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: bar,
              transform: [{ scaleX: ratio }],
              transformOrigin: 'left center',
              transitionProperty: 'transform',
              transitionDuration: 420,
              transitionTimingFunction: 'ease-out',
            },
          ]}
        />
      </View>

      <Animated.View pointerEvents="none" style={[styles.xpFloat, xpFloatStyle]}>
        <SystemText variant="title" color={palette.accent} glow style={styles.xpFloatText}>
          +{quest.xp} XP
        </SystemText>
      </Animated.View>
    </Card>
  );
}

/**
 * Press feedback via CSS transitions + Pressable + React state — the animations
 * skill's prescribed route for simple press/release, identical on web and
 * native without worklets.
 */
function PressSurface({
  children,
  onPress,
  label,
  selected,
  disabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  selected: boolean;
  disabled?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}>
      <Animated.View
        style={{
          transform: [{ scale: pressed ? 0.98 : 1 }],
          transitionProperty: 'transform',
          transitionDuration: 120,
          transitionTimingFunction: 'ease-out',
        }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

function StepButton({
  label,
  hint,
  onPress,
  disabled,
  accent,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={styles.stepWrap}>
      <Animated.View
        style={[
          styles.stepBtn,
          accent ? styles.stepBtnAccent : styles.stepBtnGhost,
          {
            opacity: disabled ? 0.35 : 1,
            transform: [{ scale: pressed && !disabled ? 0.9 : 1 }],
            transitionProperty: 'transform',
            transitionDuration: 110,
          },
        ]}>
        <SystemText
          variant="title"
          color={accent ? palette.bg : palette.text}
          style={styles.stepGlyph}>
          {label}
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? n.toLocaleString('en-US') : String(Math.round(n * 10) / 10);
}

const styles = StyleSheet.create({
  card: { minHeight: 178 },
  inner: { padding: space.md, paddingBottom: space.md + 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipText: { fontSize: 8, letterSpacing: 0.8 },
  xp: { fontSize: 9, letterSpacing: 0.6 },
  // Pushes the title to the lower half so the artwork reads above it.
  spacer: { height: 44 },
  title: { fontSize: 16, lineHeight: 19, letterSpacing: -0.2 },
  count: { fontSize: 11, marginTop: 2 },
  footer: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  stepWrap: { flex: 1 },
  stepBtn: {
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnGhost: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: alpha(palette.bg, 0.55),
  },
  stepBtnAccent: { backgroundColor: palette.accent },
  stepGlyph: { fontSize: 17, lineHeight: 21 },
  checkShut: { opacity: 0.55 },
  checkWide: {
    flex: 1,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: alpha(palette.bg, 0.55),
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: alpha(palette.text, 0.1),
  },
  fill: { height: '100%', width: '100%' },
  xpFloat: { position: 'absolute', right: space.md, top: space.xl },
  xpFloatText: { fontSize: 14 },
});

export const QuestCard = memo(QuestCardBase);
