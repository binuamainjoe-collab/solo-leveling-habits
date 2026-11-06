import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';

import type { Tilt } from '@/components/collection/tilt';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { cardArtSource } from '@/data/cards';
import { rarityMeta, type CardDef, type Rarity } from '@/data/cardRules';

interface Props {
  card: CardDef;
  owned: boolean;
  /** Full-bleed portrait for the reveal; middle size for the carousel; compact for the grid. */
  size?: 'grid' | 'focus' | 'hero';
  /** How the card is tipped. The foil and the art's layers follow it; at rest they lie still. */
  tilt?: Tilt;
  /** In focus: a rare card's art drifts and its embers rise. Off everywhere else. */
  alive?: boolean;
}

/**
 * The foil's colours, rare and up: a spectrum leaning toward the rarity's own
 * hue, so a legendary shimmers gold and a mythic shimmers ember.
 */
const HOLO: Partial<Record<Rarity, [string, string, string, string]>> = {
  rare: ['#6EA8FF', '#7FF0FF', '#B98CFF', '#6EA8FF'],
  epic: ['#B98CFF', '#FF8CE6', '#7FD0FF', '#B98CFF'],
  legendary: ['#F5CE7A', '#FFF1B8', '#FF9F43', '#F5CE7A'],
  mythic: ['#FF7020', '#FFD166', '#FF3D2E', '#FFA552'],
};

/** How far each layer moves at a full tip, in px: the deeper, the less. */
const DEPTH = { grid: { art: 6, ember: 14, foil: 46 }, focus: { art: 9, ember: 20, foil: 70 }, hero: { art: 11, ember: 24, foil: 90 } };

/** The art breathes in and out a little while a rare card is in focus. */
const ART_DRIFT = {
  from: { transform: [{ scale: 1 }, { translateX: 0 }, { translateY: 0 }] },
  to: { transform: [{ scale: 1.06 }, { translateX: -6 }, { translateY: -4 }] },
};

/** An ember rising through the art, as if the card were still warm from the gate. */
const EMBER_RISE = {
  '0%': { transform: [{ translateY: 0 }], opacity: 0 },
  '20%': { opacity: 0.9 },
  '100%': { transform: [{ translateY: -54 }], opacity: 0 },
};

