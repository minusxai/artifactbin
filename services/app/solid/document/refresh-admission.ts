/** Re-read the current document admission after a stream gap. Only a definitive refusal clears the viewer's
 * projection. Navigation or a newer read supersedes an outstanding answer. */
import { onCleanup } from 'solid-js';
import type { DocumentAnswer } from '../pages/Document';

export function documentAdmissionReader<T>(win: Window, id: string, apply: (page: T | null) => void): () => Promise<void> {
  let read: AbortController | undefined;
  onCleanup(() => read?.abort());
  return async () => {
    read?.abort();
    read = new AbortController();
    const { signal } = read;
    let page: T | null;
    try {
      const response = await win.fetch(`/api/page/artifact/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal });
      if (response.ok) page = await response.json() as T;
      else if (response.status === 404) page = null;
      else return;
    } catch { return; }
    if (!signal.aborted) apply(page);
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
