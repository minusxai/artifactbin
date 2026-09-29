/**
 * WHEN THE REACT APP LOADS ON THE HTML-FIRST READER PAGE (docs/phase2-architecture.md §2.2, §7.1).
 *
 * The compiled `/a/:id` page is finished HTML: the document, its islands and the server-rendered
 * reader chrome. The app (~275 KB) is the reader's SECOND screen, so it loads only when it is
 * wanted, and exactly once:
 *
 *   - a WRITER (owner or editor — the chrome carries an Edit control) boots it on idle
 *     (`requestIdleCallback`, else a timer) or on the first press or key anywhere, so pressing
 *     edit swaps in rather than downloads;
 *   - every other reader boots it only on INTENT: hovering, focusing or pressing an edit, comment
 *     or share control, or pressing/clicking any chrome control. An idle prefetch for every reader
 *     would put the whole app inside the page's network-idle window (size target 3).
 *
 * A click on a chrome control before the app has adopted the page is remembered
 * (`takeChromeIntent`) so the app performs it once its own chrome is up: the served chrome's
 * buttons carry no behaviour of their own.
 *
 * Framework-free and tiny: it is the whole of the entry the assembler tags `data-mx-spa-idle`
 * (web/spa-idle.ts).
 */
import { reportInitialArtifactView } from './artifact-view-report';

/** Who is reading, as far as the loader is concerned: writers prefetch on idle, readers wait for intent. */
export type SpaCapability = 'reader' | 'writer';

export interface SpaBootOptions {
  /** How long idle may take to arrive before the timer boots anyway (and the `requestIdleCallback` timeout). */
  idleMs: number;
  /** Default `writer`: idle plus any first press or key. `reader`: intent on the chrome only. */
  capability?: SpaCapability;
  win?: Window;
}

export interface SpaBoot {
  /** Boot now (a deep link that needs the app at once); a no-op after the first boot. */
  boot(): void;
  /** Stop listening and forget the idle wait, without booting. */
  cancel(): void;
}

/** The served chrome's controls (lib/story/reader-chrome): actions on the rail and the two panel triggers. */
const CHROME_CONTROL = '[data-mx-reader-action],[data-mx-reader-trigger]';
/** The controls whose reach alone is intent: what they open is the app's. */
const INTENT_CONTROL = '[data-mx-reader-action="edit"],[data-mx-reader-action="comment"],[data-mx-reader-action="share"]';

const controlOf = (target: EventTarget | null, selector: string): HTMLElement | null =>
  target && typeof (target as Element).closest === 'function' ? (target as Element).closest<HTMLElement>(selector) : null;

/** The chrome action a press or click named before the app was there to take it. */
// eslint-disable-next-line no-restricted-syntax -- one page, one pending ask: the entry records it and the app takes it once
let pendingIntent: string | null = null;

/** The chrome action the reader asked for before the app adopted the page, taken once. */
export function takeChromeIntent(): string | null {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}

export function scheduleSpaBoot(load: () => Promise<unknown>, options: SpaBootOptions): SpaBoot {
  const win = options.win ?? window;
  const doc = win.document;
  const writer = (options.capability ?? 'writer') === 'writer';
  let booted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idle: number | null = null;

  const stopWaiting = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const cancelIdle = (win as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
    if (idle !== null && typeof cancelIdle === 'function') cancelIdle.call(win, idle);
    idle = null;
    doc.removeEventListener('pointerdown', onPress, true);
    doc.removeEventListener('keydown', onPress, true);
    doc.removeEventListener('pointerover', onReach, true);
    doc.removeEventListener('focusin', onReach, true);
  };
  const boot = () => {
    if (booted) return;
    booted = true;
    stopWaiting();
    void load().catch((error: unknown) => console.error('[spa] the app did not load', error));
  };
  function onPress(event: Event) {
    if (writer || controlOf(event.target, CHROME_CONTROL)) boot();
  }
  function onReach(event: Event) {
    if (controlOf(event.target, INTENT_CONTROL)) boot();
  }
  /*
   * Kept until the app takes it: a second click while the app is still loading replaces the first.
   * Capture phase, and the served control's own (absent) behaviour is not run — the app performs it.
   * The listener outlives the boot on purpose (the app is still loading) and is inert once the
   * served chrome is gone.
   */
  const onClick = (event: Event) => {
    const control = controlOf(event.target, CHROME_CONTROL);
    // The SERVED chrome only (a body child): the app's own chrome performs its clicks itself.
    if (!control || control.closest('[data-mx-reader-chrome]')?.parentElement !== doc.body) return;
    const action = control.getAttribute('data-mx-reader-action') ?? control.getAttribute('data-mx-reader-trigger');
    if (!action) return;
    event.preventDefault();
    pendingIntent = action;
    boot();
  };

  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('keydown', onPress, true);
  doc.addEventListener('pointerover', onReach, true);
  doc.addEventListener('focusin', onReach, true);
  doc.addEventListener('click', onClick, true);
  if (writer) {
    const requestIdle = (win as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof requestIdle === 'function') idle = requestIdle.call(win, boot, { timeout: options.idleMs });
    else timer = setTimeout(boot, options.idleMs);
  }
  return {
    boot,
    cancel: () => { stopWaiting(); doc.removeEventListener('click', onClick, true); },
  };
}

