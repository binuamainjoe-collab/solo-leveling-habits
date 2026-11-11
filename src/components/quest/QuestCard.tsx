import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable } from '@/components/system/Pressable';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { openRing, releaseRing, ringHover, type RingItem } from '@/components/motion/RingMenu';
import { SwipeRow } from '@/components/motion/SwipeRow';
import { Card } from '@/components/system/Card';
import { Icon, type IconName } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, categoryMeta, HIT, icon, palette, radius, space } from '@/constants/theme';
import { openAssistant } from '@/lib/assistantBus';
import { feedback, haptic, playSound } from '@/lib/feedback';
import { ringPick } from '@/lib/moves';
import { rememberChange } from '@/lib/undo';
import { artFor } from '@/data/cardArt';
import type { QuestDef } from '@/data/quests';
import { windowState } from '@/data/completion';
import { isPlannedId } from '@/data/planner';
import { isBoss, openGate } from '@/lib/gateBus';
import { PLANNED_XP_MULTIPLIER } from '@/store/progress';

interface Props {
  quest: QuestDef;
  value: number;
  onChange: (next: number) => void;
  /** Ceiling quests (stay UNDER the target) invert the completion logic. */
  ceiling?: boolean;
  /**
   * Phones: the same card without the empty band that frames the artwork,
   * so a row of quests is about a third shorter and the board needs less
   * scrolling. The art still fills the card; every control stays full size.
   */
  compact?: boolean;
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

function QuestCardBase({ quest, value, onChange, ceiling = false, compact = false }: Props) {
  const cat = categoryMeta[quest.category];

  const ratio = quest.target > 0 ? Math.min(1, value / quest.target) : 0;
  const done = ceiling ? value > 0 && value <= quest.target : value >= quest.target;
  const over = ceiling && value > quest.target;

  const bar = done ? palette.positive : over ? palette.negative : palette.accent;
  // Shown as paid: the store gives planned tasks the planning bonus.
  const reward = isPlannedId(quest.id) ? Math.round(quest.xp * PLANNED_XP_MULTIPLIER) : quest.xp;

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
  // Every change goes through here, so a two-finger swipe can take it back.
  const change = useCallback(
    (next: number) => {
      rememberChange({ questId: quest.id, title: quest.title, before: value, after: next });
      onChange(next);
    },
    [quest.id, quest.title, value, onChange],
  );
  // The tick fires on press; the completion chime is raised separately by the
  // effect above, so finishing a quest is heard as a distinct, better sound.
  const toggle = useCallback(() => {
    playSound('tap');
    change(done ? 0 : quest.target);
  }, [done, quest.target, change]);
  const increase = useCallback(() => {
    playSound('tap');
    change(value + step);
  }, [value, step, change]);
  const decrease = useCallback(() => {
    playSound('tap');
    change(Math.max(0, value - step));
  }, [value, step, change]);

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
        <View style={styles.topEnd}>
          {/* Gates are for boss work done over time, and a one-tap card is already one big button. */}
          {isBoss(quest.rank) && !isToggle && !done && !shut ? <GateButton questId={quest.id} title={quest.title} /> : null}
          <SystemText variant="label" color={done ? palette.positive : palette.accent} style={styles.xp}>
            +{reward}
          </SystemText>
        </View>
      </View>

      <View style={compact ? styles.spacerCompact : styles.spacer} />

      <SystemText
        variant="title"
        color={done ? palette.positive : palette.text}
        numberOfLines={2}
        style={compact ? styles.titleCompact : styles.title}>
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

  // Swipe right to do it, left to take it back. Both only mirror what the
  // buttons on the card already do, so nothing here is gesture-only. Doing
  // it leaves a trail of fire behind the card.
  const stepLabel = `+${fmt(step)}`;
  const forward = shut || (isToggle && done)
    ? undefined
    : {
        icon: isToggle ? ('check' as const) : ('plus' as const),
        label: isToggle ? 'Done' : stepLabel,
        color: palette.bg,
        ink: palette.text,
        trail: true,
        onFire: isToggle ? toggle : increase,
      };
  // Hold the card and its actions open in a ring round the finger. Each is
  // also a button or a swipe on the card, so the ring is only a shortcut.
  const ring: RingItem[] = [];
  if (!shut) {
    ring.push(
      isToggle
        ? { key: 'do', label: done ? 'Not done' : 'Done', icon: done ? 'undo' : 'check', run: toggle }
        : { key: 'do', label: stepLabel, icon: 'plus', run: increase },
    );
  }
  ring.push({
    key: 'ask',
    label: 'Ask Beerus',
    icon: 'compose',
    run: () => openAssistant('chat', `Help me get "${quest.title}" done today. ${quest.objective}`),
  });
  if (!isToggle && value > 0) ring.push({ key: 'back', label: `−${fmt(step)}`, icon: 'minus', run: decrease });
  if (isBoss(quest.rank) && !isToggle && !done && !shut) {
    ring.push({ key: 'gate', label: 'Gate', icon: 'gate', run: (at) => openGate(quest.id, at.x, at.y) });
  }
  const held = useSharedValue(0);
  const host = useRef<View | null>(null);
  const openMenu = (x: number, y: number) => openRing(x, y, quest.title, ring);
  const count = ring.length;
  const hold = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(420)
        .maxPointers(1)
        .onStart((e) => {
          held.set(1);
          scheduleOnRN(openMenu, e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          const i = ringPick(e.translationX, e.translationY, count);
          if (i !== ringHover.get()) {
            ringHover.set(i);
            if (i >= 0) scheduleOnRN(haptic, 'tick');
          }
        })
        .onEnd(() => {
          scheduleOnRN(releaseRing, ringHover.get());
        })
        .onFinalize(() => {
          // Held a moment longer, so the press the finger lifted from is not also a tap.
          held.set(withDelay(300, withTiming(0, { duration: 0 })));
        }),
    // openMenu reads the ring as it is now; it only changes with the card's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, held],
  );
  // Once the ring is open, the finger is choosing, so the page must not scroll under it.
  useEffect(() => {
    const el = host.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el) return;
    const stop = (e: TouchEvent) => {
      if (held.get() && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, [held]);
  const tapped = (fn: () => void) => () => {
    if (!held.get()) fn();
  };

  const back = value > 0
    ? {
        icon: 'undo' as const,
        label: 'Undo',
        color: palette.surfaceRaised,
        ink: palette.text,
        onFire: isToggle ? toggle : decrease,
      }
    : undefined;

  return (
    <SwipeRow right={forward} left={back} corner={radius.lg}>
    <GestureDetector gesture={hold} touchAction="pan-y">
    <View ref={host} collapsable={false}>
    <Card
      art={artFor(quest.id, quest.category)}
      scrim={0.78}
      style={compact ? styles.cardCompact : styles.card}
      contentStyle={compact ? styles.innerCompact : styles.inner}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: alpha(palette.positive, 0.16) }, burstStyle]}
      />

      {isToggle ? (
        // Only toggle quests make the whole card pressable. A stepper card
        // keeps its controls separate so no pressable ever nests inside
        // another — on web that renders an invalid <button> in <button>.
        <PressSurface
          onPress={tapped(toggle)}
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
              {done || shut ? (
                <Icon
                  name={done ? 'check' : 'lock'}
                  size={icon.small}
                  color={done ? palette.positive : palette.textFaint}
                />
              ) : null}
              <SystemText
                variant="meta"
                color={done ? palette.positive : shut ? palette.textFaint : palette.text}
                style={styles.checkLabel}>
                {done ? 'Done' : shut ? 'Locked' : 'Mark done'}
              </SystemText>
            </View>
          </View>
        </PressSurface>
      ) : (
        <View>
          {face}
          <View style={styles.footer}>
            <StepButton glyph="minus" hint="Decrease" onPress={tapped(decrease)} disabled={value <= 0} />
            <StepButton glyph="plus" hint="Increase" onPress={tapped(increase)} accent />
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
          +{reward} XP
        </SystemText>
      </Animated.View>
    </Card>
    </View>
    </GestureDetector>
    </SwipeRow>
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

/**
 * The way into a boss quest's Gate. The portal opens from right here, so it
 * reads as stepping into this quest and nothing else.
 */
function GateButton({ questId, title }: { questId: string; title: string }) {
  const at = useRef<View | null>(null);
  return (
    <Pressable
      onPress={() => {
        const box = (at.current as unknown as HTMLElement | null)?.getBoundingClientRect?.();
        openGate(questId, box ? box.left + box.width / 2 : 0, box ? box.top + box.height / 2 : 0);
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Enter the Gate for ${title}`}>
      <View ref={at} collapsable={false} style={styles.gate}>
        <Icon name="gate" size={icon.small} color={palette.accentSoft} />
        <SystemText variant="label" color={palette.accentSoft} style={styles.gateText}>
          Gate
        </SystemText>
      </View>
    </Pressable>
  );
}

function StepButton({
  glyph,
  hint,
  onPress,
  disabled,
  accent,
}: {
  glyph: IconName;
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
        <Icon name={glyph} size={icon.bar} color={accent ? palette.bg : palette.text} />
      </Animated.View>
    </Pressable>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? n.toLocaleString('en-US') : String(Math.round(n * 10) / 10);
}

const styles = StyleSheet.create({
  card: { minHeight: 178 },
  cardCompact: { minHeight: 0 },
  inner: { padding: space.md, paddingBottom: space.md + 3 },
  innerCompact: { padding: space.sm + 2, paddingBottom: space.sm + 5 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipText: { fontSize: 11 },
  xp: { fontSize: 13 },
  topEnd: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: alpha(palette.accentSoft, 0.45),
    backgroundColor: alpha(palette.bg, 0.55),
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  gateText: { fontSize: 11 },
  // Pushes the title to the lower half so the artwork reads above it.
  spacer: { height: 44 },
  spacerCompact: { height: space.sm },
  title: { fontSize: 17, lineHeight: 22 },
  titleCompact: { fontSize: 15, lineHeight: 19 },
  count: { marginTop: 2 },
  footer: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  stepWrap: { flex: 1 },
  // Apple's 44pt minimum: these are the most-tapped controls in the app.
  stepBtn: {
    height: HIT,
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
  checkShut: { opacity: 0.55 },
  checkLabel: { fontWeight: '600' },
  checkWide: {
    flex: 1,
    height: HIT,
    flexDirection: 'row',
    gap: space.xs,
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
  xpFloatText: { fontSize: 15 },
});

export const QuestCard = memo(QuestCardBase);
