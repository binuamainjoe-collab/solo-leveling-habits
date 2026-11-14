import { router, useFocusEffect } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { MotionScroll } from '@/components/motion/MotionScroll';
import { Rolling } from '@/components/motion/Rolling';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useCallback, useMemo, useState } from 'react';

import { canDrawEmbers } from '@/components/assistant/EmberOrb';
import { Card } from '@/components/system/Card';
import { Radar } from '@/components/charts/Radar';
import { AbilityCrystal } from '@/components/status/AbilityCrystal';
import { RankHero } from '@/components/status/RankFire';
import { StatusRail, useChapters, type Chapter } from '@/components/status/StatusRail';
import { Panel, RangeSwitch } from '@/components/system/Panel';
import { Screen, useContentWidth } from '@/components/system/Screen';
import { ModelPicker } from '@/components/system/ModelPicker';
import { MonthCalendar } from '@/components/system/MonthCalendar';
import { StatusHeader } from '@/components/system/StatusHeader';
import { SystemText } from '@/components/system/SystemText';
import {
  alpha,
  categoryMeta,
  CATEGORIES,
  palette,
  radius,
  space,
  STATS,
  statMeta,
  type StatKey,
} from '@/constants/theme';
import { ACHIEVEMENTS } from '@/data/achievements';
import { plannerConfigured } from '@/data/planner';
import { currentSession, listAccounts, signOut, type Account } from '@/lib/auth';
import { supabaseConfigured } from '@/lib/supabase';
import { QUESTS } from '@/data/quests';
import { openAssistant } from '@/lib/assistantBus';
import { haptic, playSound } from '@/lib/feedback';
import { useProgress } from '@/store/progress';

/** The page's chapters, top to bottom, as the line down the right edge names them. */
const CHAPTERS: Chapter[] = [
  { key: 'rank', label: 'Rank' },
  { key: 'abilities', label: 'Abilities' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'record', label: 'Record' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'settings', label: 'Settings' },
];

const STAT_COLOURS = STATS.map((key) => statMeta[key].color);

