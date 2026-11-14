import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { MODEL_CHOICES, MODEL_ROLES, pickedModel, type ModelPicks, type ModelRole } from '@/data/models';
import { playSound } from '@/lib/feedback';
import { loadModelPicks, saveModelPicks } from '@/lib/modelSettings';
import { useSignedInId } from '@/lib/serverAuth';

/**
 * Which Gemini model runs each part of the System: Beerus, his live voice,
 * the planner. One row of chips per part; a tap saves to the account at
 * once, so the phone and the browser agree. Signed out, there is nothing to
 * pick: the models run on the server, which needs to know who is asking.
 */
export function ModelPicker() {
  const signedIn = useSignedInId();
  // Kept with the account they belong to, so switching accounts never shows
  // the last account's picks while the new ones load.
  const [loaded, setLoaded] = useState<{ user: string; picks: ModelPicks } | null>(null);
  const picks = signedIn && loaded?.user === signedIn ? loaded.picks : null;
  const setPicks = (next: ModelPicks) => signedIn && setLoaded({ user: signedIn, picks: next });
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void loadModelPicks().then((p) => {
      if (alive) setLoaded({ user: signedIn, picks: p ?? {} });
    });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  if (!signedIn) {
    return (
      <SystemText variant="meta" style={styles.note}>
        Sign in with Google to pick models. They run on the server, under your account.
      </SystemText>
    );
  }

  const choose = async (role: ModelRole, id: string) => {
    if (!picks || pickedModel(role, picks) === id) return;
    playSound('tap');
    const before = picks;
    const next = { ...picks, [role]: id };
    setPicks(next);
    setSaveFailed(false);
    if (!(await saveModelPicks(next))) {
      setPicks(before);
      setSaveFailed(true);
    }
  };

  return (
    <View>
      {MODEL_ROLES.map((role, i) => {
        const choice = MODEL_CHOICES[role];
        const current = picks ? pickedModel(role, picks) : choice.default;
        const hint = choice.options.find((o) => o.id === current)?.hint ?? '';
        return (
          <View key={role} style={i > 0 ? styles.roleGap : null}>
            <SystemText variant="title" style={styles.title}>
              {choice.title}
            </SystemText>
            <SystemText variant="meta" style={styles.about}>
              {choice.about}
            </SystemText>
            <View style={styles.chipRow}>
              {choice.options.map((o) => {
                const on = o.id === current;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => void choose(role, o.id)}
                    disabled={!picks}
                    accessibilityRole="button"
                    accessibilityLabel={`${choice.title}: ${o.label}`}
                    accessibilityState={{ selected: on, disabled: !picks }}>
                    <Animated.View
                      style={[
                        styles.chip,
                        {
                          borderColor: on ? palette.accent : palette.borderStrong,
                          backgroundColor: on ? alpha(palette.accent, 0.18) : 'transparent',
                          opacity: picks ? 1 : 0.5,
                          transitionProperty: 'backgroundColor',
                          transitionDuration: 160,
                        },
                      ]}>
                      <SystemText variant="label" color={on ? palette.accent : palette.textMuted} style={styles.chipText}>
                        {o.label}
                      </SystemText>
                    </Animated.View>
                  </Pressable>
                );
              })}
            </View>
            <SystemText variant="meta" style={styles.note}>
              {hint}
            </SystemText>
          </View>
        );
      })}
      {saveFailed ? (
        <SystemText variant="meta" color={palette.negative} style={styles.failed}>
          That pick did not save. Check your connection and tap it again.
        </SystemText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  roleGap: { marginTop: space.lg },
  title: { fontSize: 15 },
  about: { fontSize: 12, lineHeight: 17, marginTop: 2, marginBottom: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: { fontSize: 10, letterSpacing: 1.2 },
  note: { fontSize: 11, lineHeight: 16 },
  failed: { fontSize: 11, lineHeight: 16, marginTop: space.md },
});
