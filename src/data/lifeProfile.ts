import {
  AGE_BANDS,
  COMMITMENTS,
  GOALS,
  STUDY_METHODS,
  TRAINING_MODES,
  type Profile,
} from '@/data/profile';

/**
 * The life profile: everything The System knows about the Player as a
 * person — studies, work, routine, training, food, habits, people, money,
 * what motivates them and what derails them.
 *
 * It lives on the server (supabase/functions/profile), where every part of
 * The System reads it: the typed assistant, the live call, the planner and
 * the quest proposals. The System fills it by interviewing the Player and
 * keeps it current from what they say, always with Undo.
 *
 * The same catalogue is kept on the server (_shared/profile.ts); the check
 * in scratch/profile-check.ts fails if the two drift apart.
 */

export interface ProfileField {
  key: string;
  label: string;
  /** What to ask, in The System's voice, when it interviews for this field. */
  ask: string;
}

export interface ProfileSection {
  key: string;
  label: string;
  fields: ProfileField[];
}

export const LIFE_SECTIONS: ProfileSection[] = [
  {
    key: 'basics',
    label: 'About you',
    fields: [
      { key: 'name', label: 'Name', ask: 'What should I call you?' },
      { key: 'age', label: 'Age', ask: 'How old are you?' },
      { key: 'location', label: 'Where you live', ask: 'Which city do you live in?' },
      { key: 'languages', label: 'Languages', ask: 'Which languages do you speak?' },
    ],
  },
  {
    key: 'studies',
    label: 'Studies',
    fields: [
      { key: 'program', label: 'What you study', ask: 'What are you studying?' },
      { key: 'school', label: 'Where', ask: 'Which university or school?' },
      { key: 'year', label: 'Year or semester', ask: 'Which year or semester are you in?' },
      { key: 'subjects', label: 'Current subjects', ask: 'Which subjects or courses are you taking right now?' },
      { key: 'exams', label: 'Exams and deadlines', ask: 'Which exams or deadlines are coming up, and when?' },
      { key: 'methods', label: 'How you study', ask: 'How do you usually study?' },
    ],
  },
  {
    key: 'career',
    label: 'Work and career',
    fields: [
      { key: 'job', label: 'Job', ask: 'Do you work? What do you do?' },
      { key: 'hours', label: 'Work hours', ask: 'Which days and hours do you work?' },
      { key: 'goal', label: 'Career goal', ask: 'Where do you want your career to be in a few years?' },
      { key: 'skills', label: 'Skills you are building', ask: 'Which skills are you building right now?' },
    ],
  },
  {
    key: 'routine',
    label: 'Daily routine',
    fields: [
      { key: 'wake', label: 'Usual wake time', ask: 'When do you usually wake up?' },
      { key: 'sleep', label: 'Usual bedtime', ask: 'When do you usually go to sleep?' },
      { key: 'weekday', label: 'A normal weekday', ask: 'Walk me through a normal weekday.' },
      { key: 'weekend', label: 'A normal weekend', ask: 'What does a normal weekend look like?' },
      { key: 'commute', label: 'Commute', ask: 'How do you get to class or work, and how long does it take?' },
      { key: 'best_hours', label: 'Best hours', ask: 'When in the day do you focus best?' },
    ],
  },
  {
    key: 'fitness',
    label: 'Training',
    fields: [
      { key: 'training', label: 'Goal', ask: 'Are you bulking, cutting, or just staying fit?' },
      { key: 'level', label: 'Level', ask: 'How experienced are you with training?' },
      { key: 'activities', label: 'What you do', ask: 'What training or sport do you do, and how often?' },
      { key: 'access', label: 'Gym and equipment', ask: 'Do you have a gym or equipment?' },
    ],
  },
  {
    key: 'food',
    label: 'Food',
    fields: [
      { key: 'diet', label: 'How you eat', ask: 'How do you usually eat in a day?' },
      { key: 'cooking', label: 'Cooking', ask: 'Do you cook for yourself?' },
      { key: 'preferences', label: 'Preferences', ask: 'Anything you do not eat, or always eat?' },
    ],
  },
  {
    key: 'habits',
    label: 'Habits',
    fields: [
      { key: 'build', label: 'Habits to build', ask: 'Which habits do you want to build?' },
      { key: 'break', label: 'Habits to break', ask: 'Which habits do you want to break?' },
    ],
  },
  {
    key: 'people',
    label: 'People',
    fields: [
      { key: 'living', label: 'Who you live with', ask: 'Who do you live with?' },
      { key: 'close', label: 'Important people', ask: 'Who matters most to you day to day?' },
    ],
  },
  {
    key: 'money',
    label: 'Money',
    fields: [
      { key: 'situation', label: 'Situation', ask: 'How is money for you right now, roughly?' },
      { key: 'goal', label: 'Money goal', ask: 'Is there a money goal you are working towards?' },
    ],
  },
  {
    key: 'drive',
    label: 'What drives you',
    fields: [
      { key: 'motivation', label: 'What motivates you', ask: 'What gets you moving when you do not feel like it?' },
      { key: 'interests', label: 'Interests', ask: 'What do you enjoy doing in your free time?' },
      { key: 'rewards', label: 'Rewards that work', ask: 'What kind of reward actually works on you?' },
    ],
  },
  {
    key: 'struggles',
    label: 'What gets in the way',
    fields: [
      { key: 'derailers', label: 'What derails you', ask: 'What usually knocks your day off track?' },
      { key: 'avoid', label: 'What you put off', ask: 'What do you keep putting off?' },
      { key: 'notes', label: 'Anything else', ask: 'Is there anything else I should know to help you well?' },
    ],
  },
];

