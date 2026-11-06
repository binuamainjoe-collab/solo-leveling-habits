import { withLayoutContext } from 'expo-router';
import {
  createNavigatorFactory,
  TabRouter,
  useNavigationBuilder,
  type ParamListBase,
  type TabNavigationState,
} from 'expo-router/react-navigation';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { WorldLayer } from '@/components/motion/WorldLayer';
import { palette } from '@/constants/theme';
import { haptic } from '@/lib/feedback';
import { clamp, project, rubberband, SPRING } from '@/lib/motion';

export interface TabsMotion {
  /** Which page is on screen, as a float: 1.5 is halfway from page 1 to page 2. */
  progress: SharedValue<number>;
  /** 0 with the tab bar full, 1 once it has tucked away for reading. */
  chrome: SharedValue<number>;
  /** How far the page on screen has scrolled. */
  scroll: SharedValue<number>;
  /** So a swipe on something inside a page can beat the swipe between pages. */
  pager: GestureType | null;
}

const TabsMotionContext = createContext<TabsMotion | null>(null);

/** Null outside the tabs, on screens that have no pages or tab bar. */
export function useTabsMotion(): TabsMotion | null {
  return use(TabsMotionContext);
}

const PageOnScreenContext = createContext(true);

/**
 * False on a page that is built but swiped away. Pages stay mounted beside
 * each other, so a change can land on one you can't see; this lets it wait.
 * Always true outside the tabs.
 */
export function usePageOnScreen(): boolean {
  return use(PageOnScreenContext);
}

interface TabBarArgs {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

interface Props {
  /** Routes that sit side by side as pages. Any other route opens over them. */
  pages: readonly string[];
  tabBar: (args: TabBarArgs) => ReactNode;
  initialRouteName?: string;
  children: ReactNode;
  id?: string;
  screenOptions?: object;
  screenListeners?: object;
  backBehavior?: 'firstRoute';
}

/**
 * Tabs as one long strip you drag with a finger. Every page is really there
 * beside its neighbours, so the next one comes in under your thumb and you can
 * stop, reverse or flick at any moment. The strip moves by a single transform:
 * nothing re-renders during a swipe, and the route only changes once it lands.
 */
function SwipeNavigator({
  pages,
  tabBar,
  initialRouteName,
  children,
  id,
  screenOptions,
  screenListeners,
  backBehavior = 'firstRoute',
}: Props) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder(TabRouter, {
    id,
    children,
    screenOptions,
    screenListeners,
    initialRouteName,
    backBehavior,
  } as never);

  const tabState = state as unknown as TabNavigationState<ParamListBase>;
  const routes = tabState.routes;
  const pageRoutes = routes.filter((r) => pages.includes(r.name));
  const count = pageRoutes.length;
  const focused = routes[tabState.index];
  const active = pageRoutes.findIndex((r) => r.key === focused.key);
  const overlay = active === -1 ? focused : null;
  const page = active === -1 ? 0 : active;
  const last = count - 1;

  const progress = useSharedValue(page);
  const chrome = useSharedValue(0);
  const scroll = useSharedValue(0);
  const start = useSharedValue(0);
  const width = useSharedValue(1);

  // A page is built the first time it is on screen or next to the one that
  // is, then kept, so a swipe never reveals an empty space.
  const [built, setBuilt] = useState<readonly number[]>([page]);
  if (!built.includes(page)) setBuilt([...built, page]);
  useEffect(() => {
    const idle = setTimeout(() => {
      setBuilt((now) => {
        const next = [page - 1, page + 1].filter((p) => p >= 0 && p <= last && !now.includes(p));
        return next.length ? [...now, ...next] : now;
      });
    }, 400);
    return () => clearTimeout(idle);
  }, [page, last]);

  // A tap on the tab bar, or a link from somewhere else, travels the same way
  // a swipe does. A swipe that just landed is already there, so this is a no-op.
  useEffect(() => {
    progress.set(withSpring(page, SPRING.page));
    chrome.set(withSpring(0, SPRING.settle));
    scroll.set(0);
  }, [page, progress, chrome, scroll]);

