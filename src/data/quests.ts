import type { CategoryId, Rank, StatKey } from '@/constants/theme';

/**
 * How a quest is measured. The kind decides which control QuestCard renders,
 * so adding a kind here means adding a branch there.
 *
 *   counter  — tap to add one discrete unit (glasses, reps, pages)
 *   duration — minutes banked toward a target, via +step chips
 *   value    — a single numeric entry (grams, km, kcal, currency)
 *   binary   — done / not done
 *   window   — done, but only counts inside a clock window (sleep, cutoffs)
 */
export type QuestKind = 'counter' | 'duration' | 'value' | 'binary' | 'window';

export type Cadence = 'daily' | 'weekly' | 'monthly';

export interface QuestDef {
  id: string;
  /** In the System's voice — terse, uppercase, faintly ominous. */
  title: string;
  /** Plain language: what actually completes it. */
  objective: string;
  category: CategoryId;
  kind: QuestKind;
  glyph: string;
  target: number;
  unit: string;
  /** Step size for counter/duration cards; ignored by the other kinds. */
  step?: number;
  rank: Rank;
  xp: number;
  stats: Partial<Record<StatKey, number>>;
  cadence: Cadence;
  /** Clock window for `window` quests, 24h "HH:MM". */
  window?: { before?: string; after?: string };
  /** Only set on quests eligible for the mandatory daily set. */
  penalty?: string;
  tags: string[];
}

/* ═════════════════════════════════════════ BODY — Physical Conditioning */

