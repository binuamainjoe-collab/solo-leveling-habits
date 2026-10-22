import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { memo } from 'react';

import { icon as ICON_SIZE, palette } from '@/constants/theme';

/**
 * One icon set for the whole app, the way Apple does it: SF Symbols on
 * iPhone and Mac, and Google's Material Symbols — the closest equivalent —
 * on Android and the web, both through expo-symbols (in Expo Go, no native
 * build). Replaces the emoji and Unicode shapes (✓ 🔒 🔥 🎙 ↗ ‹ › ✕ ☰ ⚠ …)
 * that rendered at a different size and weight on every screen; decorative
 * prefixes on button labels (◷ ◉ ⇄ ▶ ⟲ ⚔ ✦) were dropped instead, as iOS
 * text buttons carry none.
 *
 * Kept as text on purpose: the System's own mark ◆ (on the ◆ button and the
 * Goal tab, and its hollow twin ◇ on the timeline), the ◈ on a face-down
 * card, and the glyph each category, stat, shadow and trophy carries —
 * they are the System's signature and the game's art, not UI icons.
 */
type Names = Exclude<SymbolViewProps['name'], string>;

const NAMES = {
  quests: { ios: 'checklist', android: 'checklist', web: 'checklist' },
  planner: { ios: 'clock', android: 'schedule', web: 'schedule' },
  collection: { ios: 'trophy', android: 'trophy', web: 'trophy' },
  status: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  lock: { ios: 'lock', android: 'lock', web: 'lock' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  send: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  mic: { ios: 'mic', android: 'mic', web: 'mic' },
  stop: { ios: 'stop.fill', android: 'stop', web: 'stop' },
  speaker: { ios: 'speaker.wave.2', android: 'volume_up', web: 'volume_up' },
  muted: { ios: 'speaker.slash', android: 'volume_off', web: 'volume_off' },
  undo: { ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  flame: { ios: 'flame', android: 'local_fire_department', web: 'local_fire_department' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  back: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  external: { ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' },
  archive: { ios: 'books.vertical', android: 'menu_book', web: 'menu_book' },
  live: { ios: 'waveform', android: 'graphic_eq', web: 'graphic_eq' },
  hangUp: { ios: 'phone.down.fill', android: 'call_end', web: 'call_end' },
} satisfies Record<string, Names>;

export type IconName = keyof typeof NAMES;

interface Props {
  name: IconName;
  /** Points. Use the `icon` sizes in theme.ts: tab 25, bar 22, body 17, small 13. */
  size?: number;
  color?: string;
}

function IconBase({ name, size = ICON_SIZE.body, color = palette.text }: Props) {
  return (
    <SymbolView
      name={NAMES[name]}
      size={size}
      tintColor={color}
      // Decorative: the button around it carries the accessible label.
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

export const Icon = memo(IconBase);
