/**
 * WHAT IS FOLDED — the one place that knows it, for both reasons a comment folds.
 *
 * A long agent reply pushes the human's own short reply off the rail. Two
 * different things answer that, and they are both "folding", so they live
 * together rather than as a store beside a measurement:
 *
 *   · MEMORY — what this viewer folded by hand (a comment, a whole thread),
 *     kept in `localStorage('mx_comments_folded')` keyed by artifact. It is a
 *     fact about how somebody is reading right now, so — like the theme and
 *     `mx_comments_hidden` — it is never in the URL, never in a request body
 *     and never on the row: a shared link must not carry someone else's folds.
 *   · MEASURE — whether a body is longer than the ten lines the rail spends on
 *     it, decided from what the browser actually laid out (`scrollHeight`
 *     against the computed line height), never from a character count. F5
 *     markdown, a phone width and a fenced block all make the same character
 *     count a different number of lines.
 *
 * Everything here tolerates having no storage at all: a private window, a
 * blocked store (Safari private mode THROWS on the accessor rather than
 * answering null) or a garbled value all read as "nothing folded", because a
 * rail that cannot remember must still render.
 */

export type FoldKind = 'threads' | 'comments';

/** What this viewer folded by hand, for one artifact. */
export interface Folds {
  threads: string[];
  comments: string[];
}

/** The rail spends ten lines on a comment before it offers to fold it. */
export const FOLD_LINES = 10;

export const FOLD_STORAGE_KEY = 'mx_comments_folded';

export const NO_FOLDS: Folds = { threads: [], comments: [] };

/**
 * The store, if there is one. Reading the property itself can THROW (a private
 * window with site data blocked), so even reaching for it is guarded — a
 * `typeof` check alone would not survive that.
 */
function store(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    return candidate && typeof candidate.getItem === 'function' ? candidate : null;
  } catch {
    return null;
  }
}

const ids = (value: unknown): string[] | null => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : null
);

/** One artifact's entry, or null when it is absent or not the shape we wrote. */
function entryOf(raw: unknown, artifactId: string): Folds | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = (raw as Record<string, unknown>)[artifactId];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const { threads, comments } = entry as { threads?: unknown; comments?: unknown };
  const foldedThreads = ids(threads);
  const foldedComments = ids(comments);
  // A half-shaped entry is somebody else's data, not ours: read it as empty
  // rather than half-believe it.
  if (!foldedThreads || !foldedComments) return null;
  return { threads: foldedThreads, comments: foldedComments };
}

function readAll(): Record<string, unknown> {
  const storage = store();
  if (!storage) return {};
  try {
    const raw = storage.getItem(FOLD_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Write one artifact's entry back, leaving every other artifact's alone. */
function write(artifactId: string, folds: Folds): Folds {
  const storage = store();
  if (!storage) return folds;
  try {
    storage.setItem(FOLD_STORAGE_KEY, JSON.stringify({ ...readAll(), [artifactId]: folds }));
  } catch {
    // A full or blocked store loses the memory, never the rail.
  }
  return folds;
}

/** What this viewer folded on one artifact; empty when there is no usable store. */
export function readFolds(artifactId: string): Folds {
  return entryOf(readAll(), artifactId) ?? { ...NO_FOLDS };
}

/** Fold what is unfolded and unfold what is folded, answering the new state. */
export function toggleFold(artifactId: string, kind: FoldKind, id: string): Folds {
  const current = readFolds(artifactId);
  const next: Folds = {
    ...current,
    [kind]: current[kind].includes(id) ? current[kind].filter((entry) => entry !== id) : [...current[kind], id],
  };
  return write(artifactId, next);
}

/**
 * Open the given ids, whatever they were. Opening a thread by pin, message or
 * intent must show the answer somebody came for, so the thread AND its newest
 * comment are unfolded in ONE write rather than two.
 */
export function unfold(artifactId: string, opening: Partial<Record<FoldKind, string[]>>): Folds {
  const current = readFolds(artifactId);
  const next: Folds = {
    threads: current.threads.filter((entry) => !opening.threads?.includes(entry)),
    comments: current.comments.filter((entry) => !opening.comments?.includes(entry)),
  };
  const unchanged = next.threads.length === current.threads.length
    && next.comments.length === current.comments.length;
  return unchanged ? current : write(artifactId, next);
}

export function isFolded(folds: Folds, kind: FoldKind, id: string): boolean {
  return folds[kind].includes(id);
}

/**
 * The auto-fold verdict for one laid-out body. `lines` is what the control
 * offers to show ("show more (N lines)"), and `maxHeight` is the clamp — an
 * exact pixel number, because the WRAPPER is clamped and the measured child
 * never is: clamping the element you measure makes its own scrollHeight agree
 * with the clamp on the next render, and the fold un-decides itself.
 */
export function foldFromMeasure(scrollHeight: number, lineHeight: number): {
  overflowing: boolean;
  lines: number;
  maxHeight: number;
} {
  const usable = Number.isFinite(scrollHeight) && scrollHeight > 0
    && Number.isFinite(lineHeight) && lineHeight > 0;
  const maxHeight = usable ? FOLD_LINES * lineHeight : 0;
  return {
    // A whole line past the clamp, so the browser's own sub-pixel rounding
    // never offers to unfold a body that is already whole.
    overflowing: usable && scrollHeight - maxHeight >= 1,
    lines: usable ? Math.round(scrollHeight / lineHeight) : 0,
    maxHeight,
  };
}
