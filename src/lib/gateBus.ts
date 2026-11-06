/**
 * Opening a boss quest's Gate from its card. The Gate on screen registers
 * how to open itself; the card only says which quest, and where on screen the
 * Gate button is, so the portal can open from that spot.
 */

type Opener = (questId: string, x: number, y: number) => void;

let opener: Opener | null = null;

export function registerGate(open: Opener | null) {
  opener = open;
}

export function openGate(questId: string, x: number, y: number) {
  opener?.(questId, x, y);
}

/**
 * A boss quest is the hardest kind: A-rank and up. Those you work at over time
 * get a Gate, a place to do it with nothing else on screen.
 */
export function isBoss(rank: string): boolean {
  return rank === 'A' || rank === 'S';
}
