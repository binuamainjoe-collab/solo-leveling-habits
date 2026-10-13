import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, TextInput, View } from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { ReportOverlay } from '@/components/system/ReportOverlay';
import { Screen } from '@/components/system/Screen';
import { SystemText } from '@/components/system/SystemText';
import { alpha, font, palette, radius, rankMeta, space } from '@/constants/theme';
import {
  AGENTS,
  latestRuns,
  sortFindings,
  unjudged,
  xpForFinding,
  type AgentDef,
  type AgentRun,
  type Finding,
  type Report,
  type Verdict,
} from '@/data/agents';
import { artFor } from '@/data/cardArt';
import { validateGoalTitle } from '@/data/goals';
import { feedback, playSound } from '@/lib/feedback';
import {
  fetchGoalState,
  fetchLatestReport,
  markFindingRead,
  runScout,
  runSteward,
  setGoal as saveGoal,
  shadowsConfigured,
  type GoalState,
} from '@/lib/shadows';
import { useProgress } from '@/store/progress';

/** How each ruling reads, and how loudly. */
const VERDICT_META: Record<Verdict, { label: string; color: string }> = {
  'must-read': { label: 'MUST READ', color: palette.accent },
  read: { label: 'READ', color: palette.text },
  skim: { label: 'SKIM', color: palette.textMuted },
  skip: { label: 'SKIP', color: palette.textFaint },
};

/**
 * The long-term half of the app.
 *
 * One goal at a time, worked on by a roster of shadows. The daily quest board
 * is untouched by anything here — a habit is something you repeat, a goal is
 * something you finish, and mixing them makes both harder to see.
 */
