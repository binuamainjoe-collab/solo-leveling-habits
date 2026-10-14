import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/system/Pressable';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, font, palette, radius, space } from '@/constants/theme';

/**
 * The pieces every conversation with The System is made of — the planner
 * chat and the assistant use the same ones, so talking to the System feels
 * like one thing wherever it happens.
 */

/** The System speaking: no bubble, just the line, marked with its diamond. */
export function ModelLine({ text }: { text: string }) {
  return (
    <View style={styles.modelRow}>
      <SystemText variant="label" color={palette.accent} style={styles.modelGlyph}>
        ◆
      </SystemText>
      <SystemText variant="body" style={styles.modelText}>
        {text}
      </SystemText>
    </View>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <SystemText variant="body" style={styles.userText}>
          {text}
        </SystemText>
      </View>
    </View>
  );
}

/**
 * Three dots, staggered with negative delays so they ripple from the first
 * frame. CSS animations stop themselves on unmount — no cleanup to forget.
 */
const blink = {
  '0%': { opacity: 0.25, transform: [{ translateY: 0 }] },
  '50%': { opacity: 1, transform: [{ translateY: -3 }] },
  '100%': { opacity: 0.25, transform: [{ translateY: 0 }] },
};

export function Typing({ label }: { label?: string | null }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.modelRow} accessibilityLabel="The System is thinking">
      <SystemText variant="label" color={palette.accent} style={styles.modelGlyph}>
        ◆
      </SystemText>
      <View style={styles.typing}>
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            style={[
              styles.typingDot,
              {
                animationName: blink,
                animationDuration: '1050ms',
                animationIterationCount: 'infinite',
                animationTimingFunction: 'ease-in-out',
                animationDelay: `${-1050 + i * 175}ms`,
              },
            ]}
          />
        ))}
        {label ? (
          <SystemText variant="meta" style={styles.typingLabel}>
            {label}
          </SystemText>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** A failed turn, with the one action that helps. */
export function ChatError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.errorWrap}>
      <SystemText variant="body" style={styles.errorText}>
        {message}
      </SystemText>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again">
        <View style={styles.retry}>
          <SystemText variant="label" color={palette.text} style={styles.retryLabel}>
            TRY AGAIN
          </SystemText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Suggestion chips above a multiline input and a send button.
 *
 * Chips wrap rather than scroll: RN Web squeezes a horizontal scroller in a
 * flex column until its chips clip. On a desktop browser Enter sends and
 * Shift+Enter is a new line, as every chat app has taught people to expect.
 */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
  suggestions,
  highlight,
  bottomInset,
  placeholder = 'Message The System…',
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
  suggestions: string[];
  /** Chips this returns true for are drawn in the accent colour. */
  highlight?: (chip: string) => boolean;
  bottomInset: number;
  placeholder?: string;
}) {
  const empty = !value.trim();
  return (
    <View style={[styles.composer, { paddingBottom: Math.max(bottomInset, space.sm) }]}>
      {suggestions.length > 0 && !busy ? (
        <Animated.View entering={FadeInUp.duration(200)} style={styles.chips}>
          {suggestions.map((s) => {
            const lit = highlight?.(s) ?? false;
            return (
              <Pressable key={s} onPress={() => onSend(s)} accessibilityRole="button" accessibilityLabel={s}>
                <View style={[styles.chip, lit && styles.chipLit]}>
                  <SystemText variant="meta" numberOfLines={1} style={[styles.chipText, lit && { color: palette.accent }]}>
                    {s}
                  </SystemText>
                </View>
              </Pressable>
            );
          })}
        </Animated.View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={palette.textFaint}
          style={styles.input}
          multiline
          editable={!busy}
          accessibilityLabel={placeholder.replace('…', '')}
          onKeyPress={(e) => {
            const native = e.nativeEvent as { key: string; shiftKey?: boolean };
            if (Platform.OS === 'web' && native.key === 'Enter' && !native.shiftKey) {
              (e as unknown as { preventDefault?: () => void }).preventDefault?.();
              onSend(value);
            }
          }}
        />
        <Pressable
          onPress={() => onSend(value)}
          disabled={empty || busy}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: empty || busy }}>
          <View style={[styles.send, (empty || busy) && styles.sendOff]}>
            <SystemText variant="title" color={palette.bg} style={styles.sendGlyph}>
              ↑
            </SystemText>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modelRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingRight: space.lg },
  modelGlyph: { fontSize: 11, marginTop: 4 },
  modelText: { flex: 1, fontSize: 15, lineHeight: 22, color: palette.text },

  userRow: { alignItems: 'flex-end', paddingLeft: space.xxl },
  userBubble: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: radius.lg,
    borderBottomRightRadius: 6,
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm + 2,
  },
  userText: { fontSize: 15, lineHeight: 21, color: palette.text },

  typing: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 7 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.textMuted },
  typingLabel: { fontSize: 11, color: palette.textMuted, marginLeft: space.sm },

  errorWrap: {
    marginLeft: space.lg,
    borderWidth: 1,
    borderColor: alpha(palette.negative, 0.4),
    backgroundColor: alpha(palette.negative, 0.08),
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  errorText: { fontSize: 13, lineHeight: 19, color: palette.text },
  retry: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  retryLabel: { fontSize: 9, letterSpacing: 1.6 },

  composer: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    gap: space.sm,
    backgroundColor: palette.bg,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  chipLit: { borderColor: alpha(palette.accent, 0.55) },
  chipText: { fontSize: 12, color: palette.text },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: 22,
    backgroundColor: palette.surface,
    color: palette.text,
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: space.md + 2,
    paddingTop: 11,
    paddingBottom: 11,
    textAlignVertical: 'top',
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.35 },
  sendGlyph: { fontSize: 20, lineHeight: 22 },
});
