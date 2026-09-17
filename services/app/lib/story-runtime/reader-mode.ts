/**
 * The READER's mode override — the state behind the served document's
 * top-right toggle.
 *
 * A served document runs at an OPAQUE origin (sandboxed without
 * allow-same-origin, even top-level), so every storage API throws; the only
 * thing that survives a same-tab reload is `window.name`. One `mx:doc:`
 * envelope therefore carries BOTH per-visit facts — the reload anchor the
 * no-runtime live path needs and the reader's mode override — with merge-write
 * helpers so neither consumer can clobber the other. Per-visit is the ceiling,
 * not a choice: a returning reader starts at the author's default again.
 *
 * React-free on purpose: this ships in anchor-entry (~1.5 KB, loaded by every
 * document, hydrating or not) and is also imported by the runtime entry.
 */
import type { ScrollAnchor } from '@/lib/story/scroll-anchor';

const DOC_STATE_PREFIX = 'mx:doc:';
/** What pre-envelope documents wrote — still consumed so a reload from old code restores. */
const LEGACY_ANCHOR_PREFIX = 'mx:anchor:';

interface ReaderDocState {
  anchor?: ScrollAnchor | null;
  mode?: 'light' | 'dark' | null;
}

function readState(win: Window): ReaderDocState {
  const raw = win.name;
  if (!raw.startsWith(DOC_STATE_PREFIX)) return {};
  try {
    const parsed = JSON.parse(raw.slice(DOC_STATE_PREFIX.length)) as ReaderDocState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(win: Window, state: ReaderDocState): void {
  const clean: ReaderDocState = {
    ...(state.anchor ? { anchor: state.anchor } : {}),
    ...(state.mode === 'light' || state.mode === 'dark' ? { mode: state.mode } : {}),
  };
  win.name = Object.keys(clean).length ? DOC_STATE_PREFIX + JSON.stringify(clean) : '';
}

/** The reader's persisted override, if any. */
export function readerMode(win: Window): 'light' | 'dark' | null {
  const mode = readState(win).mode;
  return mode === 'light' || mode === 'dark' ? mode : null;
}

/** Persist (or clear, with null) the override — merge-write, never touching a pending anchor. */
export function persistReaderMode(win: Window, mode: 'light' | 'dark' | null): void {
  writeState(win, { ...readState(win), mode });
}

/** Park the reader's place for the reload the no-runtime live path is about to do. */
export function writeReloadAnchor(win: Window, anchor: ScrollAnchor): void {
  writeState(win, { ...readState(win), anchor });
}

/** The place a reload was asked to keep — consumed (one reload, one restore), mode preserved. */
export function takeReloadAnchor(win: Window): ScrollAnchor | null {
  if (win.name.startsWith(LEGACY_ANCHOR_PREFIX)) {
    const raw = win.name.slice(LEGACY_ANCHOR_PREFIX.length);
    win.name = '';
    try {
      const parsed = JSON.parse(raw) as ScrollAnchor;
      return typeof parsed?.path === 'string' && typeof parsed?.fraction === 'number' ? parsed : null;
    } catch {
      return null;
    }
  }
  const state = readState(win);
  const anchor = state.anchor ?? null;
  if (anchor !== null) writeState(win, { ...state, anchor: null });
  return anchor && typeof anchor.path === 'string' && typeof anchor.fraction === 'number' ? anchor : null;
}

/** Flip the mode classes on the document element (mirrors document-update's stamp). */
export function applyReaderMode(doc: Document, mode: 'light' | 'dark'): void {
  doc.documentElement.classList.toggle('dark', mode === 'dark');
  doc.documentElement.classList.toggle('light', mode !== 'dark');
}
