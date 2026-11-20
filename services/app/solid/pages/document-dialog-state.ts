/**
 * WHICH OF THE DOCUMENT PAGE'S DIALOGS IS UP (sharing, settings or the social preview editor), apart from the dialogs
 * themselves (./DocumentDialogs, a lazy chunk: none is needed for first paint). The social preview first loads the head
 * it edits; a failure is the page's `error` instead.
 *
 * Interface: `createDocumentDialogs({ backend, editable })` → `{ open, show, close, openSocialPreview, previewHead, error }`.
 */
import { createSignal } from 'solid-js';
import type { ReaderArtifactBackend } from '@/lib/artifact-backend';

export type DocumentDialog = 'sharing' | 'settings' | 'social';

export function createDocumentDialogs(options: { backend: ReaderArtifactBackend | null; editable: () => boolean }) {
  const [open, show] = createSignal<DocumentDialog | null>(null);
  const [previewHead, setPreviewHead] = createSignal<{ source: string; editId: string; version: number } | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  return {
    open,
    show,
    close: () => show(null),
    previewHead,
    error,
    openSocialPreview: async () => {
      const backend = options.backend;
      if (!backend || !options.editable()) return;
      setError(null);
      try {
        const head = await backend.load();
        if (!head) throw new Error('Social preview is unavailable. Refresh and try again.');
        setPreviewHead({ source: head.html ?? '', editId: head.edit_id, version: head.version });
        show('social');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load social preview.'); }
    },
  };
}
