import { QUESTS_BY_ID } from '@/data/quests';

/* --------------------------------------------------------------- profile */

export type AgeBand = 'under16' | '16to18' | '19to22' | 'over22';
export type TrainingMode = 'bulking' | 'cutting' | 'recomp' | 'none';
export type Commitment = 'light' | 'standard' | 'intense';

export interface Profile {
  name: string;
  ageBand: AgeBand;
  goals: GoalId[];
  training: TrainingMode;
  studyMethods: StudyMethodId[];
  commitment: Commitment;
  /** ISO date the plan was generated. */
  createdAt: string;
}

export const AGE_BANDS: { id: AgeBand; label: string }[] = [
  { id: 'under16', label: 'Under 16' },
  { id: '16to18', label: '16 – 18' },
  { id: '19to22', label: '19 – 22' },
  { id: 'over22', label: '23+' },
];

/* ----------------------------------------------------------------- goals */

export type GoalId =
  | 'fitness'
  | 'grades'
  | 'focus'
  | 'sleep'
  | 'discipline'
  | 'confidence'
  | 'money'
  | 'skills';

export const GOALS: { id: GoalId; label: string; blurb: string; glyph: string }[] = [
  { id: 'grades', label: 'Better grades', blurb: 'Study that actually sticks', glyph: '📚' },
  { id: 'focus', label: 'Deeper focus', blurb: 'Less scrolling, longer attention', glyph: '🎯' },
  { id: 'fitness', label: 'Get stronger', blurb: 'Train consistently', glyph: '💪' },
  { id: 'sleep', label: 'Fix my sleep', blurb: 'Wake up without wrecking yourself', glyph: '🌙' },
  { id: 'discipline', label: 'Build discipline', blurb: 'Do it when you don’t feel like it', glyph: '⛨' },
  { id: 'confidence', label: 'Feel confident', blurb: 'Look after yourself properly', glyph: '✦' },
  { id: 'skills', label: 'Learn a skill', blurb: 'Ship things, build a portfolio', glyph: '🛠️' },
  { id: 'money', label: 'Handle money', blurb: 'Track it, keep it, grow it', glyph: '◆' },
];

const GOAL_QUESTS: Record<GoalId, string[]> = {
  grades: ['study', 'read', 'flashcards', 'reviewnotes', 'plantomorrow'],
  focus: ['deepwork', 'nodoomscroll', 'screentime', 'meditate', 'digitalsunset'],
  fitness: ['pushups', 'situps', 'squats', 'lift', 'run', 'stretch', 'steps'],
  sleep: ['sleep', 'bedtime', 'wake', 'digitalsunset', 'sunlight'],
  discipline: ['nosnooze', 'hardthing', 'keepword', 'coldshower', 'nocomplain'],
  confidence: ['skincare-am', 'skincare-pm', 'posture', 'dresswell', 'makebed'],
  skills: ['code', 'sideproject', 'course', 'write', 'ship'],
  money: ['trackspend', 'budget', 'learnfinance', 'nospend'],
};

/* -------------------------------------------------------------- training */

export const TRAINING_MODES: {
  id: TrainingMode;
  label: string;
  blurb: string;
  detail: string;
}[] = [
  {
    id: 'bulking',
    label: 'Bulking',
    blurb: 'Build muscle and size',
    detail: 'Heavy lifting, a calorie surplus and high protein. Sleep matters more than you think — muscle is built while you recover, not while you train.',
  },
  {
    id: 'cutting',
    label: 'Cutting',
    blurb: 'Lose fat, keep muscle',
    detail: 'A calorie deficit with protein kept high so you lose fat rather than muscle, plus steps and cardio to widen the gap without extra hunger.',
  },
  {
    id: 'recomp',
    label: 'Recomp',
    blurb: 'Leaner and stronger, slowly',
    detail: 'Eat around maintenance, train hard, keep protein high. Slower than either bulking or cutting, but you don’t swing between them.',
  },
  {
    id: 'none',
    label: 'Not training',
    blurb: 'Skip the gym side for now',
    detail: 'No lifting or nutrition quests. You can add them from the Archive whenever you want.',
  },
];

/**
 * Quests without which the training mode makes no sense. These are pinned
 * near anchor weight so a goal-heavy plan can never crowd them out — bulking
 * with no protein quest is not a plan, it's a bug.
 */
const TRAINING_CORE: Record<TrainingMode, string[]> = {
  bulking: ['protein', 'lift'],
  cutting: ['protein', 'calories'],
  recomp: ['protein', 'lift'],
  none: [],
};

/** Supporting quests for the mode — nice to have, first to be trimmed. */
const TRAINING_QUESTS: Record<TrainingMode, string[]> = {
  bulking: ['pushups', 'pullups', 'calories', 'homecooked', 'creatine'],
  cutting: ['cardio', 'steps', 'nojunk', 'nosugar', 'veg'],
  recomp: ['cardio', 'veg', 'lift'],
  none: [],
};

/* --------------------------------------------------------- study methods */

