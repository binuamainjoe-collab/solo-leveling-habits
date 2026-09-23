import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { useDayStats, useProgress } from '@/store/progress';

/** Blocks in the XP meter. Life Reset uses a segmented bar, not a smooth one. */
const SEGMENTS = 22;

export function StatusHeader() {
  const { state } = useProgress();
  const { done, total, level, into, need, rank } = useDayStats();

  const ratio = need > 0 ? Math.min(1, into / need) : 0;
  const litSegments = Math.round(ratio * SEGMENTS);

  return (
    <Card style={styles.card} contentStyle={styles.inner}>
      <View style={styles.headRow}>
        {/* solid orange level block — the loudest element on the screen */}
        <View style={styles.levelBadge}>
          <SystemText variant="numeral" color={palette.bg} style={styles.levelNum}>
            {level}
          </SystemText>
          <SystemText variant="label" color={alpha(palette.bg, 0.75)} style={styles.levelWord}>
            Level
          </SystemText>
        </View>

        <View style={styles.headRight}>
          <View style={styles.xpLine}>
            <SystemText variant="numeral" style={styles.xpNum}>
              {state.xp.toLocaleString('en-US')}
            </SystemText>
            <SystemText variant="label" style={styles.xpWord}>
              XP earned
            </SystemText>
          </View>

          <View style={styles.segments}>
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.segment,
                  {
                    backgroundColor: i < litSegments ? palette.accent : alpha(palette.text, 0.12),
                    // Each block lights a beat after the one before it, so the
                    // meter fills left-to-right rather than all at once.
                    transitionProperty: 'backgroundColor',
                    transitionDuration: '260ms',
                    transitionDelay: `${i * 18}ms`,
                  },
                ]}
              />
            ))}
          </View>

          <SystemText variant="label" style={styles.toNext}>
            {(need - into).toLocaleString('en-US')} XP to Lvl {level + 1}
          </SystemText>
        </View>
      </View>

      <View style={styles.statRow}>
        <Stat label="Rank" value={rank} tint={palette.accent} />
        <Divider />
        <Stat label="Streak" value={`${state.streak}d`} tint={palette.accent} flame />
        <Divider />
        <Stat label="Today" value={`${done}/${total}`} tint={done === total && total > 0 ? palette.positive : palette.text} />
      </View>
    </Card>
  );
}

function Stat({
  label,
  value,
  tint,
  flame,
}: {
  label: string;
  value: string | number;
  tint: string;
  flame?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <SystemText variant="label">{label}</SystemText>
      <SystemText variant="title" color={tint} style={styles.statValue}>
        {flame ? '🔥 ' : ''}
        {value}
      </SystemText>
    </View>
  );
}

const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  card: { marginBottom: space.lg },
  inner: { padding: space.lg },
  headRow: { flexDirection: 'row', gap: space.lg, alignItems: 'stretch' },
  levelBadge: {
    backgroundColor: palette.accent,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 84,
  },
  levelNum: { fontSize: 38, lineHeight: 42 },
  levelWord: { fontSize: 9, letterSpacing: 2, marginTop: -2 },
  headRight: { flex: 1, justifyContent: 'center', gap: space.sm },
  xpLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  xpNum: { fontSize: 26, lineHeight: 30 },
  xpWord: { fontSize: 9 },
  segments: { flexDirection: 'row', gap: 2 },
  segment: { flex: 1, height: 10, borderRadius: 1 },
  toNext: { fontSize: 9, color: palette.textMuted },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 18 },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: palette.border, marginHorizontal: space.md },
});
