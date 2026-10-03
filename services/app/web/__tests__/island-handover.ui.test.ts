// DESTINATION: services/app/web/__tests__/island-handover.ui.test.ts
/**
 * THE SPA'S HANDOVER (docs/phase2-architecture.md §7; lib/islands/contract IslandDocument): the Solid app
 * boots on idle or first interaction, finds the live island document on the story root, adopts the
 * element WITHOUT re-rendering it (same nodes before and after), and disposes the islands only when
 * edit mode begins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleSpaBoot } from '../idle-boot';
import { adoptInitialStory, captureInitialStory, initialDocumentStory } from '../initial-story';
import { capabilityOf, startSpaIdle, stampSavedTheme, takeChromeIntent } from '../idle-boot';
import { clearInitialStory } from '../initial-story';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/serving/theme-bootstrap';
import { installIslandDocument, islandDocumentOf } from '@/lib/islands/handover';
import { reportInitialArtifactView, initialViewWasReported } from '../artifact-view-report';
import type { IslandDocument } from '@/lib/islands/contract';

const fakeDocument = (root: HTMLElement): IslandDocument & { disposed: number; modes: string[] } => {
  const listeners = new Set<(e: unknown) => void>();
  let mode: 'read' | 'edit' = 'read';
  const doc = {
    root, store: null, context: null as never, disposed: 0, modes: [] as string[],
    mode: () => mode, setMode(next: 'read' | 'edit') { mode = next; doc.modes.push(next); if (next === 'edit') doc.disposed++; for (const l of listeners) l({ type: 'mode', mode: next }); },
    ready: () => true, subscribe(l: (e: unknown) => void) { listeners.add(l); return () => listeners.delete(l); }, dispose() { doc.disposed++; },
  };
  return doc as never;
};

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('scheduleSpaBoot', () => {
  it('boots once on idle, or at once on the first interaction, never twice', () => {
    const load = vi.fn(async () => {});
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = undefined;
    scheduleSpaBoot(load, { idleMs: 2000 });
    expect(load).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    document.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('boots on the idle timer when nobody interacts', () => {
    const load = vi.fn(async () => {});
    scheduleSpaBoot(load, { idleMs: 2000 });
    vi.advanceTimersByTime(2001);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('compiled first view', () => {
  it('reports the visible document before the app loads and marks it for React deduplication', () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState(null, '', '/a/first');
    reportInitialArtifactView(window);
    expect(fetcher).toHaveBeenCalledWith('/api/page/artifact/first/view', expect.objectContaining({ method: 'POST' }));
    expect(initialViewWasReported(document, 'first')).toBe(true);
    expect(initialViewWasReported(document, 'second')).toBe(false);
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });
});

describe('adopting the island document', () => {
  it('finds the document on the story root and adopts the same element with its children intact', () => {
    document.body.innerHTML = '<div id="root"></div><div id="mx-story-root" data-mx-inline-story=""><h1 id="h">Title</h1><div data-hk="s0-0" id="i">island</div></div>';
    const root = document.getElementById('mx-story-root') as HTMLElement;
    const island = root.querySelector('#i');
    const doc = fakeDocument(root);
    installIslandDocument(root, doc);
    expect(islandDocumentOf(root)).toBe(doc);
    captureInitialStory();
    expect(initialDocumentStory()).toBe(root);
    const adopted = adoptInitialStory();
    expect(adopted).toBe(root);
    expect(adopted!.querySelector('#i')).toBe(island);
    expect(islandDocumentOf(adopted!)).toBe(doc);
    expect(doc.disposed).toBe(0);
  });
  it('edit mode disposes the islands exactly once; reading again is not re-entered in place', () => {
    document.body.innerHTML = '<div id="mx-story-root" data-mx-inline-story=""><div data-hk="s0-0" id="i">island</div></div>';
    const root = document.getElementById('mx-story-root') as HTMLElement;
    const doc = fakeDocument(root);
    installIslandDocument(root, doc);
    islandDocumentOf(root)!.setMode('edit');
    expect(doc.disposed).toBe(1);
    expect(root.querySelector('#i')?.textContent).toBe('island');
  });
});

/*
 * ORCHESTRATOR AMENDMENT (w3-handover): readers who can't edit load the app ONLY ON INTENT; writers
 * also boot it on idle. Size target 3 measures to network idle, so an idle prefetch for every
 * reader would fail it by construction.
 */
