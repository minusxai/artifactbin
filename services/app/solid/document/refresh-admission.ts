/** Re-read the current document admission after a stream gap. Only a definitive refusal clears the viewer's
 * projection. A stream reports an error and its reconnect back to back: a request while a read is outstanding is
 * coalesced into one more read after it (never an abort, which every check reports as a failed request), and only
 * the latest read's answer is applied. Navigation aborts an outstanding read. */
import { onCleanup } from 'solid-js';
import type { DocumentAnswer } from '../pages/Document';

export function documentAdmissionReader<T>(win: Window, id: string, apply: (page: T | null) => void): () => Promise<void> {
  const disposed = new AbortController();
  onCleanup(() => disposed.abort());
  let running: Promise<void> | undefined;
  let again = false;
  const readOnce = async (): Promise<{ page: T | null } | undefined> => {
    try {
      const response = await win.fetch(`/api/page/artifact/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal: disposed.signal });
      if (response.ok) return { page: await response.json() as T };
      if (response.status === 404) return { page: null };
    } catch { /* unreachable or aborted: keep the current projection */ }
    return undefined;
  };
  const run = async () => {
    try {
      do {
        again = false;
        const answer = await readOnce();
        if (disposed.signal.aborted) return;
        // A newer request arrived while this read was outstanding: its answer may be stale, so read once more.
        if (!again && answer) apply(answer.page);
      } while (again);
    } finally { running = undefined; }
  };
  return () => {
    if (disposed.signal.aborted) return Promise.resolve();
    if (running) { again = true; return running; }
    running = run();
    return running;
  };
}

/** Membership events have no replay cursor. Reload the shell and its frame ticket only when the reader's access changed. */
export function refreshReaderAccess(win: Window, id: string, page: DocumentAnswer, refreshMembers: () => void, reload: () => void) {
  return documentAdmissionReader<DocumentAnswer>(win, id, next => {
    refreshMembers();
    if (!next || next.role !== page.role || next.kind !== page.kind || next.canManageSharing !== page.canManageSharing
      || next.surface?.group_id !== page.surface?.group_id || next.surface?.membership !== page.surface?.membership) reload();
  });
}
