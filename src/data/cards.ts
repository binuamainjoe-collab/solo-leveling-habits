import type { ImageSourcePropType } from 'react-native';

import { artByKey, type ArtKey } from '@/data/cardArt';

export * from '@/data/cardRules';

/**
 * Dedicated collectible artwork.
 *
 * To add a new piece: drop the file in `assets/collect/`, add it to
 * `COLLECT_ART`, then point the card's id at it in `CARD_ART` below. Cards
 * with no entry fall back to a borrowed quest illustration, so every card
 * looks finished before its own art exists.
 */
const COLLECT_ART = {
  'rank-e': require('@/assets/collect/rank-e.webp'),
  'rank-d': require('@/assets/collect/rank-d.jpg'),
  'rank-c': require('@/assets/collect/rank-c.jpg'),
  'rank-b': require('@/assets/collect/rank-b.jpg'),
  'rank-a': require('@/assets/collect/rank-a.jpg'),
  'rank-s': require('@/assets/collect/rank-s.jpg'),
  defiance: require('@/assets/collect/defiance.webp'),
  fallen: require('@/assets/collect/fallen.png'),
  wanderer: require('@/assets/collect/wanderer.jpg'),
  impact: require('@/assets/collect/impact.jpg'),
} as const;

type CollectArtKey = keyof typeof COLLECT_ART;

/** Either a dedicated collectible image or a borrowed quest illustration. */
type CardArt = { own: CollectArtKey } | { reuse: ArtKey };

const CARD_ART: Record<string, CardArt> = {
  'rank-e': { own: 'rank-e' },
  'rank-d': { own: 'rank-d' },
  'rank-c': { own: 'rank-c' },
  'rank-b': { own: 'rank-b' },
  'rank-a': { own: 'rank-a' },
  'rank-s': { own: 'rank-s' },
  defiance: { own: 'defiance' },
  fallen: { own: 'fallen' },
  wanderer: { own: 'wanderer' },
  impact: { own: 'impact' },

  // Awaiting dedicated art — borrowing from the quest pool for now.
  'week-one': { reuse: 'resolve' },
  'month-forged': { reuse: 'statue' },
  'perfect-week': { reuse: 'mastery' },
  'iron-will': { reuse: 'burden' },
  scholar: { reuse: 'study' },
  unbroken: { reuse: 'fire' },
};

export function cardArtSource(cardId: string): ImageSourcePropType {
  const art = CARD_ART[cardId] ?? { reuse: 'statue' as ArtKey };
  return 'own' in art ? COLLECT_ART[art.own] : artByKey(art.reuse);
}

/** True while a card is still borrowing quest art — useful for auditing. */
export function hasOwnArt(cardId: string): boolean {
  const art = CARD_ART[cardId];
  return Boolean(art && 'own' in art);
}
