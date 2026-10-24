import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, palette, radius, space } from '@/constants/theme';
import { plannerConfigured } from '@/data/planner';
import { defaultPlanDate, toMinutes, weekdayOf } from '@/data/timeline';
import { playSound } from '@/lib/feedback';
import { useProgress } from '@/store/progress';

/**
 * A quiet prompt on the Quests board once the planning hour arrives.
 *
 * This replaces a gate that used to take over the screen at 21:30 — and, if
 * you backed out of it without deciding, dragged you back within a minute.
 * A prompt you can ignore is the right weight for an ADHD student at night:
 * present, but never trapping.
 */
export function PlanNudge() {
  const { state, dismissBriefing } = useProgress();
  const [, setTick] = useState(0);

  // Re-check each minute so the prompt appears on time with the app open.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!plannerConfigured()) return null;

  const now = new Date();
  const at = state.settings?.briefingTime ?? '21:30';
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  // After the planning hour, or in the small hours before the 04:00 rollover
  // — still "tonight" for someone who has not slept.
  const evening = minutesNow >= toMinutes(at) || now.getHours() < 4;
  if (!evening) return null;

  const date = defaultPlanDate(now);
  if (state.plans[date]) return null;
  if (state.briefingDismissed === date) return null;

  const day = date === state.date ? 'today' : weekdayOf(date);

  return (
    <Animated.View entering={FadeIn.duration(260)} exiting={FadeOut.duration(180)} style={styles.card}>
      <View style={styles.text}>
        <SystemText variant="label" color={palette.textMuted} style={styles.kicker}>
          Planner
        </SystemText>
        <SystemText variant="title" style={styles.title}>
          Plan {day}?
        </SystemText>
        <SystemText variant="meta" style={styles.body}>
          A few questions, then the day laid out with room to breathe.
        </SystemText>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            playSound('tap');
            router.push({ pathname: '/planner-chat', params: { date } });
          }}
          accessibilityRole="button"
          accessibilityLabel={`Plan ${day}`}>
          <View style={styles.go}>
            <SystemText variant="body" color={palette.bg} style={styles.goLabel}>
              Plan it
            </SystemText>
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            playSound('tap');
            dismissBriefing(date);
          }}
          accessibilityRole="button"
          accessibilityLabel="Not tonight">
          <View style={styles.later}>
            <SystemText variant="body" color={palette.text} style={styles.goLabel}>
              Not tonight
            </SystemText>
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.22),
    borderRadius: radius.xl,
    padding: space.lg,
    marginBottom: space.lg,
  },
  text: { flex: 1, minWidth: 220, gap: 2 },
  kicker: { color: palette.accentSoft },
  title: { fontSize: 20, lineHeight: 25 },
  body: { color: palette.textMuted },
  actions: { flexDirection: 'row', gap: space.sm },
  go: {
    minHeight: HIT,
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
  },
  goLabel: { fontWeight: '600' },
  later: {
    minHeight: HIT,
    backgroundColor: alpha(palette.text, 0.08),
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
  },
});
