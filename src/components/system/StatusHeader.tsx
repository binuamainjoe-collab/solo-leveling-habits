import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { Icon } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, icon, palette, radius, space } from '@/constants/theme';
import { useDayStats, useProgress } from '@/store/progress';

/** Blocks in the XP meter. Life Reset uses a segmented bar, not a smooth one. */
const SEGMENTS = 22;

/**
 * The Player's status window: level, XP to the next level, rank, streak and
 * today's count. Same facts and the same segmented XP meter as before, laid
 * out the way an Apple widget is — one big figure, one bar, three small
 * stats — instead of nine sizes of letter-spaced caption.
 */
export function StatusHeader() {
  const { state } = useProgress();
  const { done, total, level, into, need, rank } = useDayStats();

  const ratio = need > 0 ? Math.min(1, into / need) : 0;
  const litSegments = Math.round(ratio * SEGMENTS);
  const allDone = done === total && total > 0;

  return (
    <Card style={styles.card} contentStyle={styles.inner}>
      <View style={styles.headRow}>
        {/* The level stays the loudest thing on screen. */}
        <View style={styles.levelBadge} accessibilityLabel={`Level ${level}`}>
          <SystemText variant="numeral" color={palette.bg} style={styles.levelNum}>
            {level}
          </SystemText>
          <SystemText variant="label" color={alpha(palette.bg, 0.7)}>
            Level
          </SystemText>
        </View>

        <View style={styles.headRight}>
          <View style={styles.xpLine}>
            <SystemText variant="numeral" style={styles.xpNum}>
              {state.xp.toLocaleString('en-US')}
            </SystemText>
            <SystemText variant="meta">XP</SystemText>
          </View>

          <View style={styles.segments}>
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.segment,
                  {
                    backgroundColor: i < litSegments ? palette.accent : alpha(palette.text, 0.1),
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

          <SystemText variant="meta">
            {(need - into).toLocaleString('en-US')} XP to level {level + 1}
          </SystemText>
        </View>
      </View>

      <View style={styles.statRow}>
        <Stat label="Rank" value={rank} tint={palette.accent} />
        <Divider />
        <Stat label="Streak" value={`${state.streak} ${state.streak === 1 ? 'day' : 'days'}`} tint={palette.accent} flame />
        <Divider />
        <Stat label="Today" value={`${done} of ${total}`} tint={allDone ? palette.positive : palette.text} />
      </View>
    </Card>
  );
}

function Stat({ label, value, tint, flame }: { label: string; value: string; tint: string; flame?: boolean }) {
  return (
    <View style={styles.stat}>
      <SystemText variant="meta">{label}</SystemText>
      <View style={styles.statValueRow}>
        {flame ? <Icon name="flame" size={icon.body} color={tint} /> : null}
        <SystemText variant="title" color={tint} numberOfLines={1}>
          {value}
        </SystemText>
      </View>
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
    minWidth: 80,
  },
  levelNum: { fontSize: 40 },
  headRight: { flex: 1, justifyContent: 'center', gap: space.sm },
  xpLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  xpNum: { fontSize: 28 },
  // The segmented meter stays; only its blocks are rounder, like the rest.
  segments: { flexDirection: 'row', gap: 2 },
  segment: { flex: 1, height: 8, borderRadius: 2 },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.borderStrong,
  },
  stat: { flex: 1, gap: 2 },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: palette.borderStrong,
    marginHorizontal: space.md,
  },
});
