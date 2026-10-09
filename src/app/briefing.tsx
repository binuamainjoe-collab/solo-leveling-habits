import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { Screen } from '@/components/system/Screen';
import { SystemText } from '@/components/system/SystemText';
import { alpha, font, palette, radius, space } from '@/constants/theme';
import {
  requestPlan,
  type BriefingTurn,
  type PlannedTask,
} from '@/data/planner';
import { feedback, playSound } from '@/lib/feedback';
import { todayKey, useProgress } from '@/store/progress';

/** Tomorrow, in the log's date format. */
function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return todayKey(d);
}

function prettyDate(key: string): string {
  const [y, m, day] = key.split('-').map(Number);
  const d = new Date(y, m - 1, day);
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function BriefingScreen() {
  const { acceptPlan, dismissBriefing } = useProgress();
  const date = tomorrowKey();

  const [history, setHistory] = useState<BriefingTurn[]>([]);
  const [tasks, setTasks] = useState<PlannedTask[] | null>(null);
  const [note, setNote] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPlan = tasks !== null && tasks.length > 0;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    playSound('tap');
    setBusy(true);
    setError(null);
    setInput('');

    const next: BriefingTurn[] = [...history, { role: 'user', text }];
    setHistory(next);

    const result = await requestPlan(next);

    if (!result.ok || !result.tasks) {
      setError(result.error ?? 'Something went wrong.');
      setBusy(false);
      return;
    }

    setTasks(result.tasks);
    setNote(result.note ?? '');
    // The model's own turn goes back next time, so a refinement like "move gym
    // to evening" has something concrete to move.
    setHistory([
      ...next,
      {
        role: 'model',
        // Ids are ours, not the model's — sending them back would only invite
        // it to echo them as if they meant something.
        text: JSON.stringify({
          tasks: result.tasks.map(({ title, minutes, priority, window }) => ({
            title,
            minutes,
            priority,
            window,
          })),
          note: result.note ?? '',
        }),
      },
    ]);
    setBusy(false);
  }

  function accept() {
    if (!tasks || tasks.length === 0) return;
    feedback('complete', 'success');
    acceptPlan(date, tasks, note);
    router.replace('/');
  }

  function later() {
    playSound('tap');
    // Recorded against tomorrow's date, so the gate stays quiet tonight but
    // offers itself again tomorrow evening.
    dismissBriefing(date);
    router.replace('/');
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <SystemText variant="label" color={palette.accent} style={styles.kicker}>
          ◆ System briefing ◆
        </SystemText>
        <SystemText variant="hero" style={styles.title}>
          PLAN TOMORROW
        </SystemText>
        <SystemText variant="body" style={styles.sub}>
          {prettyDate(date)}. Say what you want to get done — roughly is fine, no order needed.
        </SystemText>

        {/* the plan */}
        {hasPlan ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.planBlock}>
            {note ? (
              <Card tint={palette.accent} style={styles.noteCard}>
                <SystemText variant="body" style={styles.noteText}>
                  {note}
                </SystemText>
              </Card>
            ) : null}

            {tasks.map((t, i) => (
              <Animated.View
                key={t.id}
                entering={FadeInDown.duration(280).delay(Math.min(400, i * 60))}
                layout={LinearTransition.duration(240)}>
                <Card raised style={styles.taskCard} contentStyle={styles.taskInner}>
                  <View style={styles.taskTop}>
                    <View
                      style={[
                        styles.priority,
                        {
                          borderColor: alpha(
                            t.priority === 1 ? palette.accent : palette.textMuted,
                            0.6,
                          ),
                          backgroundColor:
                            t.priority === 1 ? alpha(palette.accent, 0.18) : 'transparent',
                        },
                      ]}>
                      <SystemText
                        variant="label"
                        color={t.priority === 1 ? palette.accent : palette.textMuted}
                        style={styles.priorityText}>
                        {t.priority === 1 ? 'FIRST' : `P${t.priority}`}
                      </SystemText>
                    </View>
                    <SystemText variant="label" style={styles.window}>
                      {t.window}
                    </SystemText>
                    <SystemText variant="label" color={palette.textMuted} style={styles.minutes}>
                      {t.minutes} min
                    </SystemText>
                  </View>
                  <SystemText variant="title" style={styles.taskTitle} numberOfLines={3}>
                    {t.title}
                  </SystemText>
                </Card>
              </Animated.View>
            ))}
          </Animated.View>
        ) : null}

        {error ? (
          <Animated.View entering={FadeIn.duration(220)}>
            <Card tint={palette.negative} style={styles.errorCard}>
              <SystemText variant="label" color={palette.negative}>
                Briefing failed
              </SystemText>
              <SystemText variant="body" style={styles.errorBody}>
                {error}
              </SystemText>
            </Card>
          </Animated.View>
        ) : null}

        {/* input */}
        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={
              hasPlan ? 'Change something — "move gym to evening"' : 'Gym, finish the essay, laundry…'
            }
            placeholderTextColor={palette.textFaint}
            style={styles.input}
            multiline
            editable={!busy}
            accessibilityLabel={hasPlan ? 'Adjust the plan' : 'What do you want to do tomorrow?'}
          />
        </View>

        <ActionButton
          label={busy ? 'Thinking…' : hasPlan ? 'Adjust plan' : 'Draft my plan'}
          onPress={send}
          disabled={busy || input.trim().length === 0}
          busy={busy}
        />

        {hasPlan && !busy ? (
          <Animated.View entering={FadeIn.duration(260)}>
            <ActionButton label="Accept plan" onPress={accept} primary />
          </Animated.View>
        ) : null}

        <Pressable onPress={later} accessibilityRole="button" accessibilityLabel="Not tonight">
          <View style={styles.later}>
            <SystemText variant="label" color={palette.textMuted}>
              Not tonight
            </SystemText>
          </View>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