const servedChrome = (writer: boolean) =>
  '<div id="mx-story-root" data-mx-inline-story=""><p id="p">text</p></div>'
  + '<div class="mx-reader-chrome" data-mx-reader-chrome=""><div data-mx-reader-rail="">'
  + '<button type="button" data-mx-reader-action="like" aria-label="Like">like</button>'
  + '<button type="button" data-mx-reader-action="comment" aria-label="Comment">comment</button>'
  + (writer ? '<button type="button" data-mx-reader-action="edit" aria-label="Edit">edit</button>' : '')
  + '<button type="button" data-mx-reader-trigger="controls" aria-label="Open artifact controls">settings</button>'
  + '</div></div>';

describe('an anonymous reader loads the app only on intent', () => {
  beforeEach(() => { (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = undefined; takeChromeIntent(); });

  it('loads no app chunk after idle, nor on a press in the document itself', () => {
    document.body.innerHTML = servedChrome(false);
    const load = vi.fn(async () => {});
    const boot = startSpaIdle({ load, stylesheet: null, idleMs: 1000 });
    vi.advanceTimersByTime(60_000);
    document.getElementById('p')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.getElementById('p')!.dispatchEvent(new Event('keydown', { bubbles: true }));
    document.querySelector('[aria-label="Like"]')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(load).not.toHaveBeenCalled();
    expect(document.getElementById('root')).toBeNull();
    boot.cancel();
  });

  it.each(['pointerover', 'focusin', 'pointerdown'])('reaching for a comment control (%s) loads it, once', async (type) => {
    document.body.innerHTML = servedChrome(false);
    const load = vi.fn(async () => {});
    const boot = startSpaIdle({ load, stylesheet: null, idleMs: 1000 });
    const comment = document.querySelector('[aria-label="Comment"]')!;
    comment.dispatchEvent(new Event(type, { bubbles: true }));
    comment.dispatchEvent(new Event(type, { bubbles: true }));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // The app gets a root to render into, hidden until it adopts the served story.
    expect(document.body.firstElementChild?.id).toBe('root');
    expect((document.getElementById('root') as HTMLElement).hidden).toBe(true);
    boot.cancel();
  });

  it('a click on any served chrome control loads it and is remembered for the app to perform', async () => {
    document.body.innerHTML = servedChrome(false);
    const load = vi.fn(async () => {});
    const boot = startSpaIdle({ load, stylesheet: null, idleMs: 1000 });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('[data-mx-reader-trigger="controls"]')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(takeChromeIntent()).toBe('controls');
    expect(takeChromeIntent()).toBeNull();
    boot.cancel();
  });

  it('a deep link that needs the app (#edit, ?comment=) loads it at once', async () => {
    document.body.innerHTML = servedChrome(false);
    window.history.replaceState(null, '', '/a/doc1?comment=t1');
    const load = vi.fn(async () => {});
    const boot = startSpaIdle({ load, stylesheet: null, idleMs: 1000 });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    window.history.replaceState(null, '', '/');
    boot.cancel();
  });

  it('a document waiting on the reader\'s consent to its extra hosts loads it at once; an answered one does not', async () => {
    const pageData = (cspRequest: unknown) => `<script type="application/json" id="mx-page-data">${JSON.stringify({ path: '/a/doc1', artifact: { cspRequest } })}</script>`;
    const hosts = { connect: ['https://api.open-meteo.com'], script: [], style: [], img: [], frame: [], media: [] };
    const ask = { extensions: hosts, asking: hosts, status: 'blocked', denied: false };
    document.body.innerHTML = servedChrome(false) + pageData(ask);
    const load = vi.fn(async () => {});
    const boot = startSpaIdle({ load, stylesheet: null, idleMs: 1000 });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    boot.cancel();

    for (const answered of [{ ...ask, denied: true }, { ...ask, status: 'allowed' }, { ...ask, status: 'publisher' }]) {
      document.body.innerHTML = servedChrome(false) + pageData(answered);
      const idle = vi.fn(async () => {});
      const waiting = startSpaIdle({ load: idle, stylesheet: null, idleMs: 1000 });
      vi.advanceTimersByTime(60_000);
      expect(idle).not.toHaveBeenCalled();
      waiting.cancel();
    }
  });
});

describe('a writer boots the app on idle', () => {
  it('the served chrome offers Edit: the app loads when the page is idle, through requestIdleCallback when present', async () => {
    document.body.innerHTML = servedChrome(true);
    expect(capabilityOf(document)).toBe('writer');
    let idle: (() => void) | null = null;
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void, options: { timeout: number }) => { idle = cb; expect(options.timeout).toBe(1000); return 1; };
    const load = vi.fn(async () => {});
    startSpaIdle({ load, stylesheet: null, idleMs: 1000 });
    expect(load).not.toHaveBeenCalled();
    idle!();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = undefined;
  });
  it('the app stylesheet is linked and loaded before the app runs', async () => {
    document.body.innerHTML = servedChrome(true);
    document.head.innerHTML = '';
    const load = vi.fn(async () => { expect(document.head.querySelector('link[rel="stylesheet"][href="/assets/shell-x.css"]')).not.toBeNull(); });
    const boot = startSpaIdle({ load, stylesheet: '/assets/shell-x.css', idleMs: 1000 });
    boot.boot();
    const link = await vi.waitFor(() => document.head.querySelector<HTMLLinkElement>('link[href="/assets/shell-x.css"]')!);
    expect(load).not.toHaveBeenCalled();
    link.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });
});

