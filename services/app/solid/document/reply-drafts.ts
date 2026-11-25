/**
 * Unsent reply text belongs to the thread in this tab, whether it is open at a marker or in the rail.
 * Older builds stored the rail independently. Keep distinct drafts as separate paragraphs and remove
 * the old rail key only after the shared value is stored.
 */
import { createSignal } from 'solid-js';
import { draftsUnder, writeDraft } from '../lib/draft-store';

export type ReplyDrafts = ReturnType<typeof createReplyDrafts>;

export function createReplyDrafts(artifactId: string) {
  const prefix = `${artifactId}:reply:`;
  const legacy = `${artifactId}:thread-reply:`;
  const initial = draftsUnder(prefix);
  const persist = (id: string, value: string) => {
    if (writeDraft(prefix + id, value)) writeDraft(legacy + id, '');
  };

  for (const [id, rail] of Object.entries(draftsUnder(legacy))) {
    const marker = initial[id];
    const merged = marker && marker !== rail ? `${marker}\n\n${rail}` : rail;
    initial[id] = merged;
    persist(id, merged);
  }

  const [values, setValues] = createSignal(initial);
  return {
    get: (id: string) => values()[id] ?? '',
    set(id: string, value: string) {
      persist(id, value);
      setValues((current) => {
        const next = { ...current };
        if (value) next[id] = value; else delete next[id];
        return next;
      });
    },
  };
}
