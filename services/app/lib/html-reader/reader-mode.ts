/**
 * The READER's light/dark pick, made anywhere in the app.
 *
 * The pick lives on the app origin (`mx_theme`, {@link chooseTheme}): the app's server reads it and tells a framed
 * document in its first URL ({@link READER_MODE_PARAM}, lib/document-serving/artifact-page), so the document is
 * served in that mode from its first byte.
 *
 * Framework-free on purpose: the app shell and the document page import it before anything else loads.
 */
import { THEME_KEY } from './contract';

type Mode = 'light' | 'dark';
const asMode = (value: unknown): Mode | null => (value === 'light' || value === 'dark' ? value : null);

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
