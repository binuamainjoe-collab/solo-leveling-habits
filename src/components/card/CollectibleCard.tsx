import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { cardArtSource } from '@/data/cards';
import { rarityMeta, type CardDef } from '@/data/cardRules';

interface Props {
  card: CardDef;
  owned: boolean;
  /** Full-bleed portrait for the reveal; compact for the collection grid. */
  size?: 'grid' | 'hero';
}

/** Holographic sweep across an owned card, forever. */
const SHEEN = {
  '0%': { transform: [{ translateX: -220 }, { rotate: '14deg' }], opacity: 0 },
  '20%': { transform: [{ translateX: -110 }, { rotate: '14deg' }], opacity: 1 },
  '80%': { transform: [{ translateX: 170 }, { rotate: '14deg' }], opacity: 1 },
  '100%': { transform: [{ translateX: 280 }, { rotate: '14deg' }], opacity: 0 },
};

function CollectibleCardBase({ card, owned, size = 'grid' }: Props) {
  const rarity = rarityMeta[card.rarity];
  const hero = size === 'hero';

  // Stagger sheens so a grid doesn't shimmer in lockstep.
  const delay = useMemo<`${number}ms`>(() => `${(hash(card.id) % 20) * 220}ms`, [card.id]);

  return (
    <View
      style={[
        styles.frame,
        hero && styles.frameHero,
        {
          borderColor: owned ? alpha(rarity.color, 0.75) : palette.border,
          backgroundColor: owned ? alpha(rarity.color, 0.08) : palette.surface,
          boxShadow: owned ? `0px 8px 32px ${alpha(rarity.color, hero ? 0.4 : 0.16)}` : 'none',
        },
      ]}>
      {!owned ? (
        // Face-down. The artwork is never mounted for a card you haven't
        // earned — dimming it would still leak the image to anyone who looks
        // closely, and the whole point of a collection is not knowing yet.
        <View
          style={[
            styles.art,
            hero && styles.artHero,
            styles.back,
            { borderColor: alpha(rarity.color, 0.28) },
          ]}>
          <View style={[styles.backRing, { borderColor: alpha(rarity.color, 0.22) }]} />
          <View style={[styles.backRingInner, { borderColor: alpha(rarity.color, 0.16) }]} />
          <SystemText variant="hero" color={alpha(rarity.color, 0.5)} style={styles.backEmblem}>
            ◈
          </SystemText>
          <SystemText variant="label" color={alpha(rarity.color, 0.55)} style={styles.backLabel}>
            Undiscovered
          </SystemText>

          {/* Rarity stays legible while face-down — otherwise the rarity
              filters return a wall of identical, unlabelled backs. The art and
              the name are the secret, not how rare it is. */}
          <View style={[styles.rarityChip, { borderColor: alpha(rarity.color, 0.4) }]}>
            <SystemText variant="label" color={alpha(rarity.color, 0.75)} style={styles.rarityText}>
              {rarity.label}
            </SystemText>
          </View>
        </View>
      ) : (
        <View style={[styles.art, hero && styles.artHero]}>
        <Image
          source={cardArtSource(card.id)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={240}
        />

        <LinearGradient
          colors={['transparent', alpha(palette.bg, 0.55), alpha(palette.bg, 0.96)]}
          locations={[0.35, 0.72, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View
            style={[
              styles.sheen,
              {
                animationName: SHEEN,
                animationDuration: '3200ms',
                animationIterationCount: 'infinite',
                animationTimingFunction: 'ease-in-out',
                animationDelay: delay,
              },
            ]}>
            <LinearGradient
              colors={['transparent', alpha(rarity.glow, 0.34), 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>

        <View style={[styles.rarityChip, { borderColor: alpha(rarity.color, 0.8), backgroundColor: alpha(palette.bg, 0.7) }]}>
          <SystemText variant="label" color={rarity.color} style={styles.rarityText}>
            {rarity.label}
          </SystemText>
        </View>
        </View>
      )}

      <View style={[styles.body, hero && styles.bodyHero]}>
        <SystemText
          variant="title"
          color={owned ? palette.text : palette.textMuted}
          numberOfLines={2}
          style={hero ? styles.nameHero : styles.name}>
          {owned ? card.name : '???'}
        </SystemText>
        <SystemText variant="meta" numberOfLines={hero ? 6 : 2} style={styles.sub}>
          {owned ? card.flavor : card.hint}
        </SystemText>
      </View>
    </View>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  frameHero: { borderWidth: 2, borderRadius: radius.xl },
  art: { height: 190, backgroundColor: palette.bg },
  artHero: { height: 360 },
  // Face-down card: concentric rings around a single emblem, rarity-tinted.
  back: {
    borderWidth: 1,
    borderRadius: radius.md,
    margin: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceRaised,
    overflow: 'hidden',
  },
  backRing: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    bottom: 12,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  backRingInner: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderWidth: 1,
    borderRadius: 38,
  },
  backEmblem: { fontSize: 30, lineHeight: 36 },
  backLabel: { fontSize: 8, letterSpacing: 2, marginTop: 4 },
  sheen: { position: 'absolute', top: -80, bottom: -80, width: 74 },
  rarityChip: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  rarityText: { fontSize: 8, letterSpacing: 1.4 },
  body: { padding: space.md, gap: 3 },
  bodyHero: { padding: space.lg, alignItems: 'center' },
  name: { fontSize: 14 },
  nameHero: { fontSize: 22, textAlign: 'center' },
  sub: { fontSize: 11, lineHeight: 15 },
});

export const CollectibleCard = memo(CollectibleCardBase);
