/**
 * THE READER CHROME'S BEHAVIOUR, in the every-document entry (anchor-entry) —
 * react-free and small, because a document of pure prose ships nothing else
 * and still has a reader in it.
 *
 * One owner for everything the chrome does, wired once per document on the
 * TOP-LEVEL path only (a framed copy hides the chrome and relays its scroll
 * samples to the parent instead — that stays in anchor-entry):
 *
 *  - VISIBILITY: sample `scroll` and `resize` through one animation frame and
 *    run lib/story-runtime/reader-chrome-policy; write the answer as the
 *    `mx-reader-chrome--hidden` class and `data-mx-reader-state`. Never move
 *    while a panel is open; opening a panel reveals the chrome.
 *  - PANELS: the two triggers, the scrim, Escape, and the light/dark choice
 *    (lib/story-runtime/reader-mode + the runtime's private mode hook) — moved
 *    here from anchor-entry, unchanged in behaviour.
 *  - LIKE / COMMENT: `console.log('[artifactbin] like', { artifact })` (and
 *    `comment`). UI only; a colleague wires the backend.
 *  - SHARE: `navigator.share({ title, url })` when the platform has a sheet;
 *    else `navigator.clipboard.writeText(url)`; else select the hidden copy
 *    field and `document.execCommand('copy')`. Then the toast, ~1.5s. `url` is
 *    `location.href` — the reader's document is top-level, so it is real.
 *  - LOGO: a plain link home (`href="/"`); nothing to wire.
 */

import { READER_CHROME_HIDDEN_CLASS, type ReaderChromeState } from '@/lib/story/reader-chrome';
import { STORY_MODE_HOOK } from './contract';
import { applyReaderMode, persistReaderMode } from './reader-mode';
import { chromeAfterSample, type ChromeState } from './reader-chrome-policy';

/** How long "link copied" stays up. Long enough to read, short enough to forget. */
const TOAST_MS = 1500;

export interface ReaderChromeHandle {
  /** Remove every listener this wiring installed. */
  destroy(): void;
}

/**
 * Wire the chrome found in `doc` (rendered by lib/story/reader-chrome).
 * Returns null when the document carries no chrome (a capture, a framed copy
 * with it hidden — nothing to do).
 */
/**
 * THE READER'S APPEARANCE CHOICE, applied — one owner for a decision that
 * arrives two ways. Top-level it is a click in the settings panel; FRAMED it
 * is the trusted parent saying so over the reader-mode message, and the framed
 * document has no chrome to click. Both change only local reading state and
 * re-ink the hydrated charts through the runtime's private hook.
 */
export function applyReaderChoice(win: Window, doc: Document, mode: 'light' | 'dark'): void {
  applyReaderMode(doc, mode);
  persistReaderMode(win, mode);
  for (const choice of Array.from(doc.querySelectorAll<HTMLElement>('[data-mx-mode-choice]'))) {
    choice.setAttribute('aria-pressed', String(choice.dataset.mxModeChoice === mode));
  }
  const hook = (win as unknown as Record<string, unknown>)[STORY_MODE_HOOK] as
    | ((mode: 'light' | 'dark') => void)
    | undefined;
  hook?.(mode);
}

/**
 * Wire the chrome found in `doc` (rendered by lib/story/reader-chrome).
 * Returns null when the document carries no chrome (a capture, a framed copy
 * with it hidden — nothing to do).
 */
