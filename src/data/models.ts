/**
 * The Gemini models the Player can pick for each part of the System, as the
 * Models card on the Status tab shows them.
 *
 * The server holds the same list (MODEL_CHOICES in
 * supabase/functions/_shared/models.ts) and only ever uses an id on it, so
 * this file decides what is offered, never what runs.
 * scratch/models-check.ts fails if the two lists drift apart.
 *
 * Pure: no React Native, so it can be checked under plain Node.
 */

export type ModelRole = 'beerus' | 'live' | 'planner';

export interface ModelOption {
  id: string;
  /** The chip. */
  label: string;
  /** One line under the chips when this one is picked. */
  hint: string;
}

export interface RoleChoice {
  title: string;
  /** What this part of the System does, in a line. */
  about: string;
  default: string;
  options: ModelOption[];
}

export const MODEL_ROLES: ModelRole[] = ['beerus', 'live', 'planner'];

export const MODEL_CHOICES: Record<ModelRole, RoleChoice> = {
  beerus: {
    title: 'Beerus',
    about: 'Typed and spoken chat, his memory, and reading the files you give him.',
    default: 'gemini-4-hydrogen',
    options: [
      { id: 'gemini-4-hydrogen', label: 'Hydrogen', hint: 'Gemini 4 Hydrogen. Fast and sharp for everyday talk. The default.' },
      { id: 'gemini-4-argon', label: 'Argon', hint: 'Gemini 4 Argon. Deeper reasoning; replies take longer.' },
      { id: 'gemini-4-carbon', label: 'Carbon', hint: 'Gemini 4 Carbon. The strongest and the slowest, and costs the most.' },
      { id: 'gemini-3.8-flash', label: '3.8 Flash', hint: 'Gemini 3.8 Flash. The previous generation: quick and cheap.' },
    ],
  },
  live: {
    title: 'Beerus Live',
    about: 'His voice in a live call. He asks his Beerus model whenever he needs your memory or files.',
    default: 'gemini-3.8-live-extended-thinking',
    options: [
      {
        id: 'gemini-3.8-live-extended-thinking',
        label: 'Live, thinking',
        hint: 'Gemini 3.8 Live with extended thinking. Smarter, and keeps talking while it thinks. The default.',
      },
      { id: 'gemini-3.8-live', label: 'Live, fast', hint: 'Gemini 3.8 Live. Answers instantly, thinks less.' },
    ],
  },
  planner: {
    title: 'Planner',
    about: 'The planner chat and tomorrow’s plan. Flash steps in if it is down.',
    default: 'gemini-4-argon',
    options: [
      { id: 'gemini-4-argon', label: 'Argon', hint: 'Gemini 4 Argon. Careful plans. The default.' },
      { id: 'gemini-4-hydrogen', label: 'Hydrogen', hint: 'Gemini 4 Hydrogen. Quicker plans.' },
      { id: 'gemini-4-carbon', label: 'Carbon', hint: 'Gemini 4 Carbon. The most thorough, and the slowest.' },
      { id: 'gemini-3.8-flash', label: '3.8 Flash', hint: 'Gemini 3.8 Flash. The quickest.' },
    ],
  },
};

export type ModelPicks = Partial<Record<ModelRole, string>>;

/** The model a role runs on: the Player's pick if it is on the list, else the default. */
export function pickedModel(role: ModelRole, picks: ModelPicks): string {
  const choice = MODEL_CHOICES[role];
  const raw = picks[role];
  return raw && choice.options.some((o) => o.id === raw) ? raw : choice.default;
}

/** Only known roles and listed ids survive, so nothing odd is ever saved. */
export function cleanPicks(raw: unknown): ModelPicks {
  const out: ModelPicks = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const role of MODEL_ROLES) {
    const id = (raw as Record<string, unknown>)[role];
    if (typeof id === 'string' && MODEL_CHOICES[role].options.some((o) => o.id === id)) out[role] = id;
  }
  return out;
}
