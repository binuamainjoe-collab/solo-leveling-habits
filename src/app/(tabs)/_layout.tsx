import { Tabs } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, icon, palette, space, WIDE } from '@/constants/theme';
import { playSound } from '@/lib/feedback';

// `hunter` rather than `status`: Metro's dev server serves its own /status
// endpoint, which shadows an app route of that name during development.
//
// Five is the ceiling at 375px. Archive lost its slot to Goal rather than a
// sixth being squeezed in: browsing the quest catalogue is an occasional
// setup task, reached from a button on the Quests screen, whereas a
// long-term goal has to be visible every day or it quietly stops existing.
//
// The Planner sits next to Quests because they are two views of the same day:
// what you do, and when. Cards and Trophies share Collection to make room —
// both are things earned, neither is something you act on daily.
const TABS = [
  { name: 'index', label: 'Quests', icon: 'quests' },
  { name: 'planner', label: 'Planner', icon: 'planner' },
  // The goal keeps the System's own mark, drawn as text like the ◆ button.
  { name: 'goal', label: 'Goal', mark: '◆' },
  { name: 'collection', label: 'Collection', icon: 'collection' },
  { name: 'hunter', label: 'Status', icon: 'status' },
] as const satisfies readonly ({ name: string; label: string } & ({ icon: IconName } | { mark: string }))[];

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
 * An Apple-style tab bar: an outlined symbol over a short label, the
 * selected tab in the accent, the rest in grey, a hairline above. The
 * System's touch stays: the accent underline still slides in over the
 * selected tab and the tab fades up, so every tap still animates
 * (principle 10). It stays docked at the bottom on every size; past the
 * WIDE breakpoint the tabs stop stretching and centre instead.
 */
function SystemTabBar({ state, navigation }: TabBarProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.xs) }]}>
      <View style={[styles.barInner, wide && styles.barInnerWide]}>
        {state.routes.map((route, index) => {
          const meta = TABS.find((t) => t.name === route.name);
          if (!meta) return null;
          const focused = state.index === index;
          const tint = focused ? palette.accent : palette.textMuted;

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
                      transform: [{ scaleX: focused ? 1 : 0 }],
                      transformOrigin: 'center center',
                      transitionProperty: 'transform',
                      transitionDuration: 220,
                      transitionTimingFunction: 'ease-out',
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.tabContent,
                    { opacity: focused ? 1 : 0.7, transitionProperty: 'opacity', transitionDuration: 200 },
                  ]}>
                  {'icon' in meta ? (
                    <Icon name={meta.icon} size={icon.tab} color={tint} />
                  ) : (
                    <SystemText variant="title" color={tint} style={styles.mark}>
                      {meta.mark}
                    </SystemText>
                  )}
                  <SystemText variant="meta" color={tint} numberOfLines={1} style={styles.label}>
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
    backgroundColor: alpha(palette.surface, 0.94),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.borderStrong,
  },
  barInner: { flexDirection: 'row' },
  barInnerWide: { maxWidth: 720, width: '100%', alignSelf: 'center' },
  tab: { flex: 1 },
  tabWide: { flex: 0, minWidth: 120 },
  // 49pt is the iOS tab bar height; the symbol and label sit centred in it.
  tabInner: { height: 49, alignItems: 'center', justifyContent: 'center' },
  tabContent: { alignItems: 'center', gap: 2 },
  // ◆ set to the same 25pt box as the symbols beside it.
  mark: { fontSize: 22, lineHeight: 25, height: 25, textAlign: 'center' },
  indicator: { position: 'absolute', top: 0, height: 2, width: '40%', borderRadius: 1, backgroundColor: palette.accent },
  label: { fontSize: 11, fontWeight: '500', textAlign: 'center' },
});