export type StudyMethodId = 'retrieval' | 'spaced' | 'interleaving' | 'elaboration' | 'feynman';

/**
 * Utility ratings follow Dunlosky et al. (2013), "Improving Students' Learning
 * With Effective Learning Techniques", which graded ten common study methods
 * against the evidence. Only two earned a HIGH rating; the popular ones
 * students actually use — highlighting, rereading — were rated LOW.
 */
export const STUDY_METHODS: {
  id: StudyMethodId;
  label: string;
  utility: 'High' | 'Moderate';
  how: string;
  why: string;
}[] = [
  {
    id: 'retrieval',
    label: 'Active recall',
    utility: 'High',
    how: 'Shut the book and write down what you remember, then check.',
    why: 'Pulling information out of memory strengthens it far more than putting it back in. Rereading feels productive because it feels easy — that fluency is the illusion.',
  },
  {
    id: 'spaced',
    label: 'Spaced repetition',
    utility: 'High',
    how: 'Revisit material after a day, then three, then a week.',
    why: 'The same total hours spread across days beat one long session. Forgetting a little between reviews is what makes the next review work.',
  },
  {
    id: 'interleaving',
    label: 'Interleaving',
    utility: 'Moderate',
    how: 'Mix problem types in one session instead of doing twenty of the same.',
    why: 'Blocked practice makes you good at knowing which method to apply because you were just told. Mixing forces you to choose — which is what an exam asks.',
  },
  {
    id: 'elaboration',
    label: 'Elaborative interrogation',
    utility: 'Moderate',
    how: 'For each fact, ask "why is this true?" and answer out loud.',
    why: 'Explaining why binds new material to what you already know, which gives recall more routes back to it.',
  },
  {
    id: 'feynman',
    label: 'Feynman technique',
    utility: 'Moderate',
    how: 'Explain it in plain words as if to a younger student; note where you stall.',
    why: 'The point where your explanation breaks is exactly where your understanding is thin. It finds the gap faster than rereading does.',
  },
];

const STUDY_QUESTS: Record<StudyMethodId, string[]> = {
  retrieval: ['flashcards', 'study'],
  spaced: ['flashcards', 'reviewnotes'],
  interleaving: ['skilldrill', 'study'],
  elaboration: ['learnnew', 'journal'],
  feynman: ['write', 'learnnew'],
};

/* ------------------------------------------------------------ commitment */

export const COMMITMENTS: { id: Commitment; label: string; blurb: string; size: number }[] = [
  { id: 'light', label: 'Light', blurb: 'A handful of quests — build the habit first', size: 8 },
  { id: 'standard', label: 'Standard', blurb: 'A full but survivable day', size: 15 },
  { id: 'intense', label: 'Intense', blurb: 'The full Jinwoo treatment', size: 24 },
];

/* --------------------------------------------------------- plan building */

/** Anchors everyone gets — cheap, high-return, and they seed the streak. */
const ANCHORS = ['water', 'sleep', 'makebed'];

/**
 * Turn the intake into a concrete board.
 *
 * Candidates are scored rather than concatenated, so a quest that serves two
 * of the student's goals outranks one that serves a single goal. Ties break
 * toward the cheaper quest, so a light plan doesn't fill up with A-rank work.
 */
export function buildPlan(profile: Profile): string[] {
  const score = new Map<string, number>();
  const add = (ids: string[], weight: number) => {
    for (const id of ids) {
      if (!QUESTS_BY_ID[id]) continue; // guard against a renamed quest
      score.set(id, (score.get(id) ?? 0) + weight);
    }
  };

  add(ANCHORS, 100);
  add(TRAINING_CORE[profile.training] ?? [], 90);
  for (const goal of profile.goals) add(GOAL_QUESTS[goal] ?? [], 10);
  add(TRAINING_QUESTS[profile.training] ?? [], 8);
  for (const method of profile.studyMethods) add(STUDY_QUESTS[method] ?? [], 6);

  const size = COMMITMENTS.find((c) => c.id === profile.commitment)?.size ?? 15;

  return [...score.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      // Cheaper quests first, so a light plan stays achievable.
      return (QUESTS_BY_ID[a[0]]?.xp ?? 0) - (QUESTS_BY_ID[b[0]]?.xp ?? 0);
    })
    .slice(0, size)
    .map(([id]) => id);
}

/** One-line summary of the generated plan, shown on the review step. */
export function describePlan(profile: Profile, planIds: string[]): string {
  const goalLabels = profile.goals
    .map((g) => GOALS.find((x) => x.id === g)?.label.toLowerCase())
    .filter(Boolean);
  const goalText =
    goalLabels.length > 1
      ? `${goalLabels.slice(0, -1).join(', ')} and ${goalLabels.at(-1)}`
      : (goalLabels[0] ?? 'a stronger baseline');
  const training = TRAINING_MODES.find((t) => t.id === profile.training);
  const trainingText = profile.training === 'none' ? '' : `, built around ${training?.label.toLowerCase()}`;
  return `${planIds.length} daily quests aimed at ${goalText}${trainingText}.`;
}