const body: QuestDef[] = [
  { id: 'water', title: 'Drink 8 glasses', objective: 'Drink 8 glasses of water', category: 'body', kind: 'counter', glyph: '💧', target: 8, unit: 'glasses', step: 1, rank: 'E', xp: 40, stats: { VIT: 1 }, cadence: 'daily', penalty: 'Dehydration debuff — 10% XP loss for 24h', tags: ['hydration'] },
  { id: 'pushups', title: '100 push-ups', objective: 'Complete 100 push-ups', category: 'body', kind: 'counter', glyph: '💪', target: 100, unit: 'reps', step: 10, rank: 'C', xp: 120, stats: { STR: 2 }, cadence: 'daily', penalty: 'Transport to the Penalty Zone for 4 hours', tags: ['strength', 'daily-set'] },
  { id: 'situps', title: '100 sit-ups', objective: 'Complete 100 sit-ups', category: 'body', kind: 'counter', glyph: '🔥', target: 100, unit: 'reps', step: 10, rank: 'C', xp: 120, stats: { STR: 1, VIT: 1 }, cadence: 'daily', penalty: 'Transport to the Penalty Zone for 4 hours', tags: ['strength', 'daily-set'] },
  { id: 'squats', title: '100 squats', objective: 'Complete 100 squats', category: 'body', kind: 'counter', glyph: '🦵', target: 100, unit: 'reps', step: 10, rank: 'C', xp: 120, stats: { STR: 2 }, cadence: 'daily', penalty: 'Transport to the Penalty Zone for 4 hours', tags: ['strength', 'daily-set'] },
  { id: 'run', title: 'Run 10 km', objective: 'Run 10 kilometres', category: 'body', kind: 'value', glyph: '🏃', target: 10, unit: 'km', rank: 'B', xp: 200, stats: { AGI: 2, VIT: 2 }, cadence: 'daily', penalty: 'Transport to the Penalty Zone for 4 hours', tags: ['cardio', 'daily-set'] },
  { id: 'pullups', title: '20 pull-ups', objective: 'Complete 20 pull-ups', category: 'body', kind: 'counter', glyph: '🧗', target: 20, unit: 'reps', step: 2, rank: 'B', xp: 140, stats: { STR: 3 }, cadence: 'daily', tags: ['strength'] },
  { id: 'steps', title: 'Walk 10,000 steps', objective: 'Walk 10,000 steps', category: 'body', kind: 'counter', glyph: '👣', target: 10000, unit: 'steps', step: 500, rank: 'D', xp: 80, stats: { AGI: 1 }, cadence: 'daily', tags: ['cardio'] },
  { id: 'lift', title: 'Lift for 60 min', objective: 'Complete a 60 minute strength session', category: 'body', kind: 'duration', glyph: '🏋️', target: 60, unit: 'min', step: 15, rank: 'B', xp: 180, stats: { STR: 3, VIT: 1 }, cadence: 'daily', tags: ['gym'] },
  { id: 'cardio', title: 'Cardio 30 min', objective: 'Complete 30 minutes of cardio', category: 'body', kind: 'duration', glyph: '❤️', target: 30, unit: 'min', step: 10, rank: 'D', xp: 90, stats: { VIT: 2 }, cadence: 'daily', tags: ['cardio'] },
  { id: 'stretch', title: 'Stretch 15 min', objective: 'Stretch for 15 minutes', category: 'body', kind: 'duration', glyph: '🤸', target: 15, unit: 'min', step: 5, rank: 'E', xp: 45, stats: { AGI: 1 }, cadence: 'daily', tags: ['mobility'] },
  { id: 'yoga', title: 'Yoga 30 min', objective: 'Complete a 30 minute yoga session', category: 'body', kind: 'duration', glyph: '🧘', target: 30, unit: 'min', step: 10, rank: 'D', xp: 95, stats: { AGI: 2, SEN: 1 }, cadence: 'daily', tags: ['mobility'] },
  { id: 'sleep', title: 'Sleep 8 hours', objective: 'Sleep 8 hours', category: 'body', kind: 'value', glyph: '🌙', target: 8, unit: 'hours', rank: 'D', xp: 100, stats: { VIT: 3 }, cadence: 'daily', penalty: 'Regeneration halted — no stat gains tomorrow', tags: ['sleep'] },
  { id: 'bedtime', title: 'In bed by 23:00', objective: 'In bed before 23:00', category: 'body', kind: 'window', glyph: '🛏️', target: 1, unit: 'check', rank: 'D', xp: 70, stats: { VIT: 1, PER: 1 }, cadence: 'daily', window: { before: '23:00' }, tags: ['sleep'] },
  { id: 'wake', title: 'Up by 06:00', objective: 'Out of bed before 06:00', category: 'body', kind: 'window', glyph: '🌅', target: 1, unit: 'check', rank: 'C', xp: 110, stats: { PER: 2 }, cadence: 'daily', window: { before: '06:00' }, tags: ['sleep'] },
  { id: 'sunlight', title: 'Daylight 20 min', objective: 'Get 20 minutes of daylight', category: 'body', kind: 'duration', glyph: '☀️', target: 20, unit: 'min', step: 5, rank: 'E', xp: 40, stats: { VIT: 1, SEN: 1 }, cadence: 'daily', tags: ['circadian'] },
  { id: 'coldshower', title: 'Cold shower', objective: 'Finish with a cold shower', category: 'body', kind: 'binary', glyph: '🧊', target: 1, unit: 'check', rank: 'C', xp: 90, stats: { VIT: 2, PER: 1 }, cadence: 'daily', tags: ['resilience'] },
  { id: 'posture', title: 'Posture checks', objective: 'Run 5 posture checks', category: 'body', kind: 'counter', glyph: '🧍', target: 5, unit: 'checks', step: 1, rank: 'E', xp: 30, stats: { STR: 1 }, cadence: 'daily', tags: ['posture'] },
  { id: 'breathwork', title: 'Breathwork 10 min', objective: 'Practise breathwork for 10 minutes', category: 'body', kind: 'duration', glyph: '🌬️', target: 10, unit: 'min', step: 5, rank: 'E', xp: 40, stats: { VIT: 1, SEN: 1 }, cadence: 'daily', tags: ['recovery'] },
  { id: 'walkmeals', title: 'Walk after meals', objective: 'Walk after 3 meals', category: 'body', kind: 'counter', glyph: '🚶', target: 3, unit: 'walks', step: 1, rank: 'E', xp: 35, stats: { VIT: 1 }, cadence: 'daily', tags: ['neat'] },
  { id: 'sport', title: 'Train a sport', objective: 'Train a sport or martial art for 60 minutes', category: 'body', kind: 'duration', glyph: '🥋', target: 60, unit: 'min', step: 15, rank: 'B', xp: 190, stats: { STR: 2, AGI: 2 }, cadence: 'weekly', tags: ['sport'] },
  { id: 'weighin', title: 'Log your weight', objective: 'Log your weight', category: 'body', kind: 'binary', glyph: '⚖️', target: 1, unit: 'check', rank: 'E', xp: 25, stats: { PER: 1 }, cadence: 'weekly', tags: ['tracking'] },
  { id: 'restday', title: 'Rest day', objective: 'Take a full active-recovery day', category: 'body', kind: 'binary', glyph: '♻️', target: 1, unit: 'check', rank: 'D', xp: 60, stats: { VIT: 2 }, cadence: 'weekly', tags: ['recovery'] },
];

/* ═══════════════════════════════════════════ NUTRITION — Fuel Systems */

