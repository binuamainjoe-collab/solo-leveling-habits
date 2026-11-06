/**
 * Beru's sources: where each finding really lives, and whether Beru read it.
 *
 * Gemini hands back two lists after a search that reads pages:
 *
 *   - grounding chunks, one per search result the answer leaned on. Their
 *     `uri` is a vertexaisearch.cloud.google.com redirect, not the page, and
 *     the redirect expires. Their `title` is usually just the domain.
 *   - URL context metadata, one entry per page the model tried to open, with
 *     whether it could read it (read, paywalled, unsafe, failed).
 *
 * This module turns both into one list of real pages, each marked with how
 * far Beru got: read it, or only saw it in search. Findings are then matched
 * against that list, so a URL the model made up never reaches the student.
 *
 * Pure apart from the fetch it is handed: `npx tsx scratch/beru-check.ts`
 * tests it without Deno.
 */

/** How far Beru got with a page. */
export type PageStatus = 'read' | 'search' | 'paywall' | 'unsafe' | 'error';

export interface Source {
  /** The publisher's own address when the redirect could be followed. */
  url: string;
  /** The domain, for a search result; empty for a page Beru only opened. */
  title: string;
  status: PageStatus;
}

export interface Chunk {
  uri: string;
  title: string;
}

export interface Page {
  url: string;
  /** Gemini's urlRetrievalStatus, as sent. */
  status: string;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const REDIRECT_PATH = '/grounding-api-redirect/';

/** More than this many redirects in one run is not a real search result list. */
const MAX_RESOLVE = 30;

export function isGroundingRedirect(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.host === REDIRECT_HOST && u.pathname.startsWith(REDIRECT_PATH);
  } catch {
    return false;
  }
}

/** Strip tracking junk so the same page twice is caught as the same page. */
export function normaliseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) u.searchParams.delete(key);
    }
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * A looser key for "is this the same page": http or https, with or without
 * www. Used to match a finding to its source and to spot repeats, never
 * stored.
 */
export function looseKey(raw: string | null | undefined): string | null {
  const key = normaliseUrl(raw);
  return key ? key.replace(/^https?:\/\/(www\.)?/, '') : null;
}

/** Gemini's retrieval status, in Beru's words. */
export function pageStatus(raw: string): PageStatus {
  switch (raw) {
    case 'URL_RETRIEVAL_STATUS_SUCCESS':
      return 'read';
    case 'URL_RETRIEVAL_STATUS_PAYWALL':
      return 'paywall';
    case 'URL_RETRIEVAL_STATUS_UNSAFE':
      return 'unsafe';
    default:
      return 'error';
  }
}

/**
 * When the same page turns up more than once, the strongest word wins.
 * A failed open still means the page was found, so it counts like a search
 * result. Paywalled or unsafe on any attempt rules the page out.
 */
const WEIGHT: Record<PageStatus, number> = { search: 0, error: 1, read: 2, paywall: 3, unsafe: 4 };

/**
 * Follow one grounding redirect to the page it points at.
 *
 * Only Google's redirect service is asked, with redirects off, so the
 * publisher is never visited: its `Location` header is the answer. Anything
 * that goes wrong keeps the redirect itself, which still works for a while,
 * so a finding is never left with no link at all.
 */
export async function resolveRedirect(raw: string, fetcher: Fetcher, timeoutMs = 5_000): Promise<string> {
  if (!isGroundingRedirect(raw)) return raw;
  try {
    const res = await fetcher(raw, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const location = res.headers.get('location');
    await res.body?.cancel();
    if (res.status >= 300 && res.status < 400 && location) {
      const target = new URL(location, raw).toString();
      if (normaliseUrl(target) && !isGroundingRedirect(target)) return target;
    }
  } catch {
    // Kept as the redirect, below.
  }
  return raw;
}

/** Follow every redirect in both lists at once. */
export async function resolveAll(
  chunks: Chunk[],
  pages: Page[],
  fetcher: Fetcher,
): Promise<{ chunks: Chunk[]; pages: Page[]; unresolved: number }> {
  const wanted = [...new Set([...chunks.map((c) => c.uri), ...pages.map((p) => p.url)].filter(isGroundingRedirect))].slice(
    0,
    MAX_RESOLVE,
  );
  const resolved = new Map<string, string>();
  await Promise.all(
    wanted.map(async (raw) => {
      resolved.set(raw, await resolveRedirect(raw, fetcher));
    }),
  );
  const real = (raw: string) => resolved.get(raw) ?? raw;
  const out = {
    chunks: chunks.map((c) => ({ ...c, uri: real(c.uri) })),
    pages: pages.map((p) => ({ ...p, url: real(p.url) })),
  };
  const unresolved = [...out.chunks.map((c) => c.uri), ...out.pages.map((p) => p.url)].filter(isGroundingRedirect).length;
  return { ...out, unresolved };
}

/** One list of pages, each once, with how far Beru got. */
export function buildSources(chunks: Chunk[], pages: Page[]): Source[] {
  const byKey = new Map<string, Source>();
  const add = (url: string, title: string, status: PageStatus) => {
    const key = looseKey(url);
    if (!key) return;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { url: url.trim(), title: title.trim(), status });
      return;
    }
    if (WEIGHT[status] > WEIGHT[seen.status]) seen.status = status;
    if (!seen.title && title) seen.title = title.trim();
  };
  for (const c of chunks) add(c.uri, c.title, 'search');
  for (const p of pages) add(p.url, '', pageStatus(p.status));
  return [...byKey.values()];
}

/** Whether a source may become a finding at all. */
export function usable(s: Source): boolean {
  return s.status !== 'paywall' && s.status !== 'unsafe';
}

/** The source a finding's URL names, if it names one. */
export function matchSource(url: string | null | undefined, sources: Source[]): Source | null {
  const key = looseKey(url);
  if (!key) return null;
  return sources.find((s) => looseKey(s.url) === key) ?? null;
}

/** The list the structuring call is given, read pages first. */
export function sourceLines(sources: Source[]): string {
  const label: Record<PageStatus, string> = {
    read: 'read',
    search: 'search result only',
    error: 'could not open',
    paywall: 'paywall',
    unsafe: 'unsafe',
  };
  return [...sources]
    .sort((a, b) => Number(b.status === 'read') - Number(a.status === 'read'))
    .map((s, i) => `${i + 1}. [${label[s.status]}] ${s.title ? `${s.title} — ` : ''}${s.url}`)
    .join('\n');
}
