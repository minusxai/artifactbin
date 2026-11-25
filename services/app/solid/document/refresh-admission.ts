/** Re-read the current document admission after a stream gap. Only a definitive refusal clears the viewer's
 * projection. Navigation or a newer read supersedes an outstanding answer. */
import { onCleanup } from 'solid-js';

export function documentAdmissionReader<T>(win: Window, id: string, apply: (page: T | null) => void): () => Promise<void> {
  let read: AbortController | undefined;
  onCleanup(() => read?.abort());
  return async () => {
    read?.abort();
    const { signal } = read = new AbortController();
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