export default function HunterScreen() {
  const { state, resetAll, setSetting } = useProgress();
  const { width, wide } = useContentWidth();
  // The stat furthest behind, for the one button that helps with it.
  const weakest = STATS.reduce((low, key) => ((state.stats[key] ?? 0) < (state.stats[low] ?? 0) ? key : low), STATS[0]);
  // The ability the crystal faces: the weakest, its dent toward you, until
  // you turn it or pick another score. Beerus is asked about this one.
  const [picked, setPicked] = useState<StatKey | null>(null);
  const faced = picked ?? weakest;
  const values = useMemo(() => STATS.map((key) => state.stats[key] ?? 0), [state.stats]);
  const threeD = canDrawEmbers();
  const [abilityView, setAbilityView] = useState<'crystal' | 'chart'>('crystal');
  const [calendarView, setCalendarView] = useState<'calendar' | 'city'>('calendar');
  const chapters = useChapters(CHAPTERS.length);

  const maxCategory = Math.max(...CATEGORIES.map((c) => state.categoryDays[c] ?? 0), 1);

  return (
    <Screen>
      <View style={styles.root} {...({ dataSet: { statusRoot: '1' } } as object)}>
      <MotionScroll
        onScroller={chapters.attach}
        onContentSizeChange={chapters.onContentSize}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        {...({ dataSet: { statusScroll: '1' } } as object)}>
        <View onLayout={chapters.onChapter(0)}>
          <RankHero width={width} />
          <StatusHeader />
        </View>

        {/* Ability scores — Life Reset's "Your Rating": tiny caps label on the
            left, an oversized numeral hard-right, hairline between rows. The
            numbers are the hero here, not the labels. */}
        <Animated.View entering={FadeInDown.duration(360)} onLayout={chapters.onChapter(1)}>
          <Panel
            iconName="radar"
            title="Ability scores"
            sub="The shape of your training. A dent is a side of life being left behind."
            right={
              threeD ? (
                <RangeSwitch
                  options={[
                    { value: 'crystal', label: 'Crystal' },
                    { value: 'chart', label: 'Chart' },
                  ]}
                  value={abilityView}
                  onChange={setAbilityView}
                />
              ) : null
            }
            style={styles.block}>
            <View style={[styles.abilities, wide && styles.abilitiesWide]}>
              <View style={styles.radar}>
                {threeD && abilityView === 'crystal' ? (
                  <AbilityCrystal
                    size={Math.min(300, width - 64)}
                    values={values}
                    colours={STAT_COLOURS}
                    facing={STATS.indexOf(faced)}
                    onFacing={(i) => {
                      haptic('tick');
                      setPicked(STATS[i]);
                    }}
                  />
                ) : (
                  <Radar
                    size={Math.min(300, width - 64)}
                    axes={STATS.map((key) => ({ key, label: statMeta[key].label, value: state.stats[key] ?? 0, color: statMeta[key].color }))}
                  />
                )}
              </View>
              <View style={styles.ratingList}>
                {STATS.map((key, i) => {
                  const meta = statMeta[key];
                  const value = state.stats[key] ?? 0;
                  const on = key === faced;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        if (on) return;
                        playSound('tap');
                        setPicked(key);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${meta.label}, ${value}`}
                      accessibilityState={{ selected: on }}>
                      <Animated.View
                        style={[
                          styles.ratingRow,
                          i > 0 && styles.ratingDivider,
                          {
                            backgroundColor: on ? alpha(meta.color, 0.1) : 'transparent',
                            transitionProperty: 'backgroundColor',
                            transitionDuration: '160ms',
                          },
                        ]}>
                        <SystemText variant="title" color={meta.color} style={styles.ratingGlyph}>
                          {meta.glyph}
                        </SystemText>
                        <SystemText variant="body" color={palette.text} style={styles.ratingName}>
                          {meta.label}
                        </SystemText>
                        <Rolling text={String(value)} lineHeight={34} color={meta.color} style={styles.ratingValue} />
                      </Animated.View>
                    </Pressable>
                  );
                })}
                <GhostButton
                  label={`Ask Beerus how to raise ${statMeta[faced].label}`}
                  onPress={() => {
                    playSound('tap');
                    openAssistant(
                      'chat',
                      faced === weakest
                        ? `My weakest stat is ${statMeta[faced].label} (${state.stats[faced] ?? 0}). Which quests would raise it, sized for my days?`
                        : `I want to raise ${statMeta[faced].label} (${state.stats[faced] ?? 0}). Which quests would do it, sized for my days?`,
                    );
                  }}
                />
              </View>
            </View>
          </Panel>
        </Animated.View>

        {/* 30-day activity, straight off the day log */}
        <Animated.View entering={FadeInDown.duration(360).delay(60)} onLayout={chapters.onChapter(2)}>
          <View style={styles.labelRow}>
            <SystemText variant="label" style={[styles.sectionLabel, styles.labelInRow]}>
              Calendar
            </SystemText>
            {threeD ? (
              <RangeSwitch
                options={[
                  { value: 'calendar', label: 'Calendar' },
                  { value: 'city', label: 'City' },
                ]}
                value={calendarView}
                onChange={setCalendarView}
              />
            ) : null}
          </View>
          <Card reveal style={styles.block} contentStyle={styles.activityInner}>
            <MonthCalendar view={calendarView} />
          </Card>
        </Animated.View>

        {/* Lifetime record */}
        <Animated.View entering={FadeInDown.duration(360).delay(80)} onLayout={chapters.onChapter(3)}>
          <SystemText variant="label" style={styles.sectionLabel}>
            Hunter record
          </SystemText>
          <View style={styles.recordGrid}>
            <Record label="Quests cleared" value={state.questCompletions} tint={palette.accent} />
            <Record label="Perfect days" value={state.perfectDays} tint={palette.positive} />
            <Record label="Current streak" value={`${state.streak}d`} tint={palette.accent} />
            <Record label="Best streak" value={`${state.bestStreak}d`} tint={palette.gold} />
            <Record label="Total XP" value={state.xp} tint={palette.violet} />
            <Record
              label="Trophies"
              value={`${state.unlocked.length}/${ACHIEVEMENTS.length}`}
              tint={palette.sky}
            />
          </View>
        </Animated.View>

        {/* Discipline coverage */}
        <Animated.View entering={FadeInDown.duration(360).delay(160)} onLayout={chapters.onChapter(4)}>
          <SystemText variant="label" style={styles.sectionLabel}>
            Discipline coverage
          </SystemText>
          <Card reveal style={styles.block}>
            <SystemText variant="body" style={styles.blockSub}>
              Days you cleared at least one quest in each discipline.
            </SystemText>
            <View style={styles.catList}>
              {CATEGORIES.map((c) => {
                const meta = categoryMeta[c];
                const days = state.categoryDays[c] ?? 0;
                return (
                  <View key={c} style={styles.catRow}>
                    <SystemText variant="label" color={meta.color} style={styles.catGlyph}>
                      {meta.glyph}
                    </SystemText>
                    <SystemText variant="label" style={styles.catName}>
                      {meta.short}
                    </SystemText>
                    <View style={styles.catTrack}>
                      <Animated.View
                        style={[
                          styles.catFill,
                          {
                            backgroundColor: meta.color,
                            transform: [{ scaleX: days / maxCategory }],
                            transformOrigin: 'left center',
                            transitionProperty: 'transform',
                            transitionDuration: 550,
                            transitionTimingFunction: 'ease-out',
                          },
                        ]}
                      />
                    </View>
                    <SystemText variant="meta" style={styles.catDays}>
                      {days}d
                    </SystemText>
                  </View>
                );
              })}
            </View>
          </Card>
        </Animated.View>

        {/* Board summary + reset */}
        <Animated.View entering={FadeInDown.duration(360).delay(240)} onLayout={chapters.onChapter(5)}>
          <SystemText variant="label" style={styles.sectionLabel}>
            System
          </SystemText>
          <Card reveal style={styles.block}>
            <Toggle
              label="Sound effects"
              hint="A tick on every press, a chime when a quest is cleared."
              value={state.settings?.sound ?? true}
              onChange={(v) => {
                setSetting('sound', v);
                if (v) playSound('tap');
              }}
            />
            <View style={styles.toggleDivider} />
            <Toggle
              label="Vibration"
              hint="A pulse alongside each sound. No effect on the web build."
              value={state.settings?.haptics ?? true}
              onChange={(v) => setSetting('haptics', v)}
            />
            <View style={styles.toggleDivider} />
            <Toggle
              label="Background music"
              hint="A quiet looping track. Pauses when you leave the app."
              value={state.settings?.music ?? true}
              onChange={(v) => setSetting('music', v)}
            />
            <View style={styles.toggleDivider} />
            <Toggle
              label="Low power"
              hint="Holds the world behind your screens and the streak flame still, and calms Beerus. The world also softens by itself on a busy phone."
              value={state.settings?.lowPower ?? false}
              onChange={(v) => setSetting('lowPower', v)}
            />
          </Card>

          <SystemText variant="label" style={styles.sectionLabel}>
            Reminders
          </SystemText>
          <Card reveal style={styles.block}>
            {Platform.OS === 'web' ? (
              <SystemText variant="meta" style={styles.notConnected}>
                Reminders arrive on the phone app. The browser cannot schedule them.
              </SystemText>
            ) : null}
            <Toggle
              label="Morning briefing"
              hint="At your wake time: what is first today."
              value={state.settings?.remindMorning ?? true}
              onChange={(v) => setSetting('remindMorning', v)}
            />
            <View style={styles.toggleDivider} />
            <Toggle
              label="Planning time"
              hint={`At ${state.settings?.briefingTime ?? '21:30'}, when tomorrow has no plan yet.`}
              value={state.settings?.remindPlanning ?? true}
              onChange={(v) => setSetting('remindPlanning', v)}
            />
            <View style={styles.toggleDivider} />
            <Toggle
              label="Open tasks"
              hint="When a planned task's time has passed and it is still open. Never after bedtime."
              value={state.settings?.remindDrift ?? true}
              onChange={(v) => setSetting('remindDrift', v)}
            />
          </Card>

          <SystemText variant="label" style={styles.sectionLabel}>
            Profile
          </SystemText>
          <Card reveal style={styles.block}>
            <SystemText variant="body" style={styles.blockSub}>
              What Beerus knows about your life: studies, routine, training, habits, and the
              timetables and documents you gave it. It plans and suggests quests from this.
            </SystemText>
            <GhostButton
              label="Open your profile"
              onPress={() => {
                playSound('tap');
                router.push('/profile');
              }}
            />
          </Card>

          <SystemText variant="label" style={styles.sectionLabel}>
            Models
          </SystemText>
          <Card reveal style={styles.block}>
            <ModelPicker />
          </Card>

          <SystemText variant="label" style={styles.sectionLabel}>
            Account
          </SystemText>
          <Card reveal style={styles.block}>
            <AccountBlock />
          </Card>

          <SystemText variant="label" style={styles.sectionLabel}>
            Planner reminder
          </SystemText>
          <Card reveal style={styles.block}>
            <SystemText variant="body" style={styles.blockSub}>
              From this hour, the Quests board quietly offers to plan tomorrow with you. It never
              takes over the screen.
              {state.plansAccepted > 0
                ? ` ${state.plansAccepted} plan${state.plansAccepted === 1 ? '' : 's'} made so far.`
                : ''}
            </SystemText>
            <TimeChips
              value={state.settings?.briefingTime ?? '21:30'}
              onChange={(v) => {
                playSound('tap');
                setSetting('briefingTime', v);
              }}
            />
            {plannerConfigured() ? (
              <GhostButton
                label="Open the Planner"
                onPress={() => {
                  playSound('tap');
                  router.push('/planner');
                }}
              />
            ) : (
              <SystemText variant="meta" style={styles.notConnected}>
                Not connected yet — the planner needs its endpoint before it can run.
              </SystemText>
            )}
          </Card>

          <Card reveal tint={palette.negative} style={styles.block}>
            <SystemText variant="body" style={styles.blockSub}>
              {state.activeQuestIds.length} of {QUESTS.length} quests on your board. Resetting
              wipes all progress, stats and trophies — it cannot be undone.
            </SystemText>
            <DangerButton onPress={resetAll} />
          </Card>
        </Animated.View>
      </MotionScroll>
      {chapters.ready ? (
        <StatusRail chapters={CHAPTERS} ticks={chapters.ticks} current={chapters.current} onJump={chapters.jump} />
      ) : null}
      </View>
    </Screen>
  );
}

/** A labelled switch. The knob slides on a CSS transition, no worklets. */
function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    // Role "button", not "switch": gesture-handler's Pressable only receives
    // clicks on web when it renders as a real <button>. The on/off state is
    // still announced through accessibilityState.
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}>
      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <SystemText variant="title" style={styles.toggleLabel}>
            {label}
          </SystemText>
          <SystemText variant="meta" style={styles.toggleHint}>
            {hint}
          </SystemText>
        </View>
        <Animated.View
          style={[
            styles.track,
            {
              backgroundColor: value ? palette.accent : alpha(palette.text, 0.16),
              transitionProperty: 'backgroundColor',
              transitionDuration: '180ms',
            },
          ]}>
          <Animated.View
            style={[
              styles.knob,
              {
                transform: [{ translateX: value ? 20 : 0 }],
                transitionProperty: 'transform',
                transitionDuration: '180ms',
                transitionTimingFunction: 'ease-out',
              },
            ]}
          />
        </Animated.View>
      </View>
    </Pressable>
  );
}

function Record({
  label,
  value,
  tint,
}: {
  label: string;
  value: number | string;
  tint: string;
}) {
  return (
    <Card reveal raised style={styles.record} contentStyle={styles.recordInner}>
      <SystemText variant="label">{label}</SystemText>
      <Rolling
        text={typeof value === 'number' ? value.toLocaleString('en-US') : value}
        lineHeight={34}
        color={tint}
        style={styles.recordValue}
      />
    </Card>
  );
}

/**
 * Who is signed in, and the way to change that.
 *
 * Reads the local registry rather than the live session so the row renders
 * instantly from storage; the active session is what `switchAccount` and the
 * sign-in screen manage.
 */
function AccountBlock() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Re-read on every visit (this tab stays mounted under the sign-in screen),
  // and take "signed in" from the live session: sign-out keeps the registry.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void Promise.all([listAccounts(), currentSession().catch(() => null)]).then(
        ([list, session]) => {
          if (!alive) return;
          setAccounts(list);
          setSessionId(session?.user?.id ?? null);
        },
      );
      return () => {
        alive = false;
      };
    }, []),
  );

  const active = accounts.find((a) => a.id === sessionId);

  if (!supabaseConfigured()) {
    return (
      <>
        <SystemText variant="body" style={styles.blockSub}>
          Progress is saved on this device only. Signing in with Google would carry it to the
          browser too, but the System has no account server configured yet.
        </SystemText>
        <SystemText variant="meta" style={styles.notConnected}>
          Not connected yet.
        </SystemText>
      </>
    );
  }

  return (
    <>
      {active ? (
        <>
          <SystemText variant="body" style={styles.blockSub}>
            Signed in as {active.name} ({active.email}).
            {accounts.length > 1 ? ` ${accounts.length} accounts linked on this device.` : ''}
          </SystemText>
          <GhostButton
            label={accounts.length > 1 ? 'Switch account' : 'Link another account'}
            onPress={() => {
              playSound('tap');
              router.push('/signin');
            }}
          />
          <View style={styles.accountSpacer} />
          <GhostButton
            label="Sign out"
            onPress={() => {
              playSound('tap');
              void signOut();
              router.push('/signin');
            }}
          />
        </>
      ) : (
        <>
          <SystemText variant="body" style={styles.blockSub}>
            Progress is saved on this device. Sign in with Google to carry it between your phone
            and the browser, and to let the briefing plan around your calendar.
          </SystemText>
          <GhostButton
            label="Sign in with Google"
            onPress={() => {
              playSound('tap');
              router.push('/signin');
            }}
          />
        </>
      )}
    </>
  );
}

/**
 * Fixed half-hours rather than a time picker: one press, no keyboard, nothing
 * to spin through at bedtime.
 */
const BRIEFING_TIMES = ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30'] as const;

function TimeChips({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {BRIEFING_TIMES.map((t) => {
        const on = t === value;
        return (
          <Pressable
            key={t}
            onPress={() => onChange(t)}
            accessibilityRole="button"
            accessibilityLabel={`Briefing at ${t}`}
            accessibilityState={{ selected: on }}>
            <Animated.View
              style={[
                styles.chip,
                {
                  borderColor: on ? palette.accent : palette.borderStrong,
                  backgroundColor: on ? alpha(palette.accent, 0.18) : 'transparent',
                  transitionProperty: 'backgroundColor',
                  transitionDuration: 160,
                },
              ]}>
              <SystemText
                variant="label"
                color={on ? palette.accent : palette.textMuted}
                style={styles.chipText}>
                {t}
              </SystemText>
            </Animated.View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A flat outlined action, kept apart from DangerButton so red stays red. */
function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Animated.View
        style={[
          styles.ghost,
          {
            transform: [{ scale: pressed ? 0.98 : 1 }],
            transitionProperty: 'transform',
            transitionDuration: 110,
          },
        ]}>
        <SystemText variant="body" color={palette.text} style={styles.ghostLabel}>
          {label}
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

function DangerButton({ onPress }: { onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel="Reset all progress">
      <Animated.View
        style={[
          styles.reset,
          {
            backgroundColor: pressed ? alpha(palette.negative, 0.24) : alpha(palette.negative, 0.12),
            transitionProperty: 'backgroundColor',
            transitionDuration: 120,
          },
        ]}>
        <SystemText variant="button" color={palette.negative}>
          Reset all progress
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: space.xxl * 2 },
  sectionLabel: { marginBottom: space.sm, marginLeft: 2, color: palette.textMuted },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  labelInRow: { marginBottom: 0 },
  block: { marginBottom: space.xl },
  blockSub: { fontSize: 13, lineHeight: 18, marginBottom: space.md },

  activityInner: { padding: space.lg },

  abilities: { gap: space.lg },
  abilitiesWide: { flexDirection: 'row', alignItems: 'center' },
  radar: { alignItems: 'center' },
  ratingList: { flex: 1, minWidth: 0, gap: space.sm },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  ratingDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  ratingGlyph: { width: 18, fontSize: 14 },
  ratingName: { flex: 1, fontSize: 15 },
  // The signature: big figures, hard right.
  ratingValue: { fontSize: 28, lineHeight: 34, textAlign: 'right' },

  recordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.xl },
  record: { flexGrow: 1, flexBasis: 150, minWidth: 150 },
  recordInner: { padding: space.md, gap: 2 },
  recordValue: { fontSize: 28, lineHeight: 34, letterSpacing: -0.8 },

  catList: { gap: space.md },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  catGlyph: { width: 14, fontSize: 11 },
  catName: { width: 52, fontSize: 10 },
  catTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: alpha(palette.text, 0.1),
    overflow: 'hidden',
  },
  catFill: { height: '100%', width: '100%' },
  catDays: { width: 34, textAlign: 'right', fontSize: 11 },

  accountSpacer: { height: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  chipText: { fontSize: 10, letterSpacing: 1.2 },
  notConnected: { fontSize: 11, lineHeight: 16 },
  ghost: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: space.lg,
    marginTop: space.sm,
  },

  ghostLabel: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.sm },
  toggleText: { flex: 1, minWidth: 0 },
  toggleLabel: { fontSize: 15 },
  toggleHint: { fontSize: 11, marginTop: 1 },
  toggleDivider: { height: 1, backgroundColor: palette.border, marginVertical: space.sm },
  track: { width: 44, height: 24, borderRadius: 12, padding: 2, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.bg },
  reset: {
    borderWidth: 1,
    borderColor: alpha(palette.negative, 0.5),
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: space.md,
    marginTop: space.sm,
  },
});
