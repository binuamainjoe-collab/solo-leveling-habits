import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInRight } from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { Screen } from '@/components/system/Screen';
import { SystemText } from '@/components/system/SystemText';
import { alpha, categoryMeta, font, palette, radius, space } from '@/constants/theme';
import {
  AGE_BANDS,
  buildPlan,
  COMMITMENTS,
  describePlan,
  GOALS,
  STUDY_METHODS,
  TRAINING_MODES,
  type AgeBand,
  type Commitment,
  type GoalId,
  type Profile,
  type StudyMethodId,
  type TrainingMode,
} from '@/data/profile';
import { QUESTS_BY_ID } from '@/data/quests';
import { playSound } from '@/lib/feedback';
import { useProgress } from '@/store/progress';

const STEPS = ['name', 'age', 'goals', 'training', 'study', 'commitment', 'review'] as const;
type Step = (typeof STEPS)[number];

export default function OnboardingScreen() {
  const { completeOnboarding } = useProgress();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [goals, setGoals] = useState<GoalId[]>([]);
  const [training, setTraining] = useState<TrainingMode | null>(null);
  const [studyMethods, setStudyMethods] = useState<StudyMethodId[]>([]);
  const [commitment, setCommitment] = useState<Commitment | null>(null);

  const current: Step = STEPS[step];

  const draft = useMemo<Profile>(
    () => ({
      name: name.trim() || 'Hunter',
      ageBand: ageBand ?? '16to18',
      goals,
      training: training ?? 'none',
      studyMethods,
      commitment: commitment ?? 'standard',
      createdAt: new Date().toISOString(),
    }),
    [name, ageBand, goals, training, studyMethods, commitment],
  );

  const plan = useMemo(() => (current === 'review' ? buildPlan(draft) : []), [current, draft]);

  const canContinue = (() => {
    switch (current) {
      case 'name':
        return name.trim().length > 0;
      case 'age':
        return ageBand !== null;
      case 'goals':
        return goals.length > 0;
      case 'training':
        return training !== null;
      case 'study':
        return true; // studying is optional — not every student is here for grades
      case 'commitment':
        return commitment !== null;
      case 'review':
        return true;
    }
  })();

  const toggle = <T,>(list: T[], set: (v: T[]) => void, value: T, max = 99) => {
    if (list.includes(value)) set(list.filter((v) => v !== value));
    else if (list.length < max) set([...list, value]);
  };

  return (
    <Screen>
      {/* step meter, in the same segmented language as the XP bar */}
      <View style={styles.meter}>
        {STEPS.map((s, i) => (
          <Animated.View
            key={s}
            style={[
              styles.meterSeg,
              {
                backgroundColor: i <= step ? palette.accent : alpha(palette.text, 0.12),
                transitionProperty: 'backgroundColor',
                transitionDuration: '260ms',
              },
            ]}
          />
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Animated.View key={current} entering={FadeInRight.duration(280)}>
          {current === 'name' ? (
            <Stepper
              kicker="First — who are you?"
              title="THE SYSTEM NEEDS A NAME"
              blurb="This is what the System calls you. Nothing leaves your device.">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={palette.textFaint}
                style={styles.input}
                autoFocus
                maxLength={24}
                returnKeyType="done"
                accessibilityLabel="Your name"
              />
            </Stepper>
          ) : null}

          {current === 'age' ? (
            <Stepper
              kicker="How old are you?"
              title="HUNTER REGISTRATION"
              blurb="Used only to pitch the plan sensibly. No other personal details are asked for.">
              {AGE_BANDS.map((b) => (
                <Choice
                  key={b.id}
                  title={b.label}
                  selected={ageBand === b.id}
                  onPress={() => setAgeBand(b.id)}
                />
              ))}
            </Stepper>
          ) : null}

          {current === 'goals' ? (
            <Stepper
              kicker="Pick up to four"
              title="WHAT ARE YOU HERE FOR?"
              blurb="Your quests are chosen from these. You can change them any time in the Archive.">
              {GOALS.map((g) => (
                <Choice
                  key={g.id}
                  glyph={g.glyph}
                  title={g.label}
                  blurb={g.blurb}
                  selected={goals.includes(g.id)}
                  onPress={() => toggle(goals, setGoals, g.id, 4)}
                />
              ))}
            </Stepper>
          ) : null}

          {current === 'training' ? (
            <Stepper
              kicker="Training"
              title="WHAT IS THE BODY FOR?"
              blurb="This decides which nutrition and lifting quests you get.">
              {TRAINING_MODES.map((t) => (
                <Choice
                  key={t.id}
                  title={t.label}
                  blurb={t.blurb}
                  detail={training === t.id ? t.detail : undefined}
                  selected={training === t.id}
                  onPress={() => setTraining(t.id)}
                />
              ))}
            </Stepper>
          ) : null}

          {current === 'study' ? (
            <Stepper
              kicker="Optional — pick what you'll actually use"
              title="HOW WILL YOU STUDY?"
              blurb="Ratings follow Dunlosky et al. (2013), which graded ten common study techniques against the evidence. Highlighting and rereading were rated low — they feel productive without building recall.">
              {STUDY_METHODS.map((m) => (
                <Choice
                  key={m.id}
                  title={m.label}
                  blurb={m.how}
                  detail={studyMethods.includes(m.id) ? m.why : undefined}
                  badge={m.utility}
                  badgeTone={m.utility === 'High' ? palette.positive : palette.gold}
                  selected={studyMethods.includes(m.id)}
                  onPress={() => toggle(studyMethods, setStudyMethods, m.id)}
                />
              ))}
            </Stepper>
          ) : null}

          {current === 'commitment' ? (
            <Stepper
              kicker="Be honest"
              title="HOW HARD, DAY ONE?"
              blurb="Starting too big is the usual reason people quit in week two. You can raise this later.">
              {COMMITMENTS.map((c) => (
                <Choice
                  key={c.id}
                  title={c.label}
                  blurb={c.blurb}
                  trailing={`${c.size} quests`}
                  selected={commitment === c.id}
                  onPress={() => setCommitment(c.id)}
                />
              ))}
            </Stepper>
          ) : null}

          {current === 'review' ? (
            <Stepper
              kicker={`Welcome, ${draft.name}`}
              title="YOUR PLAN IS READY"
              blurb={describePlan(draft, plan)}>
              <Card style={styles.planCard} contentStyle={styles.planInner}>
                {plan.map((id, i) => {
                  const quest = QUESTS_BY_ID[id];
                  if (!quest) return null;
                  const cat = categoryMeta[quest.category];
                  return (
                    <Animated.View
                      key={id}
                      entering={FadeIn.delay(Math.min(600, i * 40)).duration(300)}
                      style={[styles.planRow, i > 0 && styles.planDivider]}>
                      <SystemText variant="title" style={styles.planGlyph}>
                        {quest.glyph}
                      </SystemText>
                      <View style={styles.planText}>
                        <SystemText variant="title" style={styles.planTitle} numberOfLines={1}>
                          {quest.title}
                        </SystemText>
                        <SystemText variant="meta" numberOfLines={1}>
                          {quest.objective}
                        </SystemText>
                      </View>
                      <SystemText variant="label" color={cat.color}>
                        {cat.short}
                      </SystemText>
                    </Animated.View>
                  );
                })}
              </Card>
              <SystemText variant="meta" style={styles.reviewNote}>
                Every quest is editable, and all 106 are in the Archive whenever you want more.
              </SystemText>
            </Stepper>
          ) : null}
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 ? (
          <GhostButton label="Back" onPress={() => setStep((s) => s - 1)} />
        ) : (
          <View style={styles.footerSpacer} />
        )}
        <PrimaryButton
          label={current === 'review' ? 'Begin day 1' : 'Continue'}
          disabled={!canContinue}
          onPress={() => {
            if (current === 'review') completeOnboarding(draft);
            else setStep((s) => s + 1);
          }}
        />
      </View>
    </Screen>
  );
}

/* ------------------------------------------------------------ pieces */

function Stepper({
  kicker,
  title,
  blurb,
  children,
}: {
  kicker: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <SystemText variant="label" color={palette.accent} style={styles.kicker}>
        {kicker}
      </SystemText>
      <SystemText variant="hero" style={styles.title}>
        {title}
      </SystemText>
      <SystemText variant="body" style={styles.blurb}>
        {blurb}
      </SystemText>
      <View style={styles.choices}>{children}</View>
    </View>
  );
}

function Choice({
  title,
  blurb,
  detail,
  glyph,
  badge,
  badgeTone,
  trailing,
  selected,
  onPress,
}: {
  title: string;
  blurb?: string;
  detail?: string;
  glyph?: string;
  badge?: string;
  badgeTone?: string;
  trailing?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        playSound('tap');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={title}>
      <Animated.View
        style={[
          styles.choice,
          {
            borderColor: selected ? palette.accent : palette.border,
            backgroundColor: selected ? alpha(palette.accent, 0.12) : palette.surface,
            transitionProperty: ['borderColor', 'backgroundColor'],
            transitionDuration: ['160ms', '160ms'],
          },
        ]}>
        <View style={styles.choiceHead}>
          {glyph ? <SystemText variant="title" style={styles.choiceGlyph}>{glyph}</SystemText> : null}
          <View style={styles.choiceText}>
            <View style={styles.choiceTitleRow}>
              <SystemText variant="title" color={selected ? palette.accent : palette.text}>
                {title}
              </SystemText>
              {badge ? (
                <View style={[styles.badge, { borderColor: alpha(badgeTone ?? palette.gold, 0.6) }]}>
                  <SystemText variant="label" color={badgeTone ?? palette.gold}>
                    {badge} utility
                  </SystemText>
                </View>
              ) : null}
            </View>
            {blurb ? (
              <SystemText variant="meta" style={styles.choiceBlurb}>
                {blurb}
              </SystemText>
            ) : null}
          </View>
          {trailing ? (
            <SystemText variant="label" color={palette.textMuted}>
              {trailing}
            </SystemText>
          ) : null}
          <View
            style={[
              styles.tick,
              selected && { borderColor: palette.accent, backgroundColor: palette.accent },
            ]}>
            {selected ? (
              <SystemText variant="label" color={palette.bg} style={styles.tickMark}>
                ✓
              </SystemText>
            ) : null}
          </View>
        </View>

        {detail ? (
          <Animated.View entering={FadeIn.duration(220)}>
            <SystemText variant="meta" style={styles.detail}>
              {detail}
            </SystemText>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
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
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={styles.primaryWrap}>
      <Animated.View
        style={[
          styles.primary,
          {
            opacity: disabled ? 0.35 : 1,
            transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
            transitionProperty: 'transform',
            transitionDuration: '110ms',
          },
        ]}>
        <SystemText variant="label" color={palette.bg} style={styles.primaryLabel}>
          {label}
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.ghost}>
        <SystemText variant="label" color={palette.textMuted}>
          {label}
        </SystemText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  meter: { flexDirection: 'row', gap: 3, marginBottom: space.xl },
  meterSeg: { flex: 1, height: 4, borderRadius: 2 },
  scroll: { paddingBottom: space.xl },
  kicker: { fontSize: 10, letterSpacing: 2 },
  title: { fontSize: 30, lineHeight: 36, marginTop: space.xs },
  blurb: { fontSize: 14, lineHeight: 20, marginTop: space.sm },
  choices: { marginTop: space.xl, gap: space.md },

  input: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    color: palette.text,
    fontFamily: font.heading,
    fontSize: 22,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },

  choice: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  choiceGlyph: { fontSize: 20 },
  choiceText: { flex: 1, minWidth: 0 },
  choiceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  choiceBlurb: { marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickMark: { fontSize: 11, letterSpacing: 0 },
  detail: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    lineHeight: 18,
  },

  planCard: { marginTop: 0 },
  planInner: { padding: space.md },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  planDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  planGlyph: { fontSize: 18, width: 24 },
  planText: { flex: 1, minWidth: 0 },
  planTitle: { fontSize: 14 },
  reviewNote: { marginTop: space.md, textAlign: 'center' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
  },
  footerSpacer: { width: 0 },
  ghost: { paddingHorizontal: space.lg, paddingVertical: space.md },
  primaryWrap: { flex: 1 },
  primary: {
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: space.lg,
  },
  primaryLabel: { fontSize: 11, letterSpacing: 2 },
});