export type LifeProfile = Record<string, Record<string, string>>;

export const MAX_VALUE = 400;

/**
 * Never stored, whatever the model proposes: credentials, long numbers that
 * could be account or card numbers, and medical details. The System is a
 * coach, not a medical record.
 */
const NEVER_STORE =
  /password|passcode|api[ _-]?key|secret|token|\b\d{9,}\b|\b(diagnos\w*|medicat\w*|prescri\w*|therap\w*|disorder|dosage|symptom\w*)\b/i;

export function findField(section: string, field: string): { section: ProfileSection; field: ProfileField } | null {
  const s = LIFE_SECTIONS.find((x) => x.key === section);
  const f = s?.fields.find((x) => x.key === field);
  return s && f ? { section: s, field: f } : null;
}

/** Clean a value, or say why it cannot be stored. */
export function cleanValue(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE) : '';
  if (NEVER_STORE.test(value)) return { ok: false, error: 'that is not something the profile keeps' };
  return { ok: true, value };
}

export function valueOf(profile: LifeProfile, section: string, field: string): string {
  return profile[section]?.[field] ?? '';
}

/** A copy with one field set; an empty value clears it. */
export function withField(profile: LifeProfile, section: string, field: string, value: string): LifeProfile {
  const next: LifeProfile = { ...profile, [section]: { ...(profile[section] ?? {}) } };
  if (value) next[section][field] = value;
  else delete next[section][field];
  if (Object.keys(next[section]).length === 0) delete next[section];
  return next;
}

/** How much of the profile is filled, 0–100. */
export function completeness(profile: LifeProfile): number {
  const all = LIFE_SECTIONS.flatMap((s) => s.fields.map((f) => [s.key, f.key] as const));
  const filled = all.filter(([s, f]) => valueOf(profile, s, f) !== '').length;
  return Math.round((filled / all.length) * 100);
}

/** The empty fields, in interview order. */
export function emptyFields(profile: LifeProfile): { section: string; field: string; ask: string }[] {
  return LIFE_SECTIONS.flatMap((s) =>
    s.fields.filter((f) => valueOf(profile, s.key, f.key) === '').map((f) => ({ section: s.key, field: f.key, ask: f.ask })),
  );
}

/**
 * What the onboarding answers say, as profile fields — so the very first
 * sign-up already tells The System who it is talking to.
 */
export function fromOnboarding(p: Profile): { section: string; field: string; value: string }[] {
  const age = AGE_BANDS.find((a) => a.id === p.ageBand)?.label;
  const training = TRAINING_MODES.find((t) => t.id === p.training);
  const goals = p.goals.map((g) => GOALS.find((x) => x.id === g)?.label).filter(Boolean);
  const methods = p.studyMethods.map((m) => STUDY_METHODS.find((x) => x.id === m)?.label).filter(Boolean);
  const commitment = COMMITMENTS.find((c) => c.id === p.commitment);
  return [
    { section: 'basics', field: 'name', value: p.name.trim() },
    { section: 'basics', field: 'age', value: age ? `${age} (age band)` : '' },
    { section: 'fitness', field: 'training', value: training ? `${training.label}: ${training.blurb.toLowerCase()}` : '' },
    { section: 'studies', field: 'methods', value: methods.length ? methods.join(', ') : '' },
    { section: 'habits', field: 'build', value: goals.length ? `Wants: ${goals.join(', ').toLowerCase()}` : '' },
    { section: 'drive', field: 'motivation', value: commitment ? `Chose a ${commitment.label.toLowerCase()} daily load (${commitment.blurb.toLowerCase()})` : '' },
  ].filter((f) => f.value);
}

/* -------------------------------------------------------------- documents */

export interface WeeklyBlock {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  start: string;
  end: string;
  title: string;
  place?: string;
}

export interface ProfileDocument {
  id: string;
  name: string;
  kind: string;
  summary: string;
  weekly: WeeklyBlock[];
  dates: { date: string; title: string }[];
  createdAt: string;
}

export const DAY_LABEL: Record<WeeklyBlock['day'], string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** What can be uploaded, and how big. Gemini reads PDFs and photos directly. */
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const MAX_DOCUMENT_BYTES = 4_000_000;