describe('the saved theme applies without an inline script', () => {
  const cases: Array<[string | null, boolean]> = [['dark', false], ['light', true], [null, true], [null, false]];
  it.each(cases)('stored %s, device dark %s: the same stamp as web/solid-app.html\'s script', (stored, deviceDark) => {
    const stamp = (run: () => void) => {
      delete document.documentElement.dataset.theme;
      localStorage.clear();
      if (stored) localStorage.setItem('mx_theme', stored);
      window.matchMedia = ((query: string) => ({ matches: deviceDark && query.includes('dark') })) as never;
      run();
      return document.documentElement.dataset.theme ?? null;
    };
    // eslint-disable-next-line no-new-func -- the reference: the very bytes the shell runs before paint
    const reference = stamp(() => new Function(THEME_BOOTSTRAP_SCRIPT)());
    expect(stamp(() => stampSavedTheme(window))).toBe(reference);
  });
});

describe('leaving a compiled page before the app adopts it', () => {
  it('disposes the islands, removes the served story and chrome, and reveals the app root', () => {
    document.body.innerHTML = '<div id="root" hidden></div>' + servedChrome(false);
    // The head sheets a served document arrives with (lib/compiled-page/assembler.ts): left behind,
    // `data-mx-story-css` collides with the app shell's own Tailwind utility classes on every route
    // rendered after it (the app bar's mobile/desktop Star toggle, concretely).
    document.head.insertAdjacentHTML('beforeend', '<style data-mx-chrome>.mx-reader-chrome{}</style><style data-mx-app-reserve>body{}</style><style data-mx-story-css>.hidden{display:none}</style><style data-mx-footer-css>.footer{}</style>');
    const root = document.getElementById('mx-story-root') as HTMLElement;
    const doc = fakeDocument(root);
    installIslandDocument(root, doc);
    captureInitialStory();
    clearInitialStory();
    expect(doc.disposed).toBe(1);
    expect(root.isConnected).toBe(false);
    expect(document.querySelector('[data-mx-reader-chrome]')).toBeNull();
    expect((document.getElementById('root') as HTMLElement).hidden).toBe(false);
    for (const attr of ['data-mx-chrome', 'data-mx-app-reserve', 'data-mx-story-css', 'data-mx-footer-css']) {
      expect(document.head.querySelector(`style[${attr}]`), attr).toBeNull();
    }
  });
});