const nutrition: QuestDef[] = [
  { id: 'protein', title: 'Hit 150g protein', objective: 'Hit 150g of protein', category: 'nutrition', kind: 'value', glyph: '🥩', target: 150, unit: 'g', rank: 'C', xp: 110, stats: { STR: 2 }, cadence: 'daily', penalty: 'Muscle atrophy — 1 STR lost', tags: ['macros'] },
  { id: 'calories', title: 'Stay in calories', objective: 'Stay within your calorie target', category: 'nutrition', kind: 'value', glyph: '🔢', target: 2200, unit: 'kcal', rank: 'C', xp: 100, stats: { VIT: 1, PER: 1 }, cadence: 'daily', tags: ['macros'] },
  { id: 'veg', title: '5 servings of veg', objective: 'Eat 5 servings of vegetables', category: 'nutrition', kind: 'counter', glyph: '🥦', target: 5, unit: 'servings', step: 1, rank: 'D', xp: 70, stats: { VIT: 2 }, cadence: 'daily', tags: ['micros'] },
  { id: 'fruit', title: '2 servings of fruit', objective: 'Eat 2 servings of fruit', category: 'nutrition', kind: 'counter', glyph: '🍎', target: 2, unit: 'servings', step: 1, rank: 'E', xp: 35, stats: { VIT: 1 }, cadence: 'daily', tags: ['micros'] },
  { id: 'fiber', title: '30g fibre', objective: 'Reach 30g of fibre', category: 'nutrition', kind: 'value', glyph: '🌾', target: 30, unit: 'g', rank: 'D', xp: 65, stats: { VIT: 1 }, cadence: 'daily', tags: ['macros'] },
  { id: 'nojunk', title: 'No junk food', objective: 'No processed junk food', category: 'nutrition', kind: 'binary', glyph: '🚫', target: 1, unit: 'check', rank: 'C', xp: 95, stats: { VIT: 2, PER: 1 }, cadence: 'daily', tags: ['restraint'] },
  { id: 'nosugar', title: 'No added sugar', objective: 'No added sugar', category: 'nutrition', kind: 'binary', glyph: '🍬', target: 1, unit: 'check', rank: 'C', xp: 95, stats: { VIT: 2, PER: 1 }, cadence: 'daily', tags: ['restraint'] },
  { id: 'mealprep', title: 'Prep your meals', objective: 'Prep meals in advance', category: 'nutrition', kind: 'binary', glyph: '🍱', target: 1, unit: 'check', rank: 'D', xp: 80, stats: { PER: 2 }, cadence: 'weekly', tags: ['planning'] },
  { id: 'supplements', title: 'Take vitamins', objective: 'Take your vitamins', category: 'nutrition', kind: 'binary', glyph: '💊', target: 1, unit: 'check', rank: 'E', xp: 25, stats: { VIT: 1 }, cadence: 'daily', tags: ['supplement'] },
  { id: 'creatine', title: 'Take creatine', objective: 'Take creatine', category: 'nutrition', kind: 'binary', glyph: '⚗️', target: 1, unit: 'check', rank: 'E', xp: 25, stats: { STR: 1 }, cadence: 'daily', tags: ['supplement'] },
  { id: 'omega3', title: 'Take omega-3', objective: 'Take omega-3', category: 'nutrition', kind: 'binary', glyph: '🐟', target: 1, unit: 'check', rank: 'E', xp: 25, stats: { INT: 1 }, cadence: 'daily', tags: ['supplement'] },
  { id: 'nolatefood', title: 'No food after 20:00', objective: 'No food after 20:00', category: 'nutrition', kind: 'window', glyph: '🌃', target: 1, unit: 'check', rank: 'D', xp: 70, stats: { VIT: 1, PER: 1 }, cadence: 'daily', window: { after: '20:00' }, tags: ['restraint'] },
  { id: 'homecooked', title: 'Cook 2 meals', objective: 'Cook 2 meals yourself', category: 'nutrition', kind: 'counter', glyph: '🍳', target: 2, unit: 'meals', step: 1, rank: 'D', xp: 75, stats: { PER: 1, VIT: 1 }, cadence: 'daily', tags: ['cooking'] },
  { id: 'caffeine', title: 'Max 2 coffees', objective: 'Cap caffeine at 2 cups', category: 'nutrition', kind: 'counter', glyph: '☕', target: 2, unit: 'cups', step: 1, rank: 'D', xp: 55, stats: { PER: 1 }, cadence: 'daily', tags: ['restraint'] },
  { id: 'fasting', title: '16 hour fast', objective: 'Hold a 16 hour fast', category: 'nutrition', kind: 'value', glyph: '⏳', target: 16, unit: 'hours', rank: 'B', xp: 150, stats: { VIT: 2, PER: 2 }, cadence: 'daily', tags: ['restraint'] },
];

