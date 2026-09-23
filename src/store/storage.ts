import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Everything the app needs from persistence. Feature code talks to `storage`,
 * never to AsyncStorage directly, so swapping in a cloud backend later means
 * writing one adapter rather than touching every caller.
 */
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const asyncStorageAdapter: StorageAdapter = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

let adapter: StorageAdapter = asyncStorageAdapter;

/** Point persistence at something else (a cloud adapter, or a fake in tests). */
export function setStorageAdapter(next: StorageAdapter): void {
  adapter = next;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * A write that cannot lose data to a slow disk. Writes are coalesced — rapid
 * taps produce one write — but the *latest* value always wins, and a failed
 * write is reported rather than swallowed, because silently dropping a
 * student's progress is the one failure this app must not have.
 */
export class PersistentStore<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: T | null = null;
  private writing = false;

  constructor(
    private readonly key: string,
    private readonly onStateChange: (state: SaveState, error?: string) => void,
    private readonly delayMs = 250,
  ) {}

  async load(): Promise<T | null> {
    try {
      const raw = await adapter.get(this.key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      // A corrupt blob must not brick the app — report it and start fresh.
      this.onStateChange('error', err instanceof Error ? err.message : 'load failed');
      return null;
    }
  }

  /** Queue a save. Safe to call on every keystroke or tap. */
  save(value: T): void {
    this.pending = value;
    this.onStateChange('saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Write immediately — call before the app backgrounds or unmounts. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending === null || this.writing) return;

    this.writing = true;
    const value = this.pending;
    this.pending = null;
    try {
      await adapter.set(this.key, JSON.stringify(value));
      this.onStateChange('saved');
    } catch (err) {
      // Put it back so the next flush retries rather than dropping the write.
      this.pending = value;
      this.onStateChange('error', err instanceof Error ? err.message : 'save failed');
    } finally {
      this.writing = false;
      // A save queued while we were writing needs its own flush.
      if (this.pending !== null) this.timer = setTimeout(() => void this.flush(), this.delayMs);
    }
  }

  async clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.pending = null;
    await adapter.remove(this.key).catch(() => {});
  }
}