export function wireReaderChrome(win: Window, doc: Document): ReaderChromeHandle | null {
  const root = doc.querySelector<HTMLElement>('[data-mx-reader-chrome]');
  if (!root) return null;

  const cleanups: Array<() => void> = [];
  const on = <T extends EventTarget>(target: T, type: string, handler: EventListener, options?: AddEventListenerOptions) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  const triggers = Array.from(root.querySelectorAll<HTMLElement>('[data-mx-reader-trigger]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-mx-reader-panel]'));
  const scrim = root.querySelector<HTMLElement>('[data-mx-reader-scrim]');
  const artifact = root.getAttribute('data-mx-artifact-id');

  /* ---- VISIBILITY ---------------------------------------------------- */

  let state: ChromeState | null = null;
  let queued = false;

  const paint = (visible: boolean) => {
    root.classList.toggle(READER_CHROME_HIDDEN_CLASS, !visible);
    root.setAttribute('data-mx-reader-state', (visible ? 'shown' : 'hidden') satisfies ReaderChromeState);
  };
  const panelOpen = () => triggers.some((t) => t.getAttribute('aria-expanded') === 'true');
  const sample = () => {
    queued = false;
    // An open panel FREEZES the chrome: the reader is inside a control, and a
    // scroll behind it must not take the control away.
    if (panelOpen()) return;
    state = chromeAfterSample(state, {
      scrollY: Math.max(0, win.scrollY),
      viewportHeight: win.innerHeight,
      documentHeight: doc.documentElement.scrollHeight,
    });
    paint(state.visible);
  };
  // One animation frame however noisy touch-scroll events become.
  const schedule = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(sample);
  };
  const reveal = () => {
    state = state ? { ...state, visible: true } : { visible: true, lastScrollY: Math.max(0, win.scrollY) };
    paint(true);
  };

  on(win, 'scroll', schedule, { passive: true });
  on(win, 'resize', schedule);

  /* ---- PANELS -------------------------------------------------------- */

  const closePanels = () => {
    for (const trigger of triggers) {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', trigger.dataset.mxReaderTrigger === 'menu' ? 'Open menu' : 'Open artifact controls');
    }
    for (const panel of panels) panel.hidden = true;
    if (scrim) scrim.hidden = true;
  };
  for (const trigger of triggers) {
    on(trigger, 'click', () => {
      // Asking for a control is a gesture too: it reveals the chrome the same
      // way a scroll up does, whichever direction the reader was going.
      reveal();
      const name = trigger.dataset.mxReaderTrigger;
      const opening = trigger.getAttribute('aria-expanded') !== 'true';
      closePanels();
      if (!opening) return;
      const panel = panels.find((candidate) => candidate.dataset.mxReaderPanel === name);
      if (!panel) return;
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('aria-label', name === 'menu' ? 'Close menu' : 'Close artifact controls');
      panel.hidden = false;
      if (scrim) scrim.hidden = false;
    });
  }
  if (scrim) on(scrim, 'click', closePanels);
  on(doc, 'keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') closePanels();
  });

  /* ---- APPEARANCE ---------------------------------------------------- */

  const choices = Array.from(root.querySelectorAll<HTMLElement>('[data-mx-mode-choice]'));
  const current = doc.documentElement.classList.contains('dark') ? 'dark' : 'light';
  for (const choice of choices) {
    choice.setAttribute('aria-pressed', String(choice.dataset.mxModeChoice === current));
    on(choice, 'click', () => {
      const next = choice.dataset.mxModeChoice;
      if (next === 'light' || next === 'dark') applyReaderChoice(win, doc, next);
    });
  }

  /* ---- THE RAIL ------------------------------------------------------ */

  const toast = root.querySelector<HTMLElement>('[data-mx-reader-toast]');
  let toastTimer = 0;
  const say = () => {
    if (!toast) return;
    toast.hidden = false;
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => { toast.hidden = true; }, TOAST_MS);
  };
  cleanups.push(() => win.clearTimeout(toastTimer));

  /*
   * The last resort, for a browser with neither a share sheet nor a clipboard
   * permission: a hidden readonly field the document selects and copies out of.
   * It is in the markup rather than created here because an element appended
   * during a click handler is not always focusable in time.
   */
  const copyField = root.querySelector<HTMLInputElement>('[data-mx-reader-copy]');
  const copyByExecCommand = (url: string): boolean => {
    if (!copyField || typeof doc.execCommand !== 'function') return false;
    copyField.value = url;
    copyField.select();
    try {
      return doc.execCommand('copy');
    } catch {
      return false;
    }
  };

  const shareTitle = () => {
    const titled = root.querySelector<HTMLElement>('.mx-reader-title');
    return (titled?.textContent ?? '').trim() || doc.title;
  };
  const share = () => {
    // The reader's document is served TOP-LEVEL, so its location is the real,
    // shareable address — not a frame's internal one.
    const url = win.location.href;
    const nav = win.navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      // A dismissed sheet rejects; that is the reader saying no, not a failure.
      void nav.share({ title: shareTitle(), url }).catch(() => {});
      return;
    }
    const clipboard = nav.clipboard as Clipboard | undefined;
    if (clipboard && typeof clipboard.writeText === 'function') {
      void clipboard.writeText(url).then(say, () => { if (copyByExecCommand(url)) say(); });
      return;
    }
    if (copyByExecCommand(url)) say();
  };

  for (const button of Array.from(root.querySelectorAll<HTMLElement>('[data-mx-reader-action]'))) {
    const kind = button.dataset.mxReaderAction;
    on(button, 'click', () => {
      if (kind === 'share') { share(); return; }
      // Like and comment are UI ONLY: the backend is somebody else's phase, and
      // a button that pretends to have saved something is worse than one that
      // says plainly where it got to.
      if (kind === 'like' || kind === 'comment') console.log(`[artifactbin] ${kind}`, { artifact });
      if (kind === 'follow') console.log('[artifactbin] follow', { artifact, author: button.dataset.mxAuthor ?? null });
    });
  }


  /*
   * A CLICK ON THE CHROME IS THE CHROME'S. It floats over the document, and
   * everything under it that listens for clicks on the document — the annotate
   * layer focusing a thread, the selection surface dismissing itself — would
   * otherwise answer a press on a button that is not theirs. One listener at
   * the root, after every control's own handler has run in the bubble.
   */
  on(root, 'click', (event) => event.stopPropagation());

  // The first answer, now: the chrome is server-rendered hidden, and a
  // document that cannot scroll has to correct that before the reader looks.
  sample();

  return {
    destroy() {
      for (const undo of cleanups.splice(0)) undo();
    },
  };
}
