import { useEffect } from 'react';
import { Platform, type GestureResponderEvent } from 'react-native';
import { useReducedMotion, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { tiltAt } from '@/lib/collection';
import { SPRING } from '@/lib/motion';

/** How a card is tipped, -1 to 1 on each axis, as its foil and art read it. */
export interface Tilt {
  x: SharedValue<number>;
  y: SharedValue<number>;
}

type PointerLike = GestureResponderEvent & {
  nativeEvent: { clientX: number; clientY: number };
  currentTarget: unknown;
};

/**
 * A card that tips toward a finger pressed on it, the way you would angle a
 * real card to catch the light, and springs back level when it lets go. A
 * press that turns into a scroll is cancelled by the browser, which also
 * lets it go, so scrolling past a card only ever tips it for a moment.
 */
export function usePressTilt(): Tilt & { handlers: object } {
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const follow = (e: PointerLike) => {
    const el = e.currentTarget as unknown as HTMLElement | null;
    if (!el?.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const t = tiltAt(e.nativeEvent.clientX - r.left, e.nativeEvent.clientY - r.top, r.width, r.height);
    x.set(withSpring(t.x, { duration: 160, dampingRatio: 1 }));
    y.set(withSpring(t.y, { duration: 160, dampingRatio: 1 }));
  };
  const release = () => {
    x.set(withSpring(0, SPRING.settle));
    y.set(withSpring(0, SPRING.settle));
  };

  const handlers =
    Platform.OS === 'web'
      ? {
          onPointerDown: follow,
          onPointerMove: (e: PointerLike & { nativeEvent: { buttons?: number; pointerType?: string } }) => {
            // A mouse only tips the card while its button is down, like a finger.
            if (e.nativeEvent.pointerType === 'mouse' && !e.nativeEvent.buttons) return;
            follow(e);
          },
          onPointerUp: release,
          onPointerCancel: release,
          onPointerLeave: release,
        }
      : {};
  return { x, y, handlers };
}

/**
 * The phone's own tilt, for the one card in focus: turn the phone and its
 * foil shifts as a real card's would. Whatever angle the phone is held at
 * slowly becomes level, as the world behind the tabs does it. Off with
 * reduced motion, and only listening while `active`.
 */
export function useDeviceTilt(active: boolean): Tilt {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (Platform.OS !== 'web' || !active || reduced || !window.matchMedia('(pointer: coarse)').matches) return;
    let baseG: number | null = null;
    let baseB = 0;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      if (baseG === null) {
        baseG = e.gamma;
        baseB = e.beta;
      }
      baseG += (e.gamma - baseG) * 0.01;
      baseB += (e.beta - baseB) * 0.01;
      // 20 degrees of turn is a full tip; a hand's tremor of a degree is not.
      const tx = Math.max(-1, Math.min(1, (e.gamma - baseG) / 20));
      const ty = Math.max(-1, Math.min(1, (e.beta - baseB) / 20));
      x.set(x.get() + (tx - x.get()) * 0.25);
      y.set(y.get() + (ty - y.get()) * 0.25);
    };
    window.addEventListener('deviceorientation', onTilt, { passive: true });
    return () => {
      window.removeEventListener('deviceorientation', onTilt);
      x.set(withSpring(0, SPRING.settle));
      y.set(withSpring(0, SPRING.settle));
    };
  }, [active, reduced, x, y]);

  return { x, y };
}
