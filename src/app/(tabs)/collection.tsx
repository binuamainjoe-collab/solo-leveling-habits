import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardsPanel } from '@/components/collection/CardsPanel';
import { TrophiesPanel } from '@/components/collection/TrophiesPanel';
import { Screen } from '@/components/system/Screen';
import { Segmented } from '@/components/system/Segmented';
import { WordReveal } from '@/components/motion/WordReveal';
import { palette, space } from '@/constants/theme';
import { useProgress } from '@/store/progress';

type View_ = 'cards' | 'trophies';

/**
 * Everything earned, in one place.
 *
 * Cards and trophies were separate tabs until the Planner needed a slot —
 * five is the most a phone-width tab bar holds. They belong together anyway:
 * both are things you have won, and neither is something you act on daily.
 */
export default function CollectionScreen() {
  const { state } = useProgress();
  const [view, setView] = useState<View_>('cards');

  return (
    <Screen>
      <WordReveal screen="collection" variant="hero" style={styles.heading}>
        Collection
      </WordReveal>

      <View style={styles.switch}>
        <Segmented<View_>
          segments={[
            { key: 'cards', label: 'Cards', count: state.cards.length },
            { key: 'trophies', label: 'Trophies', count: state.unlocked.length },
          ]}
          value={view}
          onChange={setView}
          tint={view === 'cards' ? palette.accent : palette.gold}
        />
      </View>

      {view === 'cards' ? <CardsPanel /> : <TrophiesPanel />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: space.md },
  switch: { gap: space.sm, marginBottom: space.lg },
});