/**
 * THE APP'S SAVED THEME, applied without an inline script (the compiled page has none): the same
 * rule as web/index.html's pre-paint stamp (lib/theme-bootstrap THEME_BOOTSTRAP_SCRIPT) — a stored
 * `mx_theme` wins; with none, the device's dark setting does; light carries no attribute. Nothing on
 * the compiled page reads `data-theme` before the app mounts, so stamping it in the first module the
 * page runs is as early as it needs to be.
 */
export function stampSavedTheme(win: Window = window): void {
  try {
    const saved = win.localStorage.getItem('mx_theme');
    if (saved === 'dark' || (!saved && win.matchMedia('(prefers-color-scheme: dark)').matches)) win.document.documentElement.dataset.theme = 'dark';
  } catch { /* storage or matchMedia unavailable: the default stands */ }
}

/** A deep link that asks for the app's own behaviour at once: edit mode, an open comment, a carried intent. */
const wantsAppNow = (location: Location): boolean =>
  location.hash === '#edit' || /[?&](?:comment|intent)=/.test(location.search);

/** Owner or editor: the served chrome offers Edit (lib/story/reader-chrome renders it only for a writer). */
export const capabilityOf = (doc: Document): SpaCapability =>
  doc.querySelector('[data-mx-reader-chrome] [data-mx-reader-action="edit"]') ? 'writer' : 'reader';

/**
 * What the app needs on a page it did not shell: `#root` (web/main renders into it on import) —
 * created HIDDEN while the compiled story is still the body's, so nothing the app draws before it
 * adopts the story (a loading skeleton) can push the document down; web/initial-story reveals it
 * as it adopts — and the app's own stylesheet, loaded before the app runs, because
 * components/TrustedUi reads the shell's stylesheet links from `<head>` when web/main is evaluated.
 */
async function prepareAppShell(doc: Document, stylesheet: string | null): Promise<void> {
  if (!doc.getElementById('root')) {
    const root = doc.createElement('div');
    root.id = 'root';
    if (doc.querySelector('body > [data-mx-inline-story]')) root.hidden = true;
    doc.body.prepend(root);
  }
  if (!stylesheet || Array.from(doc.head.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')).some((link) => link.getAttribute('href') === stylesheet)) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = stylesheet;
  // A sheet that fails still lets the app run: its chrome is unstyled rather than absent.
  await new Promise<void>((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    doc.head.append(link);
  });
}

export interface SpaIdleOptions {
  /** The app's entry (`() => import('./main')`). */
  load: () => Promise<unknown>;
  /** The app's stylesheet URL (web/shell.css, as built), or null when the page already links it. */
  stylesheet: string | null;
  idleMs?: number;
  win?: Window;
}

/**
 * THE HTML-FIRST PAGE'S LOADER (web/spa-idle): the reader's capability from the served chrome, the
 * app's saved theme at once, and the app itself when it is wanted — at once for a deep link that
 * needs it.
 */
export function startSpaIdle({ load, stylesheet, idleMs = 1500, win = window }: SpaIdleOptions): SpaBoot {
  const doc = win.document;
  stampSavedTheme(win);
  reportInitialArtifactView(win);
  const schedule = scheduleSpaBoot(() => prepareAppShell(doc, stylesheet).then(load), { idleMs, capability: capabilityOf(doc), win });
  if (wantsAppNow(win.location)) schedule.boot();
  return schedule;
}
