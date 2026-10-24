import { StyleSheet, View } from 'react-native';

import { Ring } from '@/components/charts/Ring';
import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { GROUPS, type Group, type Tally } from '@/data/insights';
import { playSound } from '@/lib/feedback';

export const GROUP_META: Record<Group, { label: string; color: string; hint: string }> = {
  body: { label: 'Body', color: palette.accent, hint: 'Training, food, sleep, care' },
  mind: { label: 'Mind', color: palette.sky, hint: 'Study, reading, craft, plans' },
  life: { label: 'Life', color: palette.gold, hint: 'Discipline, people, money' },
};

/**
 * Today split three ways, one ring each. Tap one to open that group's
 * quests as cards in a sheet.
 */
export function BalanceRings({
  tallies,
  selected,
  onSelect,
}: {
  tallies: Record<Group, Tally>;
  selected: Group | null;
  onSelect: (group: Group) => void;
}) {
  return (
    <View style={styles.row}>
      {GROUPS.map((g) => {
        const t = tallies[g];
        const meta = GROUP_META[g];
        const on = selected === g;
        const ratio = t.total > 0 ? t.done / t.total : 0;
        return (
          <Pressable
            key={g}
            style={styles.item}
            disabled={t.total === 0}
            onPress={() => {
              playSound('tap');
              onSelect(g);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: t.total === 0 }}
            accessibilityLabel={`${meta.label}: ${t.done} of ${t.total} done. Open ${meta.label.toLowerCase()} quests`}>
            <View style={[styles.card, on && { borderColor: meta.color, backgroundColor: alpha(meta.color, 0.08) }, t.total === 0 && styles.empty]}>
              <Ring size={56} stroke={7} ratio={ratio} color={meta.color}>
                <SystemText variant="meta" color={palette.text} style={styles.pct}>
                  {Math.round(ratio * 100)}%
                </SystemText>
              </Ring>
              <View style={styles.text}>
                <SystemText variant="title" numberOfLines={1}>
                  {meta.label}
                </SystemText>
                <SystemText variant="meta" numberOfLines={1}>
                  {t.total === 0 ? 'None today' : `${t.done} of ${t.total}`}
                </SystemText>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  item: { flexGrow: 1, flexBasis: 150 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  empty: { opacity: 0.5 },
  text: { flex: 1, minWidth: 0 },
  pct: { fontSize: 13, fontWeight: '700' },
});
