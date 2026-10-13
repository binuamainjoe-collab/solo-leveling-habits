import { StyleSheet, View } from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { isFallback, type Report } from '@/data/agents';

/**
 * The Steward's reading, as a panel over the Goal screen.
 *
 * An overlay rather than a route: the report is a glance, not a place you
 * navigate to, and keeping the Goal screen visible behind it means closing
 * costs nothing. Follows the same pattern as the card and trophy reveals
 * rather than react-native's Modal, which behaves differently on web.
 */
export function ReportOverlay({ report, onClose }: { report: Report; onClose: () => void }) {
  const body = report.body;
  const degraded = isFallback(report);

  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.root}>
      {/* The scrim is its own pressable sibling, never a parent of the
          panel — a pressable wrapping a pressable renders as a button
          inside a button on web. */}
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the report"
      />

      <Animated.View entering={FadeInDown.duration(260)} style={styles.panelWrap} pointerEvents="box-none">
        <Card raised style={styles.panel} contentStyle={styles.panelInner}>
          <View style={styles.head}>
            <SystemText variant="label" color={palette.accent} style={styles.kicker}>
              ◉ Steward&apos;s reading
            </SystemText>
            <SystemText variant="label" color={palette.textMuted} style={styles.date}>
              {report.date}
            </SystemText>
          </View>

          {degraded ? (
            <View style={styles.degraded}>
              <SystemText variant="meta" color={palette.negative} style={styles.degradedText}>
                Narration failed — this is the System&apos;s own summary.
              </SystemText>
            </View>
          ) : null}

          {!body ? (
            <SystemText variant="body" style={styles.empty}>
              The last run produced nothing to read.
              {report.error ? ` ${report.error}` : ''}
            </SystemText>
          ) : (
            <ScrollView
              style={styles.scroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollInner}>
              <SystemText variant="title" style={styles.headline}>
                {body.headline}
              </SystemText>

              <Section label="Wins" empty="Nothing logged today.">
                {body.wins.map((w, i) => (
                  <Line key={i} text={w} />
                ))}
              </Section>

              <Section label="Problems" empty="Nothing to fix.">
                {body.problems.map((p, i) => (
                  <View key={i} style={styles.problem}>
                    <SystemText variant="body" style={styles.problemText}>
                      {p.text}
                    </SystemText>
                    <SystemText variant="meta" style={styles.fix}>
                      Fix ({p.fix_minutes} min): {p.fix}
                    </SystemText>
                  </View>
                ))}
              </Section>

              {body.top_finding_comment ? (
                <Section label="On the top finding" empty="">
                  <Line text={body.top_finding_comment} bare />
                </Section>
              ) : null}

              <Section label="Tomorrow" empty="Nothing set.">
                {body.tomorrow_focus.map((f, i) => (
                  <Line key={i} text={f} />
                ))}
              </Section>
            </ScrollView>
          )}

          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss">
            <View style={styles.close}>
              <SystemText variant="label" color={palette.text} style={styles.closeText}>
                DISMISS
              </SystemText>
            </View>
          </Pressable>
        </Card>
      </Animated.View>
    </Animated.View>
  );
}

function Section({
  label,
  empty,
  children,
}: {
  label: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <View style={styles.section}>
      <SystemText variant="label" color={palette.textMuted} style={styles.sectionLabel}>
        {label}
      </SystemText>
      {items.length > 0 ? (
        items
      ) : empty ? (
        <SystemText variant="meta" style={styles.sectionEmpty}>
          {empty}
        </SystemText>
      ) : null}
    </View>
  );
}

function Line({ text, bare }: { text: string; bare?: boolean }) {
  return (
    <SystemText variant="body" style={styles.line}>
      {bare ? '' : '• '}
      {text}
    </SystemText>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: alpha('#000000', 0.78),
  },
  panelWrap: { width: '100%', maxWidth: 460 },
  panel: { marginBottom: 0 },
  panelInner: { padding: space.lg, gap: space.sm },

  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kicker: { flex: 1, fontSize: 10, letterSpacing: 2 },
  date: { fontSize: 10 },

  degraded: {
    borderWidth: 1,
    borderColor: alpha(palette.negative, 0.4),
    backgroundColor: alpha(palette.negative, 0.1),
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  degradedText: { fontSize: 11, lineHeight: 15 },

  // Capped so a long report scrolls inside the panel rather than growing
  // past the screen.
  scroll: { maxHeight: 420 },
  scrollInner: { gap: space.md, paddingBottom: space.xs },

  headline: { fontSize: 18, lineHeight: 23 },
  section: { gap: 4 },
  sectionLabel: { fontSize: 9, letterSpacing: 1.6 },
  sectionEmpty: { fontSize: 12, color: palette.textMuted },
  line: { fontSize: 14, lineHeight: 19 },

  problem: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: 4,
  },
  problemText: { fontSize: 14, lineHeight: 19 },
  fix: { fontSize: 11, lineHeight: 16, marginTop: 5, color: palette.textMuted },

  empty: { fontSize: 13, lineHeight: 18, paddingVertical: space.md },

  close: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: space.md,
    marginTop: space.xs,
  },
  closeText: { fontSize: 10, letterSpacing: 1.8 },
});
