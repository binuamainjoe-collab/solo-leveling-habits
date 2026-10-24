import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from 'react-native';

import { RecordingBar, type VoiceControls } from '@/components/chat/ChatParts';
import { Icon } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, icon, palette, radius, space } from '@/constants/theme';

export type ChatMode = 'chat' | 'interview' | 'board';

export const MODE_LABEL: Record<ChatMode, string> = {
  chat: 'Chat',
  interview: 'Interview me',
  board: 'Suggest quests',
};

/**
 * Where you talk to Beerus: one large box, like a chat app's, with the
 * tools along its bottom edge — attach a file (a timetable, a syllabus),
 * pick what kind of conversation this is, and the mic, which turns into
 * send as soon as there is text. On a desktop browser Enter sends and
 * Shift+Enter starts a new line.
 */
export function BeerusComposer({
  value,
  onChange,
  onSend,
  busy,
  voice,
  onAttach,
  attaching,
  mode,
  onModePress,
  large,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
  voice: VoiceControls;
  onAttach: () => void;
  attaching: boolean;
  mode: ChatMode;
  onModePress: () => void;
  /** The roomy version in the middle of a new chat. */
  large?: boolean;
}) {
  const empty = !value.trim();
  if (voice.state === 'recording') {
    return (
      <View style={[styles.box, styles.recording]}>
        <RecordingBar voice={voice} />
      </View>
    );
  }
  return (
    <View style={styles.box}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={mode === 'interview' ? 'Answer, or say "skip"…' : 'Ask Beerus anything…'}
        placeholderTextColor={palette.textFaint}
        style={[styles.input, large && styles.inputLarge]}
        multiline
        editable={!busy}
        accessibilityLabel="Message Beerus"
        onKeyPress={(e) => {
          const native = e.nativeEvent as { key: string; shiftKey?: boolean };
          if (Platform.OS === 'web' && native.key === 'Enter' && !native.shiftKey) {
            (e as unknown as { preventDefault?: () => void }).preventDefault?.();
            onSend(value);
          }
        }}
      />
      <View style={styles.tools}>
        <Pressable
          onPress={onAttach}
          disabled={attaching || busy}
          accessibilityRole="button"
          accessibilityLabel="Attach a PDF or photo, such as a timetable"
          accessibilityState={{ disabled: attaching || busy }}>
          <View style={styles.tool}>
            {attaching ? (
              <ActivityIndicator size="small" color={palette.accentSoft} />
            ) : (
              <Icon name="attach" size={icon.body} color={palette.textMuted} />
            )}
            <SystemText variant="meta" color={palette.text} style={styles.toolLabel}>
              {attaching ? 'Reading…' : 'Attach'}
            </SystemText>
          </View>
        </Pressable>
        <Pressable onPress={onModePress} accessibilityRole="button" accessibilityLabel={`Conversation type: ${MODE_LABEL[mode]}. Change`}>
          <View style={[styles.tool, mode !== 'chat' && styles.toolOn]}>
            <SystemText variant="meta" color={mode !== 'chat' ? palette.accentSoft : palette.text} style={styles.toolLabel}>
              {MODE_LABEL[mode]}
            </SystemText>
            <Icon name="down" size={icon.small} color={palette.textMuted} />
          </View>
        </Pressable>
        <View style={styles.spacer} />
        {empty ? (
          <Pressable
            onPress={voice.onStart}
            disabled={busy || voice.state === 'sending'}
            accessibilityRole="button"
            accessibilityLabel="Speak to Beerus"
            accessibilityState={{ disabled: busy || voice.state === 'sending' }}>
            <View style={[styles.send, styles.mic, (busy || voice.state === 'sending') && styles.off]}>
              <Icon name="mic" size={icon.bar} color={palette.text} />
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => onSend(value)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: busy }}>
            <View style={[styles.send, busy && styles.off]}>
              <Icon name="send" size={icon.bar} color={palette.bg} />
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: palette.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
    boxShadow: `0 12px 40px ${alpha('#000000', 0.35)}`,
  },
  recording: { paddingVertical: space.sm },
  input: {
    minHeight: 44,
    maxHeight: 160,
    color: palette.text,
    fontSize: 17,
    lineHeight: 23,
    paddingHorizontal: space.xs,
    paddingTop: 4,
    textAlignVertical: 'top',
  },
  inputLarge: { minHeight: 84 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceRaised,
  },
  toolOn: { borderColor: alpha(palette.accent, 0.5), backgroundColor: alpha(palette.accent, 0.1) },
  toolLabel: { fontWeight: '600' },
  spacer: { flex: 1 },
  send: {
    width: HIT,
    height: HIT,
    borderRadius: HIT / 2,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mic: { backgroundColor: palette.surfaceHover },
  off: { opacity: 0.4 },
});