/* ══════════════════════════════════════════ MIND — Mental Fortitude */

const mind: QuestDef[] = [
  { id: 'study', title: 'Study 2 hours', objective: 'Study for 120 minutes', category: 'mind', kind: 'duration', glyph: '📚', target: 120, unit: 'min', step: 15, rank: 'B', xp: 200, stats: { INT: 3 }, cadence: 'daily', penalty: 'Intelligence decay — 1 INT lost', tags: ['study'] },
  { id: 'read', title: 'Read 30 pages', objective: 'Read 30 pages', category: 'mind', kind: 'counter', glyph: '📖', target: 30, unit: 'pages', step: 5, rank: 'D', xp: 90, stats: { INT: 2 }, cadence: 'daily', tags: ['reading'] },
  { id: 'meditate', title: 'Meditate 20 min', objective: 'Meditate for 20 minutes', category: 'mind', kind: 'duration', glyph: '🧘‍♂️', target: 20, unit: 'min', step: 5, rank: 'C', xp: 100, stats: { SEN: 3 }, cadence: 'daily', tags: ['mindfulness'] },
  { id: 'journal', title: 'Journal entry', objective: 'Write a journal entry', category: 'mind', kind: 'binary', glyph: '📝', target: 1, unit: 'check', rank: 'D', xp: 70, stats: { SEN: 2 }, cadence: 'daily', tags: ['reflection'] },
  { id: 'gratitude', title: '3 gratitudes', objective: 'Record 3 things you are grateful for', category: 'mind', kind: 'counter', glyph: '🙏', target: 3, unit: 'entries', step: 1, rank: 'E', xp: 40, stats: { SEN: 1 }, cadence: 'daily', tags: ['reflection'] },
  { id: 'language', title: 'Practise a language', objective: 'Practise a language for 20 minutes', category: 'mind', kind: 'duration', glyph: '🗣️', target: 20, unit: 'min', step: 5, rank: 'D', xp: 85, stats: { INT: 2 }, cadence: 'daily', tags: ['learning'] },
  { id: 'flashcards', title: '50 flashcards', objective: 'Review 50 flashcards', category: 'mind', kind: 'counter', glyph: '🃏', target: 50, unit: 'cards', step: 10, rank: 'D', xp: 80, stats: { INT: 2 }, cadence: 'daily', tags: ['learning'] },
  { id: 'deepwork', title: 'Deep work 90 min', objective: 'Hold one 90 minute focus block', category: 'mind', kind: 'duration', glyph: '🎯', target: 90, unit: 'min', step: 15, rank: 'A', xp: 260, stats: { INT: 3, PER: 2 }, cadence: 'daily', penalty: 'Focus shattered — deep work locked tomorrow', tags: ['focus'] },
  { id: 'nodoomscroll', title: 'No doomscrolling', objective: 'No doomscrolling today', category: 'mind', kind: 'binary', glyph: '📵', target: 1, unit: 'check', rank: 'C', xp: 100, stats: { PER: 2 }, cadence: 'daily', tags: ['restraint'] },
  { id: 'screentime', title: 'Under 3h screen time', objective: 'Stay under 180 minutes of screen time', category: 'mind', kind: 'value', glyph: '📱', target: 180, unit: 'min', rank: 'C', xp: 95, stats: { PER: 2 }, cadence: 'daily', tags: ['restraint'] },
  { id: 'digitalsunset', title: 'Screens off by 22:00', objective: 'Screens off after 22:00', category: 'mind', kind: 'binary', glyph: '🌇', target: 1, unit: 'check', rank: 'C', xp: 90, stats: { PER: 1, VIT: 1 }, tags: ['restraint'], cadence: 'daily' },
  { id: 'learnnew', title: 'Learn something new', objective: 'Learn one genuinely new thing', category: 'mind', kind: 'binary', glyph: '💡', target: 1, unit: 'check', rank: 'D', xp: 65, stats: { INT: 1, SEN: 1 }, cadence: 'daily', tags: ['learning'] },
  { id: 'lecture', title: 'Listen 30 min', objective: 'Listen to 30 minutes of a lecture or podcast', category: 'mind', kind: 'duration', glyph: '🎧', target: 30, unit: 'min', step: 10, rank: 'E', xp: 50, stats: { INT: 1 }, cadence: 'daily', tags: ['learning'] },
  { id: 'reviewnotes', title: 'Review your notes', objective: 'Review your notes for 20 minutes', category: 'mind', kind: 'duration', glyph: '🗂️', target: 20, unit: 'min', step: 5, rank: 'D', xp: 70, stats: { INT: 2 }, cadence: 'daily', tags: ['study'] },
  { id: 'plantomorrow', title: 'Plan tomorrow', objective: 'Plan tomorrow before you sleep', category: 'mind', kind: 'binary', glyph: '🗺️', target: 1, unit: 'check', rank: 'D', xp: 75, stats: { PER: 2 }, cadence: 'daily', tags: ['planning'] },
  { id: 'mindfulpause', title: '3 mindful pauses', objective: 'Take 3 mindful pauses', category: 'mind', kind: 'counter', glyph: '⏸️', target: 3, unit: 'pauses', step: 1, rank: 'E', xp: 35, stats: { SEN: 1 }, cadence: 'daily', tags: ['mindfulness'] },
];

