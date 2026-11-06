import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/theme';

/** How long it runs, and how long it waits when the breathing screen is still fading. */
const RUN_MS = 520;
const LATE_MS = 280;

const tag = (part: string, late: boolean) => ({ dataSet: late ? { open: part, late: '1' } : { open: part } }) as object;

/**
 * The first open of the day, in half a second: a seam of ember light splits
 * the dark and it parts like a gate onto the board. The motion is CSS (in
 * src/app/+html.tsx), so it plays smoothly while the app is still busy
 * starting up, and it never takes a tap: the board underneath is live at once.
 */
export function Opening({ late, onDone }: { late: boolean; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, RUN_MS + (late ? LATE_MS : 0) + 40);
    return () => clearTimeout(t);
  }, [late, onDone]);

  return (
    <View pointerEvents="none" style={styles.root} aria-hidden>
      <View {...tag('top', late)} style={[styles.panel, styles.top]} />
      <View {...tag('bottom', late)} style={[styles.panel, styles.bottom]} />
      <View {...tag('seam', late)} style={styles.seam}>
        <LinearGradient
          colors={['rgba(255,112,32,0)', palette.accent, '#FFF1DA', palette.accent, 'rgba(255,112,32,0)']}
          locations={[0, 0.3, 0.5, 0.7, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  panel: { position: 'absolute', left: 0, right: 0, height: '50%', backgroundColor: palette.bg },
  top: { top: 0 },
  bottom: { bottom: 0 },
  seam: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 2,
    marginTop: -1,
    boxShadow: '0px 0px 22px 5px rgba(255,112,32,0.5)',
  },
});
