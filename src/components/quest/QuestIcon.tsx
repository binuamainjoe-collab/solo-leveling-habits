import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { memo } from 'react';

import { palette } from '@/constants/theme';
import type { QuestIconKey } from '@/data/questIcons';

type Names = Exclude<SymbolViewProps['name'], string>;

/**
 * The line icon for a quest: SF Symbols on Apple devices, Material Symbols
 * on Android and the web — the same pairing as the app's other icons
 * (src/components/system/Icon.tsx), kept apart because these name things
 * people do, not things the interface does.
 */
const SYMBOLS: Record<QuestIconKey, Names> = {
  water: { ios: 'drop', android: 'water_drop', web: 'water_drop' },
  strength: { ios: 'dumbbell', android: 'fitness_center', web: 'fitness_center' },
  run: { ios: 'figure.run', android: 'directions_run', web: 'directions_run' },
  walk: { ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' },
  stretch: { ios: 'figure.mind.and.body', android: 'self_improvement', web: 'self_improvement' },
  sleep: { ios: 'bed.double', android: 'bed', web: 'bed' },
  sun: { ios: 'sun.max', android: 'light_mode', web: 'light_mode' },
  alarm: { ios: 'alarm', android: 'alarm', web: 'alarm' },
  cold: { ios: 'snowflake', android: 'ac_unit', web: 'ac_unit' },
  posture: { ios: 'figure.stand', android: 'accessibility_new', web: 'accessibility_new' },
  scale: { ios: 'scalemass', android: 'monitor_weight', web: 'monitor_weight' },
  food: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  coffee: { ios: 'cup.and.saucer', android: 'coffee', web: 'coffee' },
  pill: { ios: 'pills', android: 'medication', web: 'medication' },
  restrain: { ios: 'nosign', android: 'block', web: 'block' },
  phoneOff: { ios: 'iphone.slash', android: 'mobile_off', web: 'mobile_off' },
  game: { ios: 'gamecontroller', android: 'sports_esports', web: 'sports_esports' },
  book: { ios: 'book', android: 'menu_book', web: 'menu_book' },
  read: { ios: 'book.closed', android: 'auto_stories', web: 'auto_stories' },
  listen: { ios: 'headphones', android: 'headphones', web: 'headphones' },
  mind: { ios: 'leaf', android: 'spa', web: 'spa' },
  write: { ios: 'pencil.line', android: 'edit_note', web: 'edit_note' },
  language: { ios: 'character.bubble', android: 'translate', web: 'translate' },
  focus: { ios: 'scope', android: 'center_focus_strong', web: 'center_focus_strong' },
  code: { ios: 'chevron.left.forwardslash.chevron.right', android: 'code', web: 'code' },
  ship: { ios: 'shippingbox', android: 'rocket_launch', web: 'rocket_launch' },
  music: { ios: 'music.note', android: 'music_note', web: 'music_note' },
  art: { ios: 'paintbrush', android: 'brush', web: 'brush' },
  inbox: { ios: 'tray', android: 'inbox', web: 'inbox' },
  target: { ios: 'target', android: 'track_changes', web: 'track_changes' },
  career: { ios: 'briefcase', android: 'work', web: 'work' },
  shield: { ios: 'shield', android: 'shield', web: 'shield' },
  care: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  shower: { ios: 'shower', android: 'shower', web: 'shower' },
  groom: { ios: 'scissors', android: 'content_cut', web: 'content_cut' },
  home: { ios: 'house', android: 'home', web: 'home' },
  shirt: { ios: 'tshirt', android: 'checkroom', web: 'checkroom' },
  call: { ios: 'phone', android: 'call', web: 'call' },
  message: { ios: 'message', android: 'chat', web: 'chat' },
  people: { ios: 'person.2', android: 'group', web: 'group' },
  money: { ios: 'dollarsign.circle', android: 'payments', web: 'payments' },
  plan: { ios: 'calendar', android: 'event_note', web: 'event_note' },
  task: { ios: 'checklist', android: 'checklist', web: 'checklist' },
};

function QuestIconBase({ name, size = 17, color = palette.text }: { name: QuestIconKey; size?: number; color?: string }) {
  return (
    <SymbolView
      name={SYMBOLS[name]}
      size={size}
      tintColor={color}
      // Decorative: the button around it carries the quest's name.
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

export const QuestIcon = memo(QuestIconBase);