/* ═══════════════════════════════════════════ CRAFT — Skill & Output */

const craft: QuestDef[] = [
  { id: 'code', title: 'Code for 60 min', objective: 'Write code for 60 minutes', category: 'craft', kind: 'duration', glyph: '⌨️', target: 60, unit: 'min', step: 15, rank: 'B', xp: 180, stats: { INT: 3 }, cadence: 'daily', tags: ['coding'] },
  { id: 'ship', title: 'Ship something', objective: 'Ship something, however small', category: 'craft', kind: 'binary', glyph: '🚀', target: 1, unit: 'check', rank: 'A', xp: 250, stats: { INT: 2, PER: 2 }, cadence: 'daily', penalty: 'Momentum broken — streak multiplier reset', tags: ['output'] },
  { id: 'write', title: 'Write 500 words', objective: 'Write 500 words', category: 'craft', kind: 'counter', glyph: '✍️', target: 500, unit: 'words', step: 50, rank: 'B', xp: 160, stats: { INT: 2, SEN: 1 }, cadence: 'daily', tags: ['writing'] },
  { id: 'instrument', title: 'Practise 30 min', objective: 'Practise an instrument for 30 minutes', category: 'craft', kind: 'duration', glyph: '🎸', target: 30, unit: 'min', step: 10, rank: 'C', xp: 110, stats: { AGI: 1, SEN: 2 }, cadence: 'daily', tags: ['music'] },
  { id: 'draw', title: 'Draw for 30 min', objective: 'Draw or paint for 30 minutes', category: 'craft', kind: 'duration', glyph: '🎨', target: 30, unit: 'min', step: 10, rank: 'C', xp: 110, stats: { SEN: 2, PER: 1 }, cadence: 'daily', tags: ['art'] },
  { id: 'sideproject', title: 'Side project 60 min', objective: 'Work on your side project for 60 minutes', category: 'craft', kind: 'duration', glyph: '🛠️', target: 60, unit: 'min', step: 15, rank: 'B', xp: 175, stats: { INT: 2, PER: 1 }, cadence: 'daily', tags: ['output'] },
  { id: 'inboxzero', title: 'Inbox zero', objective: 'Reach inbox zero', category: 'craft', kind: 'binary', glyph: '📥', target: 1, unit: 'check', rank: 'D', xp: 70, stats: { PER: 2 }, cadence: 'daily', tags: ['work'] },
  { id: 'skilldrill', title: 'Drill a skill', objective: 'Drill a core skill for 30 minutes', category: 'craft', kind: 'duration', glyph: '🔁', target: 30, unit: 'min', step: 10, rank: 'C', xp: 115, stats: { AGI: 2, INT: 1 }, cadence: 'daily', tags: ['practice'] },
  { id: 'course', title: 'One course lesson', objective: 'Finish one course lesson', category: 'craft', kind: 'counter', glyph: '🎓', target: 1, unit: 'lessons', step: 1, rank: 'D', xp: 85, stats: { INT: 2 }, cadence: 'daily', tags: ['learning'] },
  { id: 'portfolio', title: 'Update portfolio', objective: 'Update your portfolio or CV', category: 'craft', kind: 'binary', glyph: '📁', target: 1, unit: 'check', rank: 'C', xp: 120, stats: { PER: 2 }, cadence: 'weekly', tags: ['career'] },
  { id: 'applications', title: 'Send 3 applications', objective: 'Send 3 job applications', category: 'craft', kind: 'counter', glyph: '📮', target: 3, unit: 'sent', step: 1, rank: 'B', xp: 170, stats: { PER: 3 }, cadence: 'weekly', tags: ['career'] },
  { id: 'review', title: 'Review your week', objective: 'Review the week and set next targets', category: 'craft', kind: 'binary', glyph: '📊', target: 1, unit: 'check', rank: 'C', xp: 130, stats: { PER: 2, INT: 1 }, cadence: 'weekly', tags: ['reflection'] },
];

