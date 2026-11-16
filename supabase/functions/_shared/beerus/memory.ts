/**
 * Beerus's memory retrieval — the memories that matter for this message,
 * not every memory every time.
 *
 * After OpenJarvis's Memory primitive (its default backend is SQLite FTS5
 * with BM25 ranking). Here the memories are already loaded for the prompt,
 * so the ranking runs in code: BM25 over the words of the message and the
 * Player's last two messages (see knowledge() in system.ts), plus a small lift for commitments and facts (the things a
 * coach must not forget) and for what was seen recently.
 *
 * While there are no more memories than the route asks for, every memory is
 * kept, in its original order. Only the lean route (small talk) asks for
 * fewer than the 80 the assistant always loaded; every other route asks for
 * all 80, so retrieval trims small talk and nothing else.
 *
 * Pure: no Deno, no network. Checked by scratch/beerus-framework-check.ts.
 */

export interface MemoryItem {
  kind: string;
  content: string;
  /** ISO time it was last seen or confirmed, when known. */
  lastSeen?: string | null;
}

const STOP = new Set(
  'a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just me my of on or our she so than that the their them then there they this to too up us was we were what when where which who why will with would you your im ive dont its'.split(
    ' ',
  ),
);

/**
 * Plurals only, so a word and its plural meet: "exams" → "exam",
 * "studies" → "study", "classes" → "class". "class", "gas" and "notes"
 * keep their meaning; verb endings are left alone, because stripping them
 * by rule makes more mismatches ("running" → "runn") than it fixes.
 */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lower-case words, stop words gone, plurals folded so "exams" meets "exam". */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9äöüß]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

const KIND_LIFT: Record<string, number> = { commitment: 0.6, fact: 0.4, preference: 0.2, pattern: 0.2 };

/**
 * The `topK` memories most relevant to `query`, best first. With `topK` or
 * fewer memories, all of them, unchanged and in their original order.
 */
export function rankMemories<T extends MemoryItem>(query: string, memories: T[], topK: number, now = Date.now()): T[] {
  if (memories.length <= topK) return memories;
  const q = [...new Set(tokens(query))];
  const docs = memories.map((m) => tokens(m.content));
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length) || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = memories.length;
  const k1 = 1.2;
  const b = 0.75;

  const scored = memories.map((m, i) => {
    const d = docs[i];
    let bm25 = 0;
    for (const w of q) {
      const tf = d.filter((x) => x === w).length;
      if (!tf) continue;
      const idf = Math.log(1 + (n - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      bm25 += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avg)));
    }
    const seen = m.lastSeen ? Date.parse(m.lastSeen) : NaN;
    const ageDays = Number.isNaN(seen) ? 60 : Math.max(0, (now - seen) / 86_400_000);
    const recency = 0.3 / (1 + ageDays / 14);
    return { m, i, score: bm25 + (KIND_LIFT[m.kind] ?? 0) + recency };
  });

  // Ties keep the original order (most recently seen first, as loaded).
  scored.sort((x, y) => y.score - x.score || x.i - y.i);
  return scored.slice(0, Math.max(0, topK)).map((s) => s.m);
}