  // The gesture outlives renders, so it reaches the current routes through this.
  const go = useRef<(target: number) => void>(() => {});
  useEffect(() => {
    go.current = (target) => {
      const route = pageRoutes[target];
      if (route) navigation.navigate(route.name);
    };
  });
  const land = useCallback((target: number) => go.current(target), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(overlay === null)
        .maxPointers(1)
        // Sideways intent first; a page's own vertical scroll is left alone.
        .activeOffsetX([-12, 12])
        .failOffsetY([-10, 10])
        .onStart(() => {
          cancelAnimation(progress);
          start.set(progress.get());
        })
        .onUpdate((e) => {
          const w = width.get();
          const next = start.get() - e.translationX / w;
          if (next < 0) progress.set(-rubberband(-next * w, w) / w);
          else if (next > last) progress.set(last + rubberband((next - last) * w, w) / w);
          else progress.set(next);
        })
        // eslint-disable-next-line react-hooks/refs -- runs when a swipe ends, never during render
        .onEnd((e) => {
          const w = width.get();
          const from = Math.round(start.get());
          const moved = progress.get() - from;
          const flung = progress.get() - project(e.velocityX) / w;
          // A busy phone can under-report a flick's speed, so a third of the way
          // across commits too, unless the finger was already heading back.
          const committed = moved > 0.3 && e.velocityX <= 0 ? from + 1 : moved < -0.3 && e.velocityX >= 0 ? from - 1 : flung;
          const target = clamp(Math.round(committed), Math.max(0, from - 1), Math.min(last, from + 1));
          if (target !== from) scheduleOnRN(haptic, 'light');
          progress.set(
            withSpring(target, { ...SPRING.page, velocity: -e.velocityX / w }, (finished) => {
              if (finished) scheduleOnRN(land, target);
            }),
          );
        }),
    [overlay, last, land, progress, start, width],
  );

  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${(-progress.get() * 100) / Math.max(1, count)}%` }],
  }));

  const motion = useMemo(() => ({ progress, chrome, scroll, pager: pan }), [progress, chrome, scroll, pan]);
  const measure: ViewProps['onLayout'] = (e) => width.set(e.nativeEvent.layout.width);

  return (
    <NavigationContent>
      <TabsMotionContext value={motion}>
        <View style={styles.root} onLayout={measure}>
          <WorldLayer motion={motion} />
          <GestureDetector gesture={pan} touchAction="pan-y">
            <View style={styles.window} collapsable={false}>
              <Animated.View style={[styles.strip, { width: `${count * 100}%` }, stripStyle]}>
                {pageRoutes.map((route, i) => (
                  <View
                    key={route.key}
                    aria-hidden={i !== page}
                    style={[styles.page, { left: `${(i * 100) / count}%`, width: `${100 / count}%` }]}>
                    <PageOnScreenContext value={overlay === null && i === page}>
                      {built.includes(i) ? descriptors[route.key].render() : null}
                    </PageOnScreenContext>
                  </View>
                ))}
              </Animated.View>
            </View>
          </GestureDetector>
          {overlay ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.overlay}>
              {descriptors[overlay.key].render()}
            </Animated.View>
          ) : null}
          {tabBar({ state: tabState, navigation: navigation as unknown as TabBarArgs['navigation'] })}
        </View>
      </TabsMotionContext>
    </NavigationContent>
  );
}

export const SwipeTabs = withLayoutContext(createNavigatorFactory(SwipeNavigator as never)().Navigator as never) as unknown as React.ComponentType<
  Omit<Props, 'children'> & { children?: ReactNode }
> & { Screen: React.ComponentType<{ name: string; options?: object }> };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg, overflow: 'hidden' },
  window: { flex: 1, overflow: 'hidden' },
  // Its own layer, so a swipe moves a finished picture instead of repainting it.
  strip: { flex: 1, height: '100%', willChange: 'transform' } as object,
  page: { position: 'absolute', top: 0, bottom: 0 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: palette.bg },
});