/* ═══════════════════════════ DISCIPLINE — Restraint & Willpower */

const discipline: QuestDef[] = [
  { id: 'nosmoking', title: 'No smoking', objective: 'No smoking or vaping', category: 'discipline', kind: 'binary', glyph: '🚭', target: 1, unit: 'check', rank: 'A', xp: 220, stats: { VIT: 3, PER: 2 }, cadence: 'daily', penalty: 'Toxin buildup — VIT capped for 48h', tags: ['abstain'] },
  { id: 'noalcohol', title: 'No alcohol', objective: 'No alcohol', category: 'discipline', kind: 'binary', glyph: '🍺', target: 1, unit: 'check', rank: 'B', xp: 160, stats: { VIT: 2, PER: 2 }, cadence: 'daily', tags: ['abstain'] },
  { id: 'noporn', title: 'No porn', objective: 'No pornography', category: 'discipline', kind: 'binary', glyph: '🛡️', target: 1, unit: 'check', rank: 'A', xp: 210, stats: { SEN: 3, PER: 2 }, cadence: 'daily', tags: ['abstain'] },
  { id: 'nosnooze', title: 'No snooze', objective: 'Get up on the first alarm', category: 'discipline', kind: 'binary', glyph: '⏰', target: 1, unit: 'check', rank: 'C', xp: 100, stats: { PER: 3 }, cadence: 'daily', tags: ['morning'] },
  { id: 'noimpulse', title: 'No impulse buys', objective: 'No impulse purchases', category: 'discipline', kind: 'binary', glyph: '🪙', target: 1, unit: 'check', rank: 'C', xp: 95, stats: { PER: 2 }, cadence: 'daily', tags: ['abstain'] },
  { id: 'nocomplain', title: 'No complaining', objective: 'No complaining today', category: 'discipline', kind: 'binary', glyph: '🤐', target: 1, unit: 'check', rank: 'B', xp: 140, stats: { SEN: 2, PER: 2 }, cadence: 'daily', tags: ['mindset'] },
  { id: 'socialmedia', title: 'Under 30 min social', objective: 'Under 30 minutes of social media', category: 'discipline', kind: 'value', glyph: '📶', target: 30, unit: 'min', rank: 'C', xp: 105, stats: { PER: 2 }, cadence: 'daily', tags: ['restraint'] },
  { id: 'nogaming', title: 'No gaming', objective: 'No gaming on a weekday', category: 'discipline', kind: 'binary', glyph: '🎮', target: 1, unit: 'check', rank: 'C', xp: 100, stats: { PER: 2 }, cadence: 'daily', tags: ['restraint'] },
  { id: 'keepword', title: 'Keep your word', objective: 'Do the thing you said you would do', category: 'discipline', kind: 'binary', glyph: '⚖️', target: 1, unit: 'check', rank: 'B', xp: 150, stats: { PER: 3 }, cadence: 'daily', tags: ['integrity'] },
  { id: 'hardthing', title: 'Hardest task first', objective: 'Do the hardest task first', category: 'discipline', kind: 'binary', glyph: '🗡️', target: 1, unit: 'check', rank: 'A', xp: 230, stats: { PER: 3, STR: 1 }, cadence: 'daily', penalty: 'Avoidance debuff — XP halved tomorrow', tags: ['mindset'] },
];

/* ══════════════════════════════ CARE — Grooming & Recovery */

