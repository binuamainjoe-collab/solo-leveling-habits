import { Tabs } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, space, WIDE } from '@/constants/theme';
import { playSound } from '@/lib/feedback';

// `hunter` rather than `status`: Metro's dev server serves its own /status
// endpoint, which shadows an app route of that name during development.
//
// Five is the ceiling at 375px. Archive lost its slot to Goal rather than a
// sixth being squeezed in: browsing the quest catalogue is an occasional
// setup task, reached from a button on the Quests screen, whereas a
// long-term goal has to be visible every day or it quietly stops existing.
const TABS = [
  { name: 'index', label: 'QUESTS', glyph: '⚔' },
  { name: 'goal', label: 'GOAL', glyph: '◆' },
  { name: 'collection', label: 'CARDS', glyph: '◈' },
  { name: 'achievements', label: 'TROPHIES', glyph: '★' },
  { name: 'hunter', label: 'STATUS', glyph: '◉' },
] as const;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: styles.scene }}
      tabBar={(props) => <SystemTabBar {...props} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
      {/* Still a route, just not a tab — reached from the Quests screen. */}
      <Tabs.Screen name="archive" options={{ title: 'ARCHIVE' }} />
    </Tabs>
  );
}

/**
 * Only the slice of the navigator's tab-bar props this component actually
 * reads. Typed locally so the app doesn't take a direct dependency on
 * @react-navigation/bottom-tabs, which expo-router does not re-export.
 */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

/**
 * A console strip rather than a platform tab bar. It stays docked at the
 * bottom on every size — this navigator has no option to reposition it, and a
 * bottom HUD strip suits the System's look on desktop too. Past the WIDE
 * breakpoint the triggers stop stretching and centre instead.
 */
function SystemTabBar({ state, navigation }: TabBarProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      <View style={[styles.barInner, wide && styles.barInnerWide]}>
        {state.routes.map((route, index) => {
          const meta = TABS.find((t) => t.name === route.name);
          if (!meta) return null;
          const focused = state.index === index;

          return (
            <Pressable
              key={route.key}
              style={[styles.tab, wide && styles.tabWide]}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              onPress={() => {
                playSound('tap');
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}>
              <View style={styles.tabInner}>
                {/* active underline slides in via a CSS transition on scaleX */}
                <Animated.View
                  style={[
                    styles.indicator,
                    {
                      backgroundColor: palette.accent,
                      transform: [{ scaleX: focused ? 1 : 0 }],
                      transformOrigin: 'center center',
                      transitionProperty: 'transform',
                      transitionDuration: 220,
                      transitionTimingFunction: 'ease-out',
                    },
                  ]}
                />
                <Animated.View
                  style={{
                    opacity: focused ? 1 : 0.45,
                    transitionProperty: 'opacity',
                    transitionDuration: 200,
                  }}>
                  <SystemText
                    variant="title"
                    color={focused ? palette.accent : palette.textMuted}
                    style={styles.glyph}>
                    {meta.glyph}
                  </SystemText>
                  <SystemText
                    variant="label"
                    color={focused ? palette.accent : palette.textFaint}
                    style={styles.label}>
                    {meta.label}
                  </SystemText>
                </Animated.View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: palette.bg },
  bar: {
    backgroundColor: alpha(palette.surface, 0.96),
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: alpha(palette.accent, 0.22),
  },
  barInner: { flexDirection: 'row' },
  barInnerWide: { maxWidth: 720, width: '100%', alignSelf: 'center' },
  tab: { flex: 1 },
  tabWide: { flex: 0, minWidth: 140 },
  tabInner: { alignItems: 'center', paddingVertical: space.xs, gap: 2 },
  indicator: { position: 'absolute', top: -space.sm, height: 2, width: '55%' },
  glyph: { fontSize: 16, textAlign: 'center' },
  label: { fontSize: 8, letterSpacing: 1.1, textAlign: 'center' },
});