function CollectibleCardBase({ card, owned, size = 'grid', tilt, alive = false }: Props) {
  const rarity = rarityMeta[card.rarity];
  const hero = size === 'hero';
  const focus = size === 'focus';
  const reduced = useReducedMotion();
  const holo = HOLO[card.rarity];
  const moving = alive && owned && Boolean(holo) && !reduced;
  const d = DEPTH[size];

  const restX = useSharedValue(0);
  const restY = useSharedValue(0);
  const tx = tilt?.x ?? restX;
  const ty = tilt?.y ?? restY;

  // Back to front: the art sits deepest and moves least, embers float above
  // it, and the foil rides on the surface, sliding the most.
  const artStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -tx.get() * d.art }, { translateY: -ty.get() * d.art * 0.75 }, { scale: 1.12 }],
  }));
  const emberStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() * d.ember }, { translateY: ty.get() * d.ember * 0.75 }],
  }));
  const holoStyle = useAnimatedStyle(() => {
    const tip = Math.min(1, Math.hypot(tx.get(), ty.get()));
    return {
      opacity: 0.1 + 0.34 * tip,
      transform: [{ translateX: tx.get() * d.foil }, { translateY: ty.get() * d.foil * 0.6 }],
    };
  });
  const glareStyle = useAnimatedStyle(() => {
    const tip = Math.min(1, Math.hypot(tx.get(), ty.get()));
    return {
      opacity: 0.14 + 0.46 * tip,
      transform: [{ translateX: -tx.get() * d.foil * 1.3 }, { translateY: -ty.get() * d.foil }],
    };
  });

  const embers = useMemo(() => {
    if (!holo) return [];
    const h = hash(card.id);
    return Array.from({ length: 7 }, (_, i) => ({
      left: `${8 + ((h >> i) % 84)}%` as const,
      top: `${30 + ((h >> (i + 3)) % 60)}%` as const,
      size: 2 + (i % 2),
      duration: `${4200 + ((h >> i) % 2600)}ms` as const,
      delay: `${i * 640}ms` as const,
    }));
  }, [card.id, holo]);

  return (
    <View
      style={[
        styles.frame,
        hero && styles.frameHero,
        {
          borderColor: owned ? alpha(rarity.color, 0.75) : palette.border,
          backgroundColor: owned ? tintOver(palette.surface, rarity.color, 0.08) : palette.surface,
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
            focus && styles.artFocus,
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
        <View style={[styles.art, focus && styles.artFocus, hero && styles.artHero]}>
          <Animated.View style={[StyleSheet.absoluteFill, artStyle]}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                moving && {
                  animationName: ART_DRIFT,
                  animationDuration: '14000ms',
                  animationIterationCount: 'infinite',
                  animationDirection: 'alternate',
                  animationTimingFunction: 'ease-in-out',
                },
              ]}>
              <Image source={cardArtSource(card.id)} style={StyleSheet.absoluteFill} contentFit="cover" transition={240} />
            </Animated.View>
          </Animated.View>

          {embers.length ? (
            <Animated.View style={[StyleSheet.absoluteFill, emberStyle]} pointerEvents="none">
              {embers.map((e, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.ember,
                    {
                      left: e.left,
                      top: e.top,
                      width: e.size,
                      height: e.size,
                      backgroundColor: rarity.glow,
                      opacity: moving ? 0 : 0.5,
                    },
                    moving && {
                      animationName: EMBER_RISE,
                      animationDuration: e.duration,
                      animationDelay: e.delay,
                      animationIterationCount: 'infinite',
                      animationTimingFunction: 'ease-out',
                    },
                  ]}
                />
              ))}
            </Animated.View>
          ) : null}

          <LinearGradient
            colors={['transparent', alpha(palette.bg, 0.55), alpha(palette.bg, 0.96)]}
            locations={[0.35, 0.72, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* The foil: a spectrum that slides across as the card tips, rare
              and up, and a band of light on every owned card. Laid on with
              blend modes, so they colour the art instead of covering it. */}
          {holo ? (
            <Animated.View pointerEvents="none" style={[styles.foil, { mixBlendMode: 'color-dodge' } as object, holoStyle]}>
              <LinearGradient
                colors={[...holo, ...holo, holo[0]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ) : null}
          <Animated.View pointerEvents="none" style={[styles.foil, { mixBlendMode: 'overlay' } as object, glareStyle]}>
            <LinearGradient
              colors={['transparent', 'rgba(255,241,218,0)', 'rgba(255,241,218,0.6)', 'rgba(255,241,218,0)', 'transparent']}
              locations={[0, 0.4, 0.5, 0.6, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <View style={[styles.rarityChip, { borderColor: alpha(rarity.color, 0.8), backgroundColor: alpha(palette.bg, 0.7) }]}>
            <SystemText variant="label" color={rarity.color} style={styles.rarityText}>
              {rarity.label}
            </SystemText>
          </View>
        </View>
      )}

      <View style={[styles.body, hero && styles.bodyHero, focus && styles.bodyFocus]}>
        <SystemText
          variant="title"
          color={owned ? palette.text : palette.textMuted}
          numberOfLines={2}
          style={hero ? styles.nameHero : focus ? styles.nameFocus : styles.name}>
          {owned ? card.name : '???'}
        </SystemText>
        <SystemText variant="meta" numberOfLines={hero ? 6 : focus ? 3 : 2} style={styles.sub}>
          {owned ? card.flavor : card.hint}
        </SystemText>
      </View>
    </View>
  );
}

/** `top` laid over `base` at `share`, as one solid colour. */
function tintOver(base: string, top: string, share: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [rgb(base), rgb(top)];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * share)).join(', ')})`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  frameHero: { borderWidth: 2, borderRadius: radius.xl },
  art: { height: 190, backgroundColor: palette.bg, overflow: 'hidden' },
  artFocus: { height: 240 },
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
  ember: { position: 'absolute', borderRadius: 2 },
  // Bigger than the card on every side, so sliding never shows its edge.
  foil: { position: 'absolute', top: '-40%', bottom: '-40%', left: '-60%', right: '-60%' },
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
  bodyFocus: { padding: space.lg, gap: 4 },
  bodyHero: { padding: space.lg, alignItems: 'center' },
  name: { fontSize: 14 },
  nameFocus: { fontSize: 17 },
  nameHero: { fontSize: 22, textAlign: 'center' },
  sub: { fontSize: 11, lineHeight: 15 },
});

export const CollectibleCard = memo(CollectibleCardBase);
