import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, Extrapolation } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SwipeTabs, useTabsMotion } from '@/components/motion/SwipeTabs';
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

/** How far the bar slides down when it tucks: the labels leave, the icons stay. */
const TUCK = 18;

const PAGES = TABS.map((t) => t.name);

export default function TabsLayout() {
  return (
    <SwipeTabs pages={PAGES} tabBar={(props) => <SystemTabBar {...props} />}>
      {TABS.map((t) => (
        <SwipeTabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
      {/* Still a route, just not a tab: it opens over the pages. */}
      <SwipeTabs.Screen name="archive" options={{ title: 'ARCHIVE' }} />
    </SwipeTabs>
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
 * The tab bar floats over the pages and moves with them. Its underline and
 * colours are worked out from the strip's live position, so they follow your
 * finger through a swipe rather than jumping when it lands. While you read
 * downward it tucks away to just its icons; scrolling up brings it back.
 */
function SystemTabBar({ state, navigation }: TabBarProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE;
  const motion = useTabsMotion();
  const [tabWidth, setTabWidth] = useState(0);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(motion?.chrome.get() ?? 0, [0, 1], [0, TUCK], Extrapolation.CLAMP) }],
  }));
  const underlineStyle = useAnimatedStyle(() => {
    const progress = motion?.progress.get() ?? 0;
    return {
      opacity: interpolate(motion?.chrome.get() ?? 0, [0, 1], [1, 0], Extrapolation.CLAMP),
      // Stretches as it travels and snaps back to size when it lands.
      transform: [{ translateX: progress * tabWidth }, { scaleX: 1 + Math.abs(progress - Math.round(progress)) * 0.8 }],
    };
  });

  return (
    <Animated.View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.xs) }, barStyle]}>
      <View style={[styles.barInner, wide && styles.barInnerWide]}>
        {tabWidth > 0 ? (
          <Animated.View pointerEvents="none" style={[styles.underline, { width: tabWidth }, underlineStyle]}>
            <View style={styles.indicator} />
          </Animated.View>
        ) : null}
        {state.routes.map((route, index) => {
          const meta = TABS.find((t) => t.name === route.name);
          if (!meta) return null;
          const focused = state.index === index;

          return (
            <Pressable
              key={route.key}
              onLayout={(e: LayoutChangeEvent) => {
                if (index === 0) setTabWidth(e.nativeEvent.layout.width);
              }}
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
                <TabFace meta={meta} slot={TABS.indexOf(meta)} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

/**
 * One tab's symbol and label: a grey copy with an ember copy on top, faded by
 * how close the strip is to this page, so colour slides between tabs.
 */
function TabFace({ meta, slot }: { meta: (typeof TABS)[number]; slot: number }) {
  const motion = useTabsMotion();

  const lit = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs((motion?.progress.get() ?? 0) - slot), [0, 1], [1, 0], Extrapolation.CLAMP),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(motion?.chrome.get() ?? 0, [0, 0.6], [1, 0], Extrapolation.CLAMP),
  }));

  const face = (tint: string) => (
    <>
      {'icon' in meta ? (
        <Icon name={meta.icon} size={icon.tab} color={tint} />
      ) : (
        <SystemText variant="title" color={tint} style={styles.mark}>
          {meta.mark}
        </SystemText>
      )}
      <Animated.View style={labelStyle}>
        <SystemText variant="meta" color={tint} numberOfLines={1} style={styles.label}>
          {meta.label}
        </SystemText>
      </Animated.View>
    </>
  );

  return (
    <View style={styles.tabContent}>
      <View style={styles.tabLayer}>{face(palette.textMuted)}</View>
      <Animated.View style={[styles.tabLit, lit]}>{face(palette.accent)}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
  tabContent: { alignItems: 'center' },
  tabLayer: { alignItems: 'center', gap: 2 },
  tabLit: { ...StyleSheet.absoluteFill, alignItems: 'center', gap: 2 },
  underline: { position: 'absolute', top: 0, left: 0, height: 2, alignItems: 'center' },
  // ◆ set to the same 25pt box as the symbols beside it.
  mark: { fontSize: 22, lineHeight: 25, height: 25, textAlign: 'center' },
  indicator: { height: 2, width: '40%', borderRadius: 1, backgroundColor: palette.accent },
  label: { fontSize: 11, fontWeight: '500', textAlign: 'center' },
});