/**
 * One flat pressable — never a pressable inside another, which react-native-web
 * renders as a `<button>` inside a `<button>`.
 */
function ActionButton({
  label,
  onPress,
  disabled,
  primary,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  busy?: boolean;
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
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}>
      <Animated.View
        style={[
          styles.action,
          primary ? styles.actionPrimary : styles.actionGhost,
          {
            opacity: disabled ? 0.4 : 1,
            transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
            transitionProperty: 'transform',
            transitionDuration: '110ms',
          },
        ]}>
        {busy ? <ActivityIndicator size="small" color={palette.text} /> : null}
        <SystemText variant="label" color={primary ? palette.bg : palette.text} style={styles.actionLabel}>
          {label}
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl * 2, gap: space.md },
  kicker: { fontSize: 10, letterSpacing: 3 },
  title: { fontSize: 32, marginTop: space.xs },
  sub: { fontSize: 14, lineHeight: 20, marginBottom: space.md },

  planBlock: { gap: space.sm },
  noteCard: { marginBottom: space.xs },
  noteText: { fontSize: 14, lineHeight: 20, fontStyle: 'italic', color: palette.text },
  taskCard: { marginBottom: 0 },
  taskInner: { padding: space.md, gap: space.xs },
  taskTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  priority: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  priorityText: { fontSize: 8, letterSpacing: 1.2 },
  window: { flex: 1, fontSize: 9, color: palette.textMuted },
  minutes: { fontSize: 9 },
  taskTitle: { fontSize: 16, lineHeight: 20 },

  errorCard: { marginTop: space.sm },
  errorBody: { fontSize: 13, lineHeight: 18, marginTop: 4 },

  inputRow: { marginTop: space.md },
  input: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    color: palette.text,
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 88,
    textAlignVertical: 'top',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    paddingVertical: space.lg,
  },
  actionGhost: { borderWidth: 1, borderColor: palette.borderStrong },
  actionPrimary: { backgroundColor: palette.accent },
  actionLabel: { fontSize: 11, letterSpacing: 2 },

  later: { alignItems: 'center', paddingVertical: space.lg },
});
