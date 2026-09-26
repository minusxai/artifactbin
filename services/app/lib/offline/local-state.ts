/**
 * What an open offline file keeps in the reader's own browser, beside the file:
 *  - the name they comment and edit under (`afbin-offline-name`), so a second
 *    file opened in the same browser does not ask again;
 *  - a crash buffer of unsaved work (`afbin-offline-draft:<id>:<downloadedAt>`),
 *    so a closed tab or a crash does not lose what was never saved.
 *
 * Storage is a convenience, never a requirement: a file opened from file://
 * may have no localStorage at all, or a full one, or one that throws on every
 * access. Every read and write here is guarded and fails quiet; the page keeps
 * working from memory without it.
 */
import { parseArtifactFile, type ArtifactFile } from './file-format';

export const NAME_KEY = 'afbin-offline-name';
const DRAFT_PREFIX = 'afbin-offline-draft:';

const store = (): Storage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function readName(): string | null {
  try { return store()?.getItem(NAME_KEY)?.trim() || null; } catch { return null; }
}

/** False when the name could not be kept (no storage): the page then remembers it for this session only. */
export function writeName(name: string): boolean {
  try { const s = store(); if (!s) return false; s.setItem(NAME_KEY, name); return true; } catch { return false; }
}

export const draftKey = (file: Pick<ArtifactFile, 'artifactId' | 'downloadedAt'>) => `${DRAFT_PREFIX}${file.artifactId}:${file.downloadedAt}`;

export interface Draft { savedAt: string; file: ArtifactFile }

/** Keeps the file's current state; past the quota (or with no storage) it skips silently. */
export function writeDraft(file: ArtifactFile, at = new Date()): void {
  try { store()?.setItem(draftKey(file), JSON.stringify({ savedAt: at.toISOString(), file } satisfies Draft)); } catch { /* quota or no storage: the draft is a convenience */ }
}

export function clearDraft(file: Pick<ArtifactFile, 'artifactId' | 'downloadedAt'>): void {
  try { store()?.removeItem(draftKey(file)); } catch { /* nothing to clear */ }
}

/** The newest moment the file itself records: a download, an edit, a comment, a reply or a status change. */
export function fileTime(file: ArtifactFile): number {
  const times = [file.downloadedAt, ...file.journal.map((e) => e.at),
    ...file.threads.flatMap((t) => [t.created_at, t.resolved_at ?? '', ...t.thread.map((c) => c.created_at)])];
  return Math.max(0, ...times.map((t) => Date.parse(t)).filter((n) => Number.isFinite(n)));
}

/**
 * A draft worth offering for THIS file: readable, for the same download, holding
 * something the file does not, and newer than anything the file records — so
 * reopening the copy that was just saved never asks.
 */
export function readDraft(file: ArtifactFile): Draft | null {
  let raw: string | null = null;
  try { raw = store()?.getItem(draftKey(file)) ?? null; } catch { return null; }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { savedAt?: unknown; file?: unknown };
    if (typeof value.savedAt !== 'string') return null;
    const draft = { savedAt: value.savedAt, file: parseArtifactFile(value.file) };
    if (draft.file.artifactId !== file.artifactId || draft.file.downloadedAt !== file.downloadedAt) return null;
    const same = JSON.stringify(draft.file) === JSON.stringify(file);
    return !same && Date.parse(draft.savedAt) > fileTime(file) ? draft : null;
  } catch {
    return null;
  }
}