const care: QuestDef[] = [
  { id: 'skincare-am', title: 'Morning skincare', objective: 'Complete your morning skincare', category: 'care', kind: 'binary', glyph: '🧴', target: 1, unit: 'check', rank: 'E', xp: 40, stats: { SEN: 1 }, cadence: 'daily', tags: ['skincare'] },
  { id: 'skincare-pm', title: 'Evening skincare', objective: 'Complete your evening skincare', category: 'care', kind: 'binary', glyph: '🌜', target: 1, unit: 'check', rank: 'E', xp: 40, stats: { SEN: 1 }, cadence: 'daily', tags: ['skincare'] },
  { id: 'sunscreen', title: 'Sunscreen', objective: 'Apply sunscreen', category: 'care', kind: 'binary', glyph: '🧢', target: 1, unit: 'check', rank: 'E', xp: 35, stats: { VIT: 1 }, cadence: 'daily', tags: ['skincare'] },
  { id: 'teeth', title: 'Brush twice', objective: 'Brush twice', category: 'care', kind: 'counter', glyph: '🪥', target: 2, unit: 'times', step: 1, rank: 'E', xp: 30, stats: { VIT: 1 }, cadence: 'daily', tags: ['hygiene'] },
  { id: 'floss', title: 'Floss', objective: 'Floss', category: 'care', kind: 'binary', glyph: '🦷', target: 1, unit: 'check', rank: 'E', xp: 25, stats: { VIT: 1 }, cadence: 'daily', tags: ['hygiene'] },
  { id: 'haircare', title: 'Hair care', objective: 'Wash or treat your hair', category: 'care', kind: 'binary', glyph: '💇', target: 1, unit: 'check', rank: 'E', xp: 30, stats: { SEN: 1 }, cadence: 'daily', tags: ['grooming'] },
  { id: 'nails', title: 'Trim your nails', objective: 'Trim and clean your nails', category: 'care', kind: 'binary', glyph: '💅', target: 1, unit: 'check', rank: 'E', xp: 25, stats: { SEN: 1 }, cadence: 'weekly', tags: ['grooming'] },
  { id: 'shave', title: 'Shave or trim', objective: 'Shave or trim your beard', category: 'care', kind: 'binary', glyph: '🪒', target: 1, unit: 'check', rank: 'E', xp: 30, stats: { SEN: 1 }, cadence: 'daily', tags: ['grooming'] },
  { id: 'shower', title: 'Shower', objective: 'Shower', category: 'care', kind: 'binary', glyph: '🚿', target: 1, unit: 'check', rank: 'E', xp: 25, stats: { VIT: 1 }, cadence: 'daily', tags: ['hygiene'] },
  { id: 'makebed', title: 'Make your bed', objective: 'Make your bed', category: 'care', kind: 'binary', glyph: '🛏', target: 1, unit: 'check', rank: 'E', xp: 25, stats: { PER: 1 }, cadence: 'daily', tags: ['order'] },
  { id: 'tidy', title: 'Tidy 15 min', objective: 'Tidy your space for 15 minutes', category: 'care', kind: 'duration', glyph: '🧹', target: 15, unit: 'min', step: 5, rank: 'E', xp: 45, stats: { PER: 1 }, cadence: 'daily', tags: ['order'] },
  { id: 'laundry', title: 'Do laundry', objective: 'Do your laundry', category: 'care', kind: 'binary', glyph: '🧺', target: 1, unit: 'check', rank: 'E', xp: 40, stats: { PER: 1 }, cadence: 'weekly', tags: ['order'] },
  { id: 'dresswell', title: 'Dress well', objective: 'Dress deliberately today', category: 'care', kind: 'binary', glyph: '🧥', target: 1, unit: 'check', rank: 'E', xp: 35, stats: { SEN: 1, PER: 1 }, cadence: 'daily', tags: ['presence'] },
  { id: 'foamroll', title: 'Foam roll 10 min', objective: 'Foam roll for 10 minutes', category: 'care', kind: 'duration', glyph: '🧻', target: 10, unit: 'min', step: 5, rank: 'E', xp: 40, stats: { AGI: 1, VIT: 1 }, cadence: 'daily', tags: ['recovery'] },
];

/* ════════════════════════════════════════════ SOCIAL — Bonds & Party */

const social: QuestDef[] = [
  { id: 'callfamily', title: 'Call family', objective: 'Call a family member', category: 'social', kind: 'binary', glyph: '📞', target: 1, unit: 'check', rank: 'D', xp: 80, stats: { SEN: 2 }, cadence: 'daily', tags: ['family'] },
  { id: 'messagefriend', title: 'Message a friend', objective: 'Reach out to a friend', category: 'social', kind: 'binary', glyph: '💬', target: 1, unit: 'check', rank: 'E', xp: 45, stats: { SEN: 1 }, cadence: 'daily', tags: ['friends'] },
  { id: 'compliment', title: 'Give a compliment', objective: 'Give someone a genuine compliment', category: 'social', kind: 'binary', glyph: '✨', target: 1, unit: 'check', rank: 'E', xp: 40, stats: { SEN: 1 }, cadence: 'daily', tags: ['kindness'] },
  { id: 'helpsomeone', title: 'Help someone', objective: 'Help someone without being asked', category: 'social', kind: 'binary', glyph: '🤝', target: 1, unit: 'check', rank: 'C', xp: 110, stats: { SEN: 2, PER: 1 }, cadence: 'daily', tags: ['kindness'] },
  { id: 'outing', title: 'See people', objective: 'Spend time with people in person', category: 'social', kind: 'binary', glyph: '🎉', target: 1, unit: 'check', rank: 'C', xp: 120, stats: { SEN: 2 }, cadence: 'weekly', tags: ['friends'] },
  { id: 'network', title: 'Make a contact', objective: 'Make one new professional contact', category: 'social', kind: 'binary', glyph: '🌐', target: 1, unit: 'check', rank: 'B', xp: 150, stats: { PER: 2, SEN: 1 }, cadence: 'weekly', tags: ['career'] },
  { id: 'qualitytime', title: 'Phone-free hour', objective: 'Spend 60 minutes with someone, no phone', category: 'social', kind: 'duration', glyph: '👥', target: 60, unit: 'min', step: 15, rank: 'C', xp: 130, stats: { SEN: 3 }, cadence: 'daily', tags: ['presence'] },
  { id: 'sayno', title: 'Say no to something', objective: 'Decline something that drains you', category: 'social', kind: 'binary', glyph: '🚧', target: 1, unit: 'check', rank: 'B', xp: 145, stats: { PER: 3 }, cadence: 'weekly', tags: ['boundaries'] },
  { id: 'apologize', title: 'Repair something', objective: 'Apologise or repair something you owe', category: 'social', kind: 'binary', glyph: '🕊️', target: 1, unit: 'check', rank: 'B', xp: 155, stats: { SEN: 3 }, cadence: 'monthly', tags: ['repair'] },
];

