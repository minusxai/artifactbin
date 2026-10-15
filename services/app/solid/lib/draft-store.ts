/**
 * WORDS THE READER HAS NOT SENT, KEPT FOR THIS TAB (session storage): a comment, a reply, an edit to a comment.
 *
 * They lived only in the page, so anything that reloaded it — the page loading a new build after a deploy
 * (solid/lib/app-build), a crash boundary, the reader's own reload — threw them away. Each draft is written as it
 * changes and read back when its box mounts again; an empty draft (sent, cancelled, cleared) is removed. Per tab
 * and per origin, like the page itself; text only — a staged image does not survive a reload.
 */
import { createSignal, type Accessor } from 'solid-js';

const PREFIX = 'artifactbin:draft:';

const storage = (): Storage | null => {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
};

/** The draft kept under `key`, or ''. */
export function readDraft(key: string): string {
  try { return storage()?.getItem(PREFIX + key) ?? ''; } catch { return ''; }
}

/** Keep `value` under `key`; an empty one is removed. */
export function writeDraft(key: string, value: string): void {
  try {
    const store = storage();
    if (!store) return;
    if (value) store.setItem(PREFIX + key, value); else store.removeItem(PREFIX + key);
  } catch { /* storage full or unavailable: the draft still lives in the page */ }
}

/** Every draft kept under keys starting `prefix`, by the rest of the key. */
export function draftsUnder(prefix: string): Record<string, string> {
  const found: Record<string, string> = {};
  try {
    const store = storage();
    if (!store) return found;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(PREFIX + prefix)) continue;
      const value = store.getItem(key);
      if (value) found[key.slice(PREFIX.length + prefix.length)] = value;
    }
  } catch { /* unavailable */ }
  return found;
}

/** A text signal that starts from, and keeps itself in, the draft under `key`. */
export function persistedText(key: string): [Accessor<string>, (value: string) => void] {
  const [value, setValue] = createSignal(readDraft(key));
  return [value, (next: string) => { setValue(next); writeDraft(key, next); }];
}
