import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, TextInput, View } from 'react-native';
import { MotionScroll } from '@/components/motion/MotionScroll';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Ring } from '@/components/charts/Ring';
import { Icon, type IconName } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { ReportOverlay } from '@/components/system/ReportOverlay';
import { Screen, useContentWidth } from '@/components/system/Screen';
import { Sheet } from '@/components/system/Sheet';
import { WordReveal } from '@/components/motion/WordReveal';
import { SystemText } from '@/components/system/SystemText';
import { alpha, gradient, HIT, icon, palette, radius, rankMeta, space } from '@/constants/theme';
import {
  agoLabel,
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
import {
  daysLeft,
  daysSince,
  MAX_ACTIVE_GOALS,
  MEMORY_KIND_LABEL,
  orderGoals,
  timeElapsed,
  validateDeadline,
  validateGoalTitle,
  type Goal,
  type Memory,
} from '@/data/goals';
import { feedback, playSound } from '@/lib/feedback';
import {
  archiveGoal,
  fetchGoalState,
  fetchLatestReport,
  focusGoal,
  forgetMemory,
  markFindingRead,
  runScout,
  runSteward,
  setGoal as saveGoal,
  shadowsConfigured,
  type GoalState,
} from '@/lib/shadows';
import { useProgress } from '@/store/progress';

/** How loudly each ruling shows: a coloured dot, brightest for a must-read. */
const VERDICT_COLOR: Record<Verdict, string> = {
  'must-read': palette.accent,
  read: palette.gold,
  skim: palette.textMuted,
  skip: palette.textFaint,
};

/** The shadows as line icons. */
const AGENT_ICON: Record<string, IconName> = {
  'beru-scout': 'scout',
  'igris-judge': 'judge',
  'steward-report': 'overseer',
};

/** What a sheet over the screen is showing. */
type SheetFor =
  | { kind: 'add' }
  | { kind: 'goal'; goal: Goal }
  | { kind: 'agent'; agent: AgentDef }
  | { kind: 'findings' }
  | { kind: 'memories' }
  | null;

/**
 * The long-term half of the app, as pictures and numbers.
 *
 * The focus goal is a countdown ring; the other goals are small rings
 * beside it. The shadows are three icons with a status dot each. What they
 * found is three lines and a count. Everything with words in it — adding a
 * goal, a shadow's numbers, the full lists — opens in a sheet, so the
 * screen itself stays a glance.
 *
 * The daily quest board is untouched by anything here: a habit is something
 * you repeat, a goal is something you finish.
 */
export default function GoalScreen() {
  const { addXp, state: progress } = useProgress();
  const today = progress.date;
  const { wide } = useContentWidth();

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
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [sheet, setSheet] = useState<SheetFor>(null);
  // Archiving takes two taps: the first arms it, the second does it.
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

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
      setError(res.error ?? 'Your goals could not be loaded.');
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
        setError(res.error ?? 'Your goals could not be loaded.');
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
    const due = validateDeadline(deadlineDraft, today);
    if (!due.ok) {
      setError(due.error);
      return;
    }
    playSound('tap');
    setBusy('goal');
    setError(null);

    const res = await saveGoal(check.title, due.deadline);
    if (res.ok) {
      feedback('complete', 'success');
      setDraft('');
      setDeadlineDraft('');
      setSheet(null);
      await load();
    } else {
      setError(res.error ?? 'That goal could not be saved.');
    }
    setBusy(null);
  }

  async function makeFocus(target: Goal) {
    playSound('tap');
    setBusy(`focus:${target.id}`);
    setError(null);
    setConfirmArchive(null);
    const res = await focusGoal(target.id);
    if (res.ok) {
      feedback('complete', 'success');
      setNotice(`Focus moved to "${target.title}". The shadows and the planner follow it now.`);
      setSheet(null);
      await load();
    } else {
      setError(res.error ?? 'The focus could not be moved.');
    }
    setBusy(null);
  }

  async function archive(target: Goal) {
    if (confirmArchive !== target.id) {
      playSound('tap');
      setConfirmArchive(target.id);
      return;
    }
    playSound('tap');
    setBusy(`archive:${target.id}`);
    setError(null);
    setConfirmArchive(null);
    const res = await archiveGoal(target.id);
    if (res.ok) {
      setNotice(`"${target.title}" archived. Its findings are kept.`);
      setSheet(null);
      await load();
    } else {
      setError(res.error ?? 'That goal could not be archived.');
    }
    setBusy(null);
  }

  async function forget(memory: Memory) {
    playSound('tap');
    // Optimistic, like ticking a finding: it disappears at once, and comes
    // back with an error if the server refused.
    setState((s) => (s ? { ...s, memories: s.memories.filter((m) => m.id !== memory.id) } : s));
    const res = await forgetMemory(memory.id);
    if (!res.ok) {
      setError(res.error ?? 'That could not be forgotten.');
      await load();
    }
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
        setSheet(null);
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
            : 'Nothing new this time: everything found was already on file.'),
      );
      await load();
    } else {
      setError(res.error ?? 'The shadow did not return.');
    }
    setBusy(null);
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
  const goals = state ? orderGoals(state.goals) : [];
  const others = goals.filter((g) => !g.focus);
  const memories = state?.memories ?? [];
  const findings = state ? sortFindings(state.findings) : [];
  const pending = state ? unjudged(state.findings).length : 0;
  const runs = state ? latestRuns(state.runs) : {};
  const mustRead = findings.filter((f) => f.verdict === 'must-read' && !f.readAt).length;
  const readCount = findings.filter((f) => f.readAt).length;
  const judged = findings.filter((f) => f.verdict).length;

  const close = () => {
    setSheet(null);
    setConfirmArchive(null);
  };

  const addForm = (
    <View style={styles.form}>
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
      <TextInput
        value={deadlineDraft}
        onChangeText={setDeadlineDraft}
        placeholder="Deadline, if it has one (YYYY-MM-DD)"
        placeholderTextColor={palette.textFaint}
        style={[styles.input, styles.inputShort]}
        editable={busy === null}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={10}
        accessibilityLabel="Deadline, optional, as year month day"
      />
      <ActionButton
        label={goal ? 'Add this goal' : 'Set this goal'}
        onPress={() => void commitGoal()}
        disabled={busy !== null || draft.trim().length === 0}
        busy={busy === 'goal'}
        primary
      />
    </View>
  );

  return (
    <Screen>
      <MotionScroll showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.headRow}>
          <WordReveal screen="goal" variant="hero" style={styles.flex}>
            Goals
          </WordReveal>
          {goal && goals.length < MAX_ACTIVE_GOALS ? (
            <RoundButton name="plus" label="Add a goal" onPress={() => setSheet({ kind: 'add' })} />
          ) : null}
        </View>

        {!configured ? (
          <Banner tone={palette.negative} text="No server is configured, so goals and the shadows are switched off. Your daily quests are unaffected." />
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : !goal ? (
          <Animated.View entering={FadeIn.duration(260)} style={styles.first}>
            <SystemText variant="title">Name one thing you are working towards.</SystemText>
            <SystemText variant="meta">The planner and the shadows work around it.</SystemText>
            {addForm}
          </Animated.View>
        ) : (
          <>
            {/* The focus: one countdown ring. */}
            <Pressable
              onPress={() => {
                playSound('tap');
                setSheet({ kind: 'goal', goal });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Focus goal: ${goal.title}. ${goal.deadline ? `${daysLeft(goal.deadline, today)} days left` : 'No deadline'}. Open`}>
              <View style={[styles.hero, wide && styles.heroWide]}>
                <Countdown goal={goal} today={today} size={wide ? 200 : 168} />
                <View style={styles.heroText}>
                  <View style={styles.focusTag}>
                    <Icon name="bolt" size={icon.small} color={palette.accentSoft} />
                    <SystemText variant="meta" color={palette.accentSoft} style={styles.bold}>
                      Focus
                    </SystemText>
                  </View>
                  <SystemText variant="heading" numberOfLines={3} style={styles.heroTitle}>
                    {goal.title}
                  </SystemText>
                  {goal.deadline ? <SystemText variant="meta">Due {goal.deadline}</SystemText> : null}
                  <View style={styles.miniStats}>
                    <MiniStat value={findings.length ? `${readCount}/${findings.length}` : '0'} label="read" />
                    <MiniStat value={String(mustRead)} label="must-read" tint={mustRead ? palette.accentSoft : undefined} />
                    <MiniStat value={String(memories.length)} label="memories" />
                  </View>
                </View>
              </View>
            </Pressable>

            {/* Every other goal as a small ring, and room for one more. */}
            {others.length || goals.length < MAX_ACTIVE_GOALS ? (
              <View style={styles.others}>
                {others.map((g) => (
                  <Pressable
                    key={g.id}
                    onPress={() => {
                      playSound('tap');
                      setSheet({ kind: 'goal', goal: g });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${g.title}. ${g.deadline ? `${daysLeft(g.deadline, today)} days left` : 'No deadline'}. Open`}>
                    <View style={styles.other}>
                      <Countdown goal={g} today={today} size={76} small />
                      <SystemText variant="meta" numberOfLines={2} style={styles.otherTitle}>
                        {g.title}
                      </SystemText>
                    </View>
                  </Pressable>
                ))}
                {goals.length < MAX_ACTIVE_GOALS ? (
                  <Pressable
                    onPress={() => {
                      playSound('tap');
                      setSheet({ kind: 'add' });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Add a goal">
                    <View style={styles.other}>
                      <View style={styles.addRing}>
                        <Icon name="plus" size={icon.bar} color={palette.textMuted} />
                      </View>
                      <SystemText variant="meta" style={styles.otherTitle}>
                        Add
                      </SystemText>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* The shadows: an icon each, and a dot for how they are. */}
            <View style={styles.agents}>
              {AGENTS.map((agent) => (
                <AgentButton
                  key={agent.id}
                  agent={agent}
                  status={statusOf(agent, runs[agent.id] ?? null, pending, report, busy === agent.id)}
                  onPress={() => {
                    playSound('tap');
                    setSheet({ kind: 'agent', agent });
                  }}
                />
              ))}
            </View>

            {notice ? <Banner tone={palette.positive} text={notice} onClose={() => setNotice(null)} /> : null}
            {error ? <Banner tone={palette.negative} text={error} onClose={() => setError(null)} /> : null}

            {/* What Beru brought back: the best three, then the rest a tap away. */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Icon name="scout" size={icon.body} color={palette.accentSoft} />
                <SystemText variant="title" style={styles.flex}>
                  Findings
                </SystemText>
                <SystemText variant="title" color={palette.textMuted}>
                  {findings.length}
                </SystemText>
              </View>
              {findings.length === 0 ? (
                <SystemText variant="meta">Nothing yet. Tap Beru above and send him out.</SystemText>
              ) : (
                findings.slice(0, 3).map((f) => (
                  <FindingRow key={f.id} finding={f} disabled={busy !== null} onToggle={() => void toggleRead(f)} />
                ))
              )}
              {findings.length > 3 ? (
                <SeeAll
                  label={`See all ${findings.length}`}
                  onPress={() => setSheet({ kind: 'findings' })}
                />
              ) : null}
            </View>

            {/* What Beerus has kept about you: visible, so it can be trusted. */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Icon name="history" size={icon.body} color={palette.accentSoft} />
                <SystemText variant="title" style={styles.flex}>
                  Memories
                </SystemText>
                <SystemText variant="title" color={palette.textMuted}>
                  {memories.length}
                </SystemText>
              </View>
              {memories.length === 0 ? (
                <SystemText variant="meta">Nothing yet. Talk to Beerus and he keeps what matters.</SystemText>
              ) : (
                memories.slice(0, 3).map((m) => <MemoryRow key={m.id} memory={m} onForget={() => void forget(m)} />)
              )}
              {memories.length > 3 ? (
                <SeeAll label={`See all ${memories.length}`} onPress={() => setSheet({ kind: 'memories' })} />
              ) : null}
            </View>
          </>
        )}
      </MotionScroll>

      {/* Adding a goal. */}
      <Sheet visible={sheet?.kind === 'add'} onClose={close} height={0.62} header={<SystemText variant="heading">New goal</SystemText>}>
        {addForm}
        {error ? <SystemText variant="meta" color={palette.negative}>{error}</SystemText> : null}
      </Sheet>

      {/* One goal: its ring, and what can be done with it. */}
      <Sheet
        visible={sheet?.kind === 'goal'}
        onClose={close}
        height={0.6}
        header={<SystemText variant="heading">{sheet?.kind === 'goal' && sheet.goal.focus ? 'Focus goal' : 'Goal'}</SystemText>}>
        {sheet?.kind === 'goal' ? (
          <View style={styles.goalSheet}>
            <View style={styles.goalSheetTop}>
              <Countdown goal={sheet.goal} today={today} size={120} />
              <SystemText variant="title" style={styles.flex}>
                {sheet.goal.title}
              </SystemText>
            </View>
            {!sheet.goal.focus ? (
              <ActionButton
                label={busy === `focus:${sheet.goal.id}` ? 'Moving the focus…' : 'Make this the focus'}
                onPress={() => void makeFocus(sheet.goal)}
                disabled={busy !== null}
                busy={busy === `focus:${sheet.goal.id}`}
                primary
              />
            ) : null}
            <ActionButton
              label={busy === `archive:${sheet.goal.id}` ? 'Archiving…' : confirmArchive === sheet.goal.id ? 'Tap again to archive' : 'Archive'}
              onPress={() => void archive(sheet.goal)}
              disabled={busy !== null}
              warn={confirmArchive === sheet.goal.id}
            />
          </View>
        ) : null}
      </Sheet>

      {/* One shadow: its numbers, and the button that sends it out. */}
      <Sheet
        visible={sheet?.kind === 'agent'}
        onClose={close}
        height={0.62}
        header={
          sheet?.kind === 'agent' ? (
            <View style={styles.agentHead}>
              <View style={[styles.agentIconBig, { borderColor: alpha(rankMeta[sheet.agent.rank].color, 0.6) }]}>
                <Icon name={AGENT_ICON[sheet.agent.id] ?? 'radar'} size={26} color={rankMeta[sheet.agent.rank].color} />
              </View>
              <View style={styles.flex}>
                <SystemText variant="heading">{sheet.agent.name}</SystemText>
                <SystemText variant="meta">{sheet.agent.role}, {sheet.agent.rank}-rank</SystemText>
              </View>
            </View>
          ) : null
        }>
        {sheet?.kind === 'agent' ? (
          <View style={styles.goalSheet}>
            <View style={styles.tiles}>
              {sheet.agent.id === 'beru-scout' ? (
                <>
                  <Tile value={String(findings.length)} label="found" />
                  <Tile value={agoLabel(runs['beru-scout']?.finishedAt ?? runs['beru-scout']?.startedAt ?? null)} label="last out" />
                  <Tile value={runs['beru-scout']?.status === 'error' ? 'Failed' : runs['beru-scout'] ? 'OK' : '—'} label="last run" />
                </>
              ) : sheet.agent.id === 'igris-judge' ? (
                <>
                  <Tile value={String(judged)} label="judged" />
                  <Tile value={String(pending)} label="waiting" tint={pending ? palette.gold : undefined} />
                  <Tile value={String(findings.filter((f) => f.verdict === 'must-read').length)} label="must-read" />
                </>
              ) : (
                <>
                  <Tile value={report ? report.date.slice(5) : '—'} label="last reading" />
                  <Tile value={agoLabel(runs['steward-report']?.finishedAt ?? null)} label="last run" />
                </>
              )}
            </View>
            <SystemText variant="meta">{sheet.agent.blurb}</SystemText>
            {sheet.agent.id === 'steward-report' && report ? (
              <ActionButton
                label="Read the last report"
                onPress={() => {
                  playSound('tap');
                  setSheet(null);
                  setReportOpen(true);
                }}
                disabled={busy !== null}
                primary
              />
            ) : null}
            {sheet.agent.summonable ? (
              <ActionButton
                label={busy === sheet.agent.id ? 'Out there…' : sheet.agent.id === 'steward-report' ? 'Ask for a fresh reading' : `Send ${sheet.agent.name} out`}
                onPress={() => void summon(sheet.agent)}
                disabled={busy !== null}
                busy={busy === sheet.agent.id}
                primary={!(sheet.agent.id === 'steward-report' && report)}
              />
            ) : (
              <SystemText variant="meta">Runs by himself whenever Beru returns.</SystemText>
            )}
          </View>
        ) : null}
      </Sheet>

      {/* Every finding. */}
      <Sheet visible={sheet?.kind === 'findings'} onClose={close} header={<SystemText variant="heading">Findings, {findings.length}</SystemText>}>
        {findings.map((f) => (
          <FindingRow key={f.id} finding={f} disabled={busy !== null} onToggle={() => void toggleRead(f)} />
        ))}
      </Sheet>

      {/* Every memory. */}
      <Sheet visible={sheet?.kind === 'memories'} onClose={close} header={<SystemText variant="heading">Memories, {memories.length}</SystemText>}>
        {memories.map((m) => (
          <MemoryRow key={m.id} memory={m} onForget={() => void forget(m)} />
        ))}
      </Sheet>

      {reportOpen && report ? <ReportOverlay report={report} onClose={() => setReportOpen(false)} /> : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ parts */

/**
 * A goal as a ring: how much of the time to its deadline has gone, with the
 * days left in the middle. An open-ended goal shows which day of it this is.
 */
function Countdown({ goal, today, size, small }: { goal: Goal; today: string; size: number; small?: boolean }) {
  const elapsed = timeElapsed(goal, today);
  const left = goal.deadline ? daysLeft(goal.deadline, today) : null;
  const over = left !== null && left < 0;
  return (
    <Ring
      size={size}
      stroke={small ? 7 : 14}
      // An open-ended goal has nothing to fill toward: an empty ring, not a full one.
      ratio={elapsed ?? 0}
      colors={over ? [palette.negative, palette.accentDeep] : [gradient.ember[0], gradient.ember[2]]}
      track={alpha(palette.text, elapsed === null ? 0.12 : 0.08)}>
      <SystemText variant="numeral" color={over ? palette.negative : palette.text} style={small ? styles.ringNumSmall : styles.ringNum}>
        {left === null ? daysSince(goal.createdAt, today) : Math.abs(left)}
      </SystemText>
      <SystemText variant="meta" style={small ? styles.ringLabelSmall : undefined}>
        {left === null ? 'days in' : over ? 'days over' : left === 1 ? 'day left' : 'days left'}
      </SystemText>
    </Ring>
  );
}

function MiniStat({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <View style={styles.miniStat}>
      <SystemText variant="title" color={tint ?? palette.text} style={styles.miniValue}>
        {value}
      </SystemText>
      <SystemText variant="meta">{label}</SystemText>
    </View>
  );
}

function Tile({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <View style={styles.tile}>
      <SystemText variant="numeral" color={tint ?? palette.text} style={styles.tileValue}>
        {value}
      </SystemText>
      <SystemText variant="meta">{label}</SystemText>
    </View>
  );
}

interface AgentStatus {
  color: string;
  /** For screen readers; the screen shows only the dot. */
  label: string;
  working: boolean;
}

function statusOf(agent: AgentDef, run: AgentRun | null, pending: number, report: Report | null, busy: boolean): AgentStatus {
  if (busy || run?.status === 'running') return { color: palette.accent, label: 'out there now', working: true };
  if (agent.id === 'igris-judge' && pending > 0) return { color: palette.gold, label: `${pending} waiting on a ruling`, working: false };
  if (run?.status === 'error') return { color: palette.negative, label: 'last run failed', working: false };
  if (agent.id === 'steward-report' && report) return { color: palette.positive, label: `last reading ${report.date}`, working: false };
  if (run?.status === 'ok') return { color: palette.positive, label: `back ${agoLabel(run.finishedAt)} ago`, working: false };
  return { color: palette.textFaint, label: 'never raised', working: false };
}

/** A shadow as one round icon, edged in its rank colour, with a status dot. */
function AgentButton({ agent, status, onPress }: { agent: AgentDef; status: AgentStatus; onPress: () => void }) {
  const rank = rankMeta[agent.rank].color;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${agent.name}, ${agent.role}: ${status.label}. Open`}>
      <View style={styles.agent}>
        <View style={[styles.agentIcon, { borderColor: alpha(rank, 0.55), backgroundColor: alpha(rank, 0.08) }]}>
          {status.working ? (
            <ActivityIndicator color={rank} />
          ) : (
            <Icon name={AGENT_ICON[agent.id] ?? 'radar'} size={26} color={rank} />
          )}
          <View style={[styles.agentDot, { backgroundColor: status.color }]} />
        </View>
        <SystemText variant="meta" color={palette.text} style={styles.bold}>
          {agent.name.replace(/^The /, '')}
        </SystemText>
      </View>
    </Pressable>
  );
}

/** One finding in a line: its ruling as a dot, the title, the reading time, a tick. */
function FindingRow({ finding, disabled, onToggle }: { finding: Finding; disabled: boolean; onToggle: () => void }) {
  const done = finding.readAt !== null;
  const color = finding.verdict ? VERDICT_COLOR[finding.verdict] : palette.textFaint;
  const award = xpForFinding(finding);
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Pressable
        style={styles.flex}
        onPress={() => {
          if (!finding.url) return;
          playSound('tap');
          void Linking.openURL(finding.url).catch(() => {});
        }}
        accessibilityRole={finding.url ? 'link' : 'text'}
        accessibilityLabel={`${finding.verdict ?? 'unjudged'}: ${finding.title}${finding.url ? '. Open' : ''}`}>
        <View style={styles.rowText}>
          <SystemText variant="body" color={done ? palette.textFaint : palette.text} numberOfLines={1} style={[styles.rowTitle, done && styles.struck]}>
            {finding.title}
          </SystemText>
          {finding.url ? <Icon name="link" size={icon.small} color={palette.textFaint} /> : null}
        </View>
      </Pressable>
      {finding.minutesToConsume ? (
        <SystemText variant="meta" style={styles.minutes}>
          {finding.minutesToConsume}m
        </SystemText>
      ) : null}
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled }}
        accessibilityLabel={done ? `Mark ${finding.title} unread` : `Mark ${finding.title} read${award ? `, plus ${award} XP` : ''}`}>
        <View style={[styles.check, done && styles.checkOn]}>
          {done ? <Icon name="check" size={icon.small} color={palette.bg} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

function MemoryRow({ memory, onForget }: { memory: Memory; onForget: () => void }) {
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: palette.gold }]} />
      <View style={styles.flex}>
        <SystemText variant="body" color={palette.text} numberOfLines={2} style={styles.rowTitle}>
          {memory.content}
        </SystemText>
        <SystemText variant="meta">{MEMORY_KIND_LABEL[memory.kind]}</SystemText>
      </View>
      <Pressable onPress={onForget} accessibilityRole="button" accessibilityLabel={`Forget: ${memory.content}`}>
        <View style={styles.forget}>
          <Icon name="close" size={icon.small} color={palette.textMuted} />
        </View>
      </Pressable>
    </View>
  );
}

function SeeAll({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        playSound('tap');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <View style={styles.seeAll}>
        <SystemText variant="button" color={palette.accentSoft}>
          {label}
        </SystemText>
        <Icon name="chevron" size={icon.small} color={palette.accentSoft} />
      </View>
    </Pressable>
  );
}

function Banner({ tone, text, onClose }: { tone: string; text: string; onClose?: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={[styles.banner, { borderColor: alpha(tone, 0.4), backgroundColor: alpha(tone, 0.07) }]}>
      <SystemText variant="meta" color={palette.text} style={styles.flex}>
        {text}
      </SystemText>
      {onClose ? (
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss">
          <View style={styles.forget}>
            <Icon name="close" size={icon.small} color={palette.textMuted} />
          </View>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function RoundButton({ name, label, onPress }: { name: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        playSound('tap');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <View style={styles.round}>
        <Icon name={name} size={icon.bar} color={palette.text} />
      </View>
    </Pressable>
  );
}

/** One flat pressable. Never a pressable inside another. */
function ActionButton({
  label,
  onPress,
  disabled,
  primary,
  warn,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  warn?: boolean;
  busy?: boolean;
}) {
  const tone = warn ? palette.negative : primary ? palette.bg : palette.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}>
      <View
        style={[
          styles.action,
          primary ? styles.actionPrimary : styles.actionGhost,
          warn && { borderColor: alpha(palette.negative, 0.6) },
          disabled && styles.off,
        ]}>
        {busy ? <ActivityIndicator size="small" color={tone} /> : null}
        <SystemText variant="button" color={tone}>
          {label}
        </SystemText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  scroll: { paddingBottom: space.xxl * 3, gap: space.lg },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  loading: { paddingVertical: space.xxl, alignItems: 'center' },
  first: { gap: space.sm },

  hero: {
    alignItems: 'center',
    gap: space.lg,
    padding: space.xl,
    borderRadius: radius.xl + 4,
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.18),
    backgroundColor: palette.surface,
  },
  heroWide: { flexDirection: 'row', alignItems: 'center' },
  heroText: { alignSelf: 'stretch', flexShrink: 1, gap: space.xs },
  focusTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroTitle: {},
  ringNum: { fontSize: 44, lineHeight: 48 },
  ringNumSmall: { fontSize: 22, lineHeight: 26 },
  ringLabelSmall: { fontSize: 11, lineHeight: 13 },
  miniStats: { flexDirection: 'row', gap: space.xl, marginTop: space.sm },
  miniStat: { gap: 0 },
  miniValue: { fontSize: 20, lineHeight: 25, fontVariant: ['tabular-nums'] },

  others: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  other: { width: 92, alignItems: 'center', gap: space.xs },
  otherTitle: { textAlign: 'center', fontSize: 12, lineHeight: 16 },
  addRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  agents: { flexDirection: 'row', justifyContent: 'center', gap: space.xxl, paddingVertical: space.sm },
  agent: { alignItems: 'center', gap: space.xs, minWidth: 72 },
  agentIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: palette.bg,
  },
  agentHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  agentIconBig: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  section: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: HIT },
  rowText: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowTitle: { fontSize: 15, lineHeight: 20, flexShrink: 1 },
  struck: { textDecorationLine: 'line-through' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  minutes: { fontVariant: ['tabular-nums'] },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: palette.positive, borderColor: palette.positive },
  forget: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: HIT, alignSelf: 'flex-start' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.lg, paddingLeft: space.md },

  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, padding: space.md, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  tileValue: { fontSize: 28, lineHeight: 34 },

  goalSheet: { gap: space.md },
  goalSheetTop: { flexDirection: 'row', alignItems: 'center', gap: space.lg },

  form: { gap: space.sm },
  input: {
    minHeight: 72,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceRaised,
    color: palette.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 17,
    textAlignVertical: 'top',
  },
  inputShort: { minHeight: HIT },

  round: {
    width: HIT,
    height: HIT,
    borderRadius: HIT / 2,
    backgroundColor: palette.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 50,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
  },
  actionPrimary: { backgroundColor: palette.accent },
  actionGhost: { borderWidth: 1, borderColor: palette.borderStrong },
  off: { opacity: 0.4 },
});
