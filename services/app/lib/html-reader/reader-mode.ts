/**
 * The READER's mode override — the state behind the served document's
 * top-right toggle.
 *
 * A served document runs at an OPAQUE origin (sandboxed without
 * allow-same-origin, even top-level), so every storage API throws; the only
 * thing that survives a same-tab reload is `window.name`. One `mx:doc:`
 * envelope carries the reload anchor the no-runtime live path parks there
 * (nothing reads it back since the reload restore, web/restore-reader, went).
 *
 * ACROSS VISITS the reader's pick lives on the app origin (`mx_theme`, {@link chooseTheme}): the app's server
 * reads it and tells a framed document in its first URL ({@link READER_MODE_PARAM}, lib/document-serving/artifact-page),
 * so the document is served in that mode from its first byte. That URL is the visit's starting mode; a pick made
 * during the visit (the envelope) wins over it and rewrites it, so a reload of the frame is drawn in the new one.
 *
 * Framework-free on purpose: this ships in anchor-entry (~1.5 KB, loaded by every
 * document, hydrating or not) and is also imported by the runtime entry.
 */
import type { ScrollAnchor } from '@/lib/html-reader/scroll-anchor';
import { THEME_KEY } from './contract';

const DOC_STATE_PREFIX = 'mx:doc:';

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

type Mode = 'light' | 'dark';
const asMode = (value: unknown): Mode | null => (value === 'light' || value === 'dark' ? value : null);

/** Park the reader's place for the reload the no-runtime live path is about to do. */
export function writeReloadAnchor(win: Window, anchor: ScrollAnchor): void {
  writeState(win, { ...readState(win), anchor });
}

/**
 * THE READER'S ONE LIGHT/DARK PICK, made anywhere in the app: `data-theme` on the document element, `mx_theme` in
 * storage (the key lib/page-styles/theme-bootstrap's pre-paint stamp reads) and in a cookie of the same name, which the
 * app's server reads to serve every document this reader opens in the pick (lib/document-serving/artifact-page). Storage throws
 * in private mode and at a served document's opaque origin; the stamp still lands.
 */
export function chooseTheme(mode: Mode, doc: Document = document): void {
  if (mode === 'dark') doc.documentElement.dataset.theme = 'dark';
  else delete doc.documentElement.dataset.theme;
  try { doc.defaultView?.localStorage.setItem(THEME_KEY, mode); } catch { /* private mode */ }
  try { doc.cookie = `${THEME_KEY}=${mode}; path=/; max-age=31536000; samesite=lax`; } catch { /* no cookies here */ }
}

/** The reader's explicit pick, or null when they never made one (the device's setting is not a pick). */
export function storedTheme(win: Window = window): Mode | null {
  try { return asMode(win.localStorage.getItem(THEME_KEY)); } catch { return null; }
}
