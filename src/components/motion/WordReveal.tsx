import { useState, type ComponentProps } from 'react';
import { Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useLaunchSettled } from '@/components/moments/stage';
import { usePageOnScreen } from '@/components/motion/SwipeTabs';
import { SystemText } from '@/components/system/SystemText';

/** Screens whose heading has already arrived this session. */
const arrived = new Set<string>();

/**
 * A screen's big heading, arriving word by word the first time you see that
 * screen in a session, then simply there every time after: a heading seen
 * thirty times a day must not keep performing. It waits until the page is
 * on screen and the launch screens are gone, so it is never spent unseen.
 * The words rise and fade in with CSS (src/app/+html.tsx); screen readers
 * hear the heading whole, and reduced motion shows it still.
 */
export function WordReveal({ children, screen, ...props }: ComponentProps<typeof SystemText> & { children: string; screen: string }) {
  const onScreen = usePageOnScreen();
  const settled = useLaunchSettled();
  const reduced = useReducedMotion();
  const ready = onScreen && settled && !reduced;
  // Decided once, the first render it could be seen: play, or never.
  const [play, setPlay] = useState<boolean | null>(null);
  if (play === null && ready) {
    const first = !arrived.has(screen);
    arrived.add(screen);
    setPlay(first);
  }

  if (!play) {
    return (
      <SystemText {...props} style={[props.style, play === null && !reduced ? { opacity: 0 } : null]}>
        {children}
      </SystemText>
    );
  }
  let n = 0;
  return (
    <SystemText {...props} accessibilityLabel={children}>
      {children.split(/(\s+)/).map((part, i) =>
        part.trim() ? (
          <Text key={i} aria-hidden {...({ dataSet: { word: String(Math.min(11, n++)) } } as object)}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </SystemText>
  );
}