/* ═══════════════════════════════ WEALTH — Resource Management */

const wealth: QuestDef[] = [
  { id: 'trackspend', title: 'Log your spending', objective: 'Log today’s spending', category: 'wealth', kind: 'binary', glyph: '🧾', target: 1, unit: 'check', rank: 'E', xp: 40, stats: { PER: 1 }, cadence: 'daily', tags: ['tracking'] },
  { id: 'nospend', title: 'No-spend day', objective: 'Spend nothing today', category: 'wealth', kind: 'binary', glyph: '🔒', target: 1, unit: 'check', rank: 'C', xp: 115, stats: { PER: 3 }, cadence: 'daily', tags: ['restraint'] },
  { id: 'save', title: 'Move money to savings', objective: 'Move money into savings', category: 'wealth', kind: 'value', glyph: '🏦', target: 50, unit: 'units', rank: 'C', xp: 120, stats: { PER: 2 }, cadence: 'weekly', tags: ['saving'] },
  { id: 'budget', title: 'Review your budget', objective: 'Review your budget', category: 'wealth', kind: 'binary', glyph: '📉', target: 1, unit: 'check', rank: 'C', xp: 110, stats: { PER: 2, INT: 1 }, cadence: 'weekly', tags: ['planning'] },
  { id: 'invest', title: 'Make your contribution', objective: 'Make your scheduled investment contribution', category: 'wealth', kind: 'binary', glyph: '📈', target: 1, unit: 'check', rank: 'B', xp: 170, stats: { PER: 3 }, cadence: 'monthly', tags: ['investing'] },
  { id: 'learnfinance', title: 'Study finance 15 min', objective: 'Study finance for 15 minutes', category: 'wealth', kind: 'duration', glyph: '💹', target: 15, unit: 'min', step: 5, rank: 'D', xp: 70, stats: { INT: 2 }, cadence: 'daily', tags: ['learning'] },
  { id: 'sideincome', title: 'Side income 30 min', objective: 'Work 30 minutes on side income', category: 'wealth', kind: 'duration', glyph: '💰', target: 30, unit: 'min', step: 10, rank: 'B', xp: 160, stats: { PER: 2, INT: 1 }, cadence: 'daily', tags: ['income'] },
  { id: 'cancelsub', title: 'Cancel a subscription', objective: 'Cancel one unused subscription', category: 'wealth', kind: 'binary', glyph: '✂️', target: 1, unit: 'check', rank: 'D', xp: 90, stats: { PER: 2 }, cadence: 'monthly', tags: ['audit'] },
];

/* ------------------------------------------------------------- assembled */

export const QUESTS: QuestDef[] = [
  ...body,
  ...nutrition,
  ...mind,
  ...craft,
  ...discipline,
  ...care,
  ...social,
  ...wealth,
];

export const QUESTS_BY_ID: Record<string, QuestDef> = Object.fromEntries(
  QUESTS.map((q) => [q.id, q]),
);

export function questsByCategory(category: CategoryId): QuestDef[] {
  return QUESTS.filter((q) => q.category === category);
}

/**
 * The starter loadout — a spread across every category that a new hunter sees
 * on day one, rather than all 100 quests at once.
 */
export const DEFAULT_ACTIVE: string[] = [
  'water', 'pushups', 'situps', 'squats', 'run',
  'sleep', 'protein', 'veg',
  'study', 'read', 'meditate', 'journal',
  'code', 'deepwork',
  'nodoomscroll', 'nosnooze',
  'skincare-am', 'skincare-pm', 'teeth', 'makebed',
  'callfamily', 'trackspend',
];
