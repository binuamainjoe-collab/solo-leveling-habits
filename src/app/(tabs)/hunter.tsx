import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useEffect, useState } from 'react';

import { Card } from '@/components/system/Card';
import { Screen } from '@/components/system/Screen';
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
} from '@/constants/theme';
import { ACHIEVEMENTS } from '@/data/achievements';
import { plannerConfigured } from '@/data/planner';
import { listAccounts, signOut, type Account } from '@/lib/auth';
import { supabaseConfigured } from '@/lib/supabase';
import { QUESTS } from '@/data/quests';
import { playSound } from '@/lib/feedback';
import { useProgress } from '@/store/progress';

export default function HunterScreen() {
  const { state, resetAll, setSetting } = useProgress();

  const maxCategory = Math.max(...CATEGORIES.map((c) => state.categoryDays[c] ?? 0), 1);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <StatusHeader />

        {/* Ability scores — Life Reset's "Your Rating": tiny caps label on the
            left, an oversized numeral hard-right, hairline between rows. The
            numbers are the hero here, not the labels. */}
        <Animated.View entering={FadeInDown.duration(360)}>
          <SystemText variant="label" style={styles.sectionLabel}>
            Ability scores
          </SystemText>
          <Card style={styles.block} contentStyle={styles.ratingInner}>
            {STATS.map((key, i) => {
              const meta = statMeta[key];
              const value = state.stats[key] ?? 0;
              return (
                <View key={key} style={[styles.ratingRow, i > 0 && styles.ratingDivider]}>
                  <SystemText variant="title" color={meta.color} style={styles.ratingGlyph}>
                    {meta.glyph}
                  </SystemText>
                  <SystemText variant="label" style={styles.ratingName}>
                    {meta.label}
                  </SystemText>
                  <SystemText variant="numeral" color={meta.color} style={styles.ratingValue}>
                    {value}
                  </SystemText>
                </View>
              );
            })}
          </Card>
        </Animated.View>

        {/* 30-day activity, straight off the day log */}
        <Animated.View entering={FadeInDown.duration(360).delay(60)}>
          <SystemText variant="label" style={styles.sectionLabel}>
            Calendar
          </SystemText>
          <Card style={styles.block} contentStyle={styles.activityInner}>
            <MonthCalendar />
          </Card>
        </Animated.View>

        {/* Lifetime record */}
        <Animated.View entering={FadeInDown.duration(360).delay(80)}>
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
        <Animated.View entering={FadeInDown.duration(360).delay(160)}>
          <SystemText variant="label" style={styles.sectionLabel}>
            Discipline coverage
          </SystemText>
          <Card style={styles.block}>
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
        <Animated.View entering={FadeInDown.duration(360).delay(240)}>
          <SystemText variant="label" style={styles.sectionLabel}>
            System
          </SystemText>
          <Card style={styles.block}>
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
          </Card>

          <SystemText variant="label" style={styles.sectionLabel}>
            Account
          </SystemText>
          <Card style={styles.block}>
            <AccountBlock />
          </Card>

          <SystemText variant="label" style={styles.sectionLabel}>
            Nightly briefing
          </SystemText>
          <Card style={styles.block}>
            <SystemText variant="body" style={styles.blockSub}>
              After this hour the System offers to plan tomorrow with you. Say roughly what you
              want to get done; it comes back with an unhurried order and room to breathe.
              {state.plansAccepted > 0
                ? ` ${state.plansAccepted} plan${state.plansAccepted === 1 ? '' : 's'} accepted so far.`
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
                label="▶ Plan tomorrow now"
                onPress={() => {
                  playSound('tap');
                  router.push('/briefing');
                }}
              />
            ) : (
              <SystemText variant="meta" style={styles.notConnected}>
                Not connected yet — the planner needs its endpoint before a briefing can run.
              </SystemText>
            )}
          </Card>

          <Card tint={palette.negative} style={styles.block}>
            <SystemText variant="body" style={styles.blockSub}>
              {state.activeQuestIds.length} of {QUESTS.length} quests on your board. Resetting
              wipes all progress, stats and trophies — it cannot be undone.
            </SystemText>
            <DangerButton onPress={resetAll} />
          </Card>
        </Animated.View>
      </ScrollView>
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
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
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
    <Card raised style={styles.record} contentStyle={styles.recordInner}>
      <SystemText variant="label">{label}</SystemText>
      <SystemText variant="numeral" color={tint} style={styles.recordValue}>
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </SystemText>
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

  useEffect(() => {
    void listAccounts().then(setAccounts);
  }, []);

  const active = accounts[0];

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
            label={accounts.length > 1 ? '⇄ Switch account' : '＋ Link another account'}
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
            label="▶ Sign in with Google"
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
            accessibilityRole="radio"
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
        <SystemText variant="label">{label}</SystemText>
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
        <SystemText variant="label" color={palette.negative}>
          ⟲ Reset all progress
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl * 2 },
  sectionLabel: { marginBottom: space.sm, marginLeft: 2, color: palette.textMuted },
  block: { marginBottom: space.xl },
  blockSub: { fontSize: 13, lineHeight: 18, marginBottom: space.md },

  activityInner: { padding: space.lg },

  ratingInner: { paddingVertical: space.xs, paddingHorizontal: space.lg },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  ratingDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  ratingGlyph: { width: 18, fontSize: 14 },
  ratingName: { flex: 1, fontSize: 11, color: palette.textMuted },
  // The signature: oversized, hard-right, tight tracking.
  ratingValue: { fontSize: 42, lineHeight: 48, textAlign: 'right', letterSpacing: -1.5 },

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
    paddingVertical: space.md,
  },

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
