import { useSyncExternalStore } from 'react';

/**
 * Opening The System from anywhere: the Profile screen asks it to interview
 * the Player or to suggest quests, onboarding asks for a first proposal.
 * The floating assistant listens and opens itself in that mode.
 */

export type AssistantMode = 'chat' | 'interview' | 'board' | 'live-interview';

export interface AssistantRequest {
  mode: AssistantMode;
  /** Increases with every request, so asking twice opens twice. */
  seq: number;
}

let current: AssistantRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function openAssistant(mode: AssistantMode): void {
  current = { mode, seq: ++seq };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAssistantRequest(): AssistantRequest | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