export default function GoalScreen() {
  const { addXp } = useProgress();

  // Reading the env vars is a constant for the life of the process, so it can
  // seed the initial state. That matters: it means the "nothing to load" case
  // needs no setState at all, and the effect below never writes state
  // synchronously.
  const configured = shadowsConfigured();

  const [state, setState] = useState<GoalState | null>(null);
  const [loading, setLoading] = useState(configured);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // The Steward's reading, and whether its panel is open over the screen.
  const [report, setReport] = useState<Report | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!configured) return;
    const res = await fetchGoalState();
    if (res.ok && res.data) {
      setState(res.data);
      setError(null);
    } else {
      setError(res.error ?? 'The System could not reach your goal.');
    }
    setLoading(false);
  }, [configured]);

  // The first load is written out inline rather than calling `load()`: the
  // state writes then plainly sit after an await, and the screen gets proper
  // cancellation if it unmounts while the request is still in flight.
  useEffect(() => {
    if (!configured) return;
    let alive = true;

    (async () => {
      // Both in one pass: the report is independent of the goal, and
      // serialising them would show a half-populated screen for a beat.
      const [res, rep] = await Promise.all([fetchGoalState(), fetchLatestReport()]);
      if (!alive) return;
      if (res.ok && res.data) {
        setState(res.data);
        setError(null);
      } else {
        setError(res.error ?? 'The System could not reach your goal.');
      }
      if (rep.ok) setReport(rep.data ?? null);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [configured]);

  async function commitGoal() {
    const check = validateGoalTitle(draft);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    playSound('tap');
    setBusy('goal');
    setError(null);

    const res = await saveGoal(check.title);
    if (res.ok) {
      feedback('complete', 'success');
      setDraft('');
      await load();
    } else {
      setError(res.error ?? 'The System could not set that goal.');
    }
    setBusy(null);
  }

  async function summon(agent: AgentDef) {
    playSound('tap');
    setBusy(agent.id);
    setError(null);
    setNotice(null);

    // The Steward reads rather than searches, so it reports differently and
    // opens its panel the moment it has something to say.
    if (agent.id === 'steward-report') {
      const res = await runSteward();
      if (res.ok && res.data) {
        feedback('complete', 'success');
        const fresh = await fetchLatestReport();
        if (fresh.ok) setReport(fresh.data ?? null);
        setReportOpen(true);
        if (res.data.delivery === 'email-failed') {
          setNotice('The reading is ready, but the email did not send.');
        }
        await load();
      } else {
        setError(res.error ?? 'The Steward had nothing to say.');
      }
      setBusy(null);
      return;
    }

    const res = await runScout();
    if (res.ok && res.data) {
      feedback('complete', 'success');
      const { added, skipped, note } = res.data;
      setNotice(
        note ??
          (added > 0
            ? `${agent.name} returned with ${added} ${added === 1 ? 'finding' : 'findings'}` +
              (skipped > 0 ? `, and ${skipped} you already had.` : '.')
            : 'Nothing new this time — everything found was already on file.'),
      );
      await load();
    } else {
      setError(res.error ?? 'The shadow did not return.');
    }
    setBusy(null);
  }

  /** Open the last reading without spending a call on a new one. */
  function openReport() {
    playSound('tap');
    setReportOpen(true);
  }

  async function toggleRead(finding: Finding) {
    const next = finding.readAt === null;
    playSound(next ? 'complete' : 'tap');

    // Optimistic: the row flips immediately and is put back if the write
    // fails. Waiting on a round trip to tick a checkbox feels broken.
    setState((s) =>
      s
        ? {
            ...s,
            findings: s.findings.map((f) =>
              f.id === finding.id ? { ...f, readAt: next ? new Date().toISOString() : null } : f,
            ),
          }
        : s,
    );

    const res = await markFindingRead(finding.id, next);
    if (!res.ok) {
      setError(res.error ?? 'That did not save.');
      await load();
      return;
    }

    // Only a must-read pays, and only on the way in — un-marking takes it
    // back so the toggle cannot be farmed.
    const award = xpForFinding(finding);
    if (award > 0) addXp(next ? award : -award);
  }

  const goal = state?.goal ?? null;
  const findings = state ? sortFindings(state.findings) : [];
  const pending = state ? unjudged(state.findings).length : 0;
  const runs = state ? latestRuns(state.runs) : {};

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <SystemText variant="label" color={palette.accent} style={styles.kicker}>
          ◆ Long-term ◆
        </SystemText>
        <SystemText variant="hero" style={styles.title} numberOfLines={3}>
          {goal ? goal.title.toUpperCase() : 'NO GOAL SET'}
        </SystemText>

        {!configured ? (
          <Card tint={palette.negative} style={styles.block}>
            <SystemText variant="label" color={palette.negative}>
              The army sleeps
            </SystemText>
            <SystemText variant="body" style={styles.blockBody}>
              No server is configured, so the shadows cannot be raised. Your daily quests are
              unaffected.
            </SystemText>
          </Card>
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : (
          <>
            {/* Setting or replacing the goal */}
            {!goal ? (
              <Animated.View entering={FadeIn.duration(260)}>
                <SystemText variant="body" style={styles.sub}>
                  Name one thing you are working towards. One at a time — the System will not
                  split its attention, and neither should you.
                </SystemText>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Get into medical school by next June"
                  placeholderTextColor={palette.textFaint}
                  style={styles.input}
                  multiline
                  editable={busy === null}
                  accessibilityLabel="Your long-term goal"
                />
                <ActionButton
                  label="Set this goal"
                  onPress={() => void commitGoal()}
                  disabled={busy !== null || draft.trim().length === 0}
                  busy={busy === 'goal'}
                  primary
                />
              </Animated.View>
            ) : null}

            {/* The roster */}
            {goal ? (
              <>
                <SystemText variant="label" style={styles.sectionLabel}>
                  Shadow army
                </SystemText>
                {AGENTS.map((agent, i) => (
                  <Animated.View
                    key={agent.id}
                    entering={FadeInDown.duration(280).delay(Math.min(240, i * 70))}>
                    <ShadowCard
                      agent={agent}
                      run={runs[agent.id] ?? null}
                      pending={agent.id === 'igris-judge' ? pending : 0}
                      busy={busy === agent.id}
                      disabled={busy !== null}
                      onSummon={() => void summon(agent)}
                      report={agent.id === 'steward-report' ? report : null}
                      onOpenReport={openReport}
                    />
                  </Animated.View>
                ))}
              </>
            ) : null}

            {notice ? (
              <Animated.View entering={FadeIn.duration(220)}>
                <Card style={styles.block}>
                  <SystemText variant="body" style={styles.noticeText}>
                    {notice}
                  </SystemText>
                </Card>
              </Animated.View>
            ) : null}

            {error ? (
              <Animated.View entering={FadeIn.duration(220)}>
                <Card tint={palette.negative} style={styles.block}>
                  <SystemText variant="label" color={palette.negative}>
                    The run failed
                  </SystemText>
                  <SystemText variant="body" style={styles.blockBody}>
                    {error}
                  </SystemText>
                </Card>
              </Animated.View>
            ) : null}

            {/* What came back */}
            {findings.length > 0 ? (
              <>
                <SystemText variant="label" style={styles.sectionLabel}>
                  Findings · {findings.length}
                </SystemText>
                {findings.map((finding, i) => (
                  <Animated.View
                    key={finding.id}
                    entering={FadeInDown.duration(280).delay(Math.min(360, i * 50))}>
                    <FindingCard
                      finding={finding}
                      disabled={busy !== null}
                      onToggle={() => void toggleRead(finding)}
                    />
                  </Animated.View>
                ))}
              </>
            ) : goal ? (
              <SystemText variant="meta" style={styles.empty}>
                Nothing found yet. Send Beru out.
              </SystemText>
            ) : null}
          </>
        )}
      </ScrollView>

      {reportOpen && report ? (
        <ReportOverlay report={report} onClose={() => setReportOpen(false)} />
      ) : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ parts */

/**
 * One shadow in the roster.
 *
 * The summon button is a sibling of the card body, never nested inside a
 * pressable wrapper — react-native-web would render a button inside a button.
 */
function ShadowCard({
  agent,
  run,
  pending,
  busy,
  disabled,
  onSummon,
  report,
  onOpenReport,
}: {
  agent: AgentDef;
  run: AgentRun | null;
  pending: number;
  busy: boolean;
  disabled: boolean;
  onSummon: () => void;
  /** Only the Steward has one. */
  report?: Report | null;
  onOpenReport?: () => void;
}) {
  const meta = rankMeta[agent.rank];

  let status = 'Never raised.';
  if (run?.status === 'ok') status = run.outputSummary ?? 'Returned.';
  else if (run?.status === 'error') status = run.error ? `Failed — ${run.error}` : 'Failed.';
  else if (run?.status === 'running') status = 'Out there now.';
  if (!agent.summonable && pending > 0) status = `${pending} waiting on a ruling.`;
  // The Steward's own last reading says more than its run row does.
  if (report) status = `Last reading ${report.date}${report.status === 'fallback' ? ' (no narration)' : ''}.`;

  return (
    <Card raised style={styles.shadowCard} contentStyle={styles.shadowInner}>
      <View style={styles.shadowTop}>
        <View style={[styles.rankBadge, { borderColor: alpha(meta.color, 0.6) }]}>
          <SystemText variant="label" color={meta.color} style={styles.rankText}>
            {agent.rank}
          </SystemText>
        </View>
        <SystemText variant="title" style={styles.shadowName}>
          {agent.glyph} {agent.name}
        </SystemText>
        <SystemText variant="label" color={palette.textMuted} style={styles.shadowRole}>
          {agent.role.toUpperCase()}
        </SystemText>
      </View>

      <SystemText variant="body" style={styles.shadowBlurb}>
        {agent.blurb}
      </SystemText>
      <SystemText variant="meta" style={styles.shadowStatus} numberOfLines={2}>
        {status}
      </SystemText>

      {report && onOpenReport ? (
        <ActionButton label="◉ Read the last report" onPress={onOpenReport} disabled={disabled} primary />
      ) : null}

      {agent.summonable ? (
        <ActionButton
          label={
            busy
              ? 'Out there…'
              : agent.id === 'steward-report'
                ? report
                  ? 'Ask for a fresh reading'
                  : 'Ask for a reading'
                : `Send ${agent.name} out`
          }
          onPress={onSummon}
          disabled={disabled}
          busy={busy}
          // Only one orange element per card: once a report exists, reading
          // it is the primary action and asking for a new one steps back.
          primary={!report}
        />
      ) : (
        <SystemText variant="meta" style={styles.autoNote}>
          Raised automatically when {AGENTS[0].name} returns.
        </SystemText>
      )}
    </Card>
  );
}

/**
 * One finding, in the same language as a quest card: art under a scrim, rank
 * badge, a meta row, and one flat control.
 */
function FindingCard({
  finding,
  disabled,
  onToggle,
}: {
  finding: Finding;
  disabled: boolean;
  onToggle: () => void;
}) {
  const done = finding.readAt !== null;
  const rank = finding.rank ? rankMeta[finding.rank] : null;
  const verdict = finding.verdict ? VERDICT_META[finding.verdict] : null;
  const award = xpForFinding(finding);

  return (
    <Card
      // Research imagery: the mind pool is books, study and focus.
      art={artFor(finding.id, 'mind')}
      scrim={0.82}
      style={styles.findingCard}
      contentStyle={styles.findingInner}>
      <View style={styles.findingTop}>
        {rank ? (
          <View style={[styles.rankBadge, { borderColor: alpha(rank.color, 0.6) }]}>
            <SystemText variant="label" color={rank.color} style={styles.rankText}>
              {finding.rank}
            </SystemText>
          </View>
        ) : (
          <View style={[styles.rankBadge, styles.rankPending]}>
            <SystemText variant="label" color={palette.textFaint} style={styles.rankText}>
              ?
            </SystemText>
          </View>
        )}

        {verdict ? (
          <SystemText variant="label" color={verdict.color} style={styles.verdict}>
            {verdict.label}
          </SystemText>
        ) : (
          <SystemText variant="label" color={palette.textFaint} style={styles.verdict}>
            UNJUDGED
          </SystemText>
        )}

        {finding.minutesToConsume ? (
          <SystemText variant="label" color={palette.textMuted} style={styles.minutes}>
            {finding.minutesToConsume} min
          </SystemText>
        ) : null}
      </View>

      <SystemText variant="title" style={styles.findingTitle} numberOfLines={3}>
        {finding.title}
      </SystemText>

      {finding.summary ? (
        <SystemText variant="body" style={styles.findingSummary} numberOfLines={4}>
          {finding.summary}
        </SystemText>
      ) : null}

      {finding.reason ? (
        <SystemText variant="meta" style={styles.findingReason} numberOfLines={3}>
          ⚔ {finding.reason}
        </SystemText>
      ) : null}

      <View style={styles.findingActions}>
        {finding.url ? (
          <Pressable
            onPress={() => {
              playSound('tap');
              void Linking.openURL(finding.url as string).catch(() => {});
            }}
            accessibilityRole="button"
            accessibilityLabel={`Open ${finding.title}`}>
            <View style={styles.openButton}>
              <SystemText variant="label" color={palette.text} style={styles.smallLabel}>
                OPEN ↗
              </SystemText>
            </View>
          </Pressable>
        ) : null}

        <Pressable
          onPress={onToggle}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={done ? `Mark ${finding.title} unread` : `Mark ${finding.title} done`}
          accessibilityState={{ disabled, checked: done }}>
          <View
            style={[
              styles.doneButton,
              done ? styles.doneButtonOn : null,
              { opacity: disabled ? 0.5 : 1 },
            ]}>
            <SystemText
              variant="label"
              color={done ? palette.bg : palette.text}
              style={styles.smallLabel}>
              {done ? '✓ DONE' : award > 0 ? `MARK DONE +${award}` : 'MARK DONE'}
            </SystemText>
          </View>
        </Pressable>
      </View>
    </Card>
  );
}

/** One flat pressable. Never a pressable inside another. */
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
            transitionDuration: 110,
          },
        ]}>
        {busy ? <ActivityIndicator size="small" color={primary ? palette.bg : palette.text} /> : null}
        <SystemText
          variant="label"
          color={primary ? palette.bg : palette.text}
          style={styles.actionLabel}>
          {label}
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl * 2, gap: space.md },
  kicker: { fontSize: 10, letterSpacing: 3 },
  title: { fontSize: 30, lineHeight: 34, marginTop: space.xs },
  sub: { fontSize: 14, lineHeight: 20, marginBottom: space.md },
  sectionLabel: { marginTop: space.md, marginBottom: space.xs, marginLeft: 2, color: palette.textMuted },
  block: { marginBottom: space.xs },
  blockBody: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  noticeText: { fontSize: 13, lineHeight: 18 },
  loading: { paddingVertical: space.xxl, alignItems: 'center' },
  empty: { fontSize: 12, textAlign: 'center', paddingVertical: space.xl },

  input: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    color: palette.text,
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 76,
    textAlignVertical: 'top',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.md,
  },

  shadowCard: { marginBottom: space.sm },
  shadowInner: { padding: space.md, gap: space.sm },
  shadowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shadowName: { flex: 1, fontSize: 17 },
  shadowRole: { fontSize: 9, letterSpacing: 1.4 },
  shadowBlurb: { fontSize: 13, lineHeight: 18 },
  shadowStatus: { fontSize: 11, lineHeight: 15 },
  autoNote: { fontSize: 10, lineHeight: 14, fontStyle: 'italic' },

  rankBadge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    minWidth: 26,
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rankPending: { borderColor: palette.border },
  rankText: { fontSize: 10, letterSpacing: 0.5 },

  findingCard: { marginBottom: space.sm },
  findingInner: { padding: space.md, gap: space.xs },
  findingTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  verdict: { flex: 1, fontSize: 9, letterSpacing: 1.4 },
  minutes: { fontSize: 9 },
  findingTitle: { fontSize: 16, lineHeight: 20, marginTop: 2 },
  findingSummary: { fontSize: 13, lineHeight: 18 },
  findingReason: { fontSize: 11, lineHeight: 16, fontStyle: 'italic', marginTop: 2 },
  findingActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  openButton: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  doneButton: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  doneButtonOn: { backgroundColor: palette.positive, borderColor: palette.positive },
  smallLabel: { fontSize: 9, letterSpacing: 1.2 },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    paddingVertical: space.md,
    marginTop: space.xs,
  },
  actionGhost: { borderWidth: 1, borderColor: palette.borderStrong },
  actionPrimary: { backgroundColor: palette.accent },
  actionLabel: { fontSize: 10, letterSpacing: 1.8 },
});
