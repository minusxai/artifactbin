/**
 * A shared artifact link opens on the DOCUMENT — every owner affordance
 * (the story viewer's bar with theme/edit, the surface's edit button, the
 * dataset ref copy) exists only for the owner. The signal is the one
 * ArtifactShell provides; readers get chrome-free pages, including
 * not-logged-in readers holding a token that owns other artifacts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/*
 * The layer renders nothing here — this file is about the PAGE's chrome and
 * the page's half of the contract. It records the props it was handed, which
 * is exactly what the page is responsible for.
 */
const layerProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/AnnotationLayer', () => ({
  default: (props: Record<string, unknown>) => { layerProps.push(props); return null; },
}));
vi.mock('@/components/ArtifactEditor', () => ({
  default: (props: { onExit: () => void; onToggleComments?: () => void }) => (
    <header aria-label="Editor toolbar">
      <input aria-label="Title" />
      {props.onToggleComments && <button aria-label="Toggle comments" onClick={props.onToggleComments}><span className="lucide-message-square" /></button>}
      <button aria-label="Exit edit mode" className="text-accent" onClick={props.onExit}><span className="lucide-check" />done</button>
    </header>
  ),
}));

import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import {
  STORY_PAINTED_MESSAGE, STORY_READER_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SESSION_MESSAGE,
} from '@/lib/story-runtime/contract';

class FakeEventSource {
  /** The named `data` channel (a dataset under the document changed). */
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  emitData(payload: unknown) { for (const fn of this.listeners.data ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent); }
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  // The shell never fetches — ownership arrives as a prop; anything else is a bug.
  vi.stubGlobal('fetch', (async () => {
    throw new Error('unexpected fetch');
  }) as unknown as typeof fetch);
});

afterEach(() => {
  window.location.hash = '';
  vi.unstubAllGlobals();
});

const surfaceProps = (over: Partial<ArtifactSurfaceProps>): ArtifactSurfaceProps => ({
  id: 'story1',
  editId: 'edit_1',
  format: 'markup',
  title: 'doc',
  source: null,
  template: null,
  refs: [],
  version: 1,
  content: '<p>hi</p>',
  columns: [],
  compiledCss: null,
  theme: null,
  colorMode: null,
  ...over,
});

/**
 * The page draws no controls button of its own on a markup document: the
 * framed document's chrome carries it and ASKS the page (mx:reader-action),
 * the way a stranger's copy would if it held a session. So "open the
 * controls" is that message, from the frame's own window.
 */
const openDocumentControls = () => {
  // A dataset or image page has no frame: its bar carries the button itself.
  const button = screen.queryByLabelText('Open artifact controls');
  if (button) { fireEvent.click(button); return; }
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="artifact"]');
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: STORY_READER_ACTION_MESSAGE, kind: 'controls' },
      source: frame?.contentWindow as unknown as MessageEventSource,
    }));
  });
};

describe('the surface header buttons are owner chrome', () => {
  it('a reader gets the document without edit or share buttons', () => {
    render(<ArtifactSurface {...surfaceProps({})} />);
    expect(screen.queryByLabelText('Edit artifact')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Share')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Copy agent instructions')).not.toBeInTheDocument();
    // …and no `raw` link: /raw is the frame's source now, not a destination.
    expect(screen.queryByLabelText('Open the raw artifact')).not.toBeInTheDocument();
  });

  it('the owner keeps edit and share (via the shell signal)', () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    openDocumentControls();
    expect(screen.getByLabelText('Edit artifact')).toBeInTheDocument();
    expect(screen.getByLabelText('Edit artifact').querySelector('.lucide-pencil')).toBeTruthy();
    expect(screen.getByLabelText('Toggle comments').querySelector('.lucide-message-square')).toBeTruthy();
    expect(screen.getByLabelText('Share')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy agent instructions')).toBeInTheDocument();
  });

  it('offers social-preview framing to markup owners and editors, but not commenters or viewers', () => {
    for (const role of ['owner', 'editor'] as const) {
      render(<ArtifactShell role={role}><ArtifactSurface {...surfaceProps({ source: '<p>hi</p>' })} /></ArtifactShell>);
      openDocumentControls();
      expect(screen.getByLabelText('Edit social preview'), role).toBeInTheDocument();
      cleanup();
    }
    for (const role of ['commenter', 'viewer'] as const) {
      render(<ArtifactShell role={role}><ArtifactSurface {...surfaceProps({ source: '<p>hi</p>' })} /></ArtifactShell>);
      openDocumentControls();
      expect(screen.queryByLabelText('Edit social preview'), role).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('edit mode KEEPS the comments control, marks the titles, and turns edit into the exit', async () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );

    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Edit artifact'));

    // The whole point: commenting is a layer, so it survives entering a mode.
    await waitFor(() => expect(screen.getByLabelText('Toggle comments')).toBeInTheDocument());
    expect(screen.queryByLabelText('Edit artifact')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Exit edit mode')).toHaveClass('text-accent');
    expect(screen.getByLabelText('Exit edit mode').querySelector('.lucide-check')).toBeTruthy();
    expect(screen.getByLabelText('Exit edit mode')).toHaveTextContent('done');
    expect(screen.getByLabelText('Editor toolbar')).toContainElement(screen.getByLabelText('Title'));
    // In edit mode too, the page draws no bar of its own: the document's own
    // chrome stays, pinned at the top, and asks the page for the panels.
    expect(screen.queryByLabelText('Open menu')).toBeNull();
    expect(screen.queryByLabelText('Open artifact controls')).toBeNull();
    expect(document.title).toBe('doc [edit mode]');

    fireEvent.click(screen.getByLabelText('Exit edit mode'));
    // Out of edit mode the page draws no trigger of its own: the framed
    // document's chrome carries settings and profile and asks the page.
    await waitFor(() => expect(screen.queryByLabelText('Open menu')).toBeNull());
    expect(screen.queryByLabelText('Open artifact controls')).toBeNull();
    openDocumentControls();
    expect(screen.getByLabelText('Edit artifact')).toBeInTheDocument();
    expect(screen.getByLabelText('Edit artifact').querySelector('.lucide-pencil')).toBeTruthy();
  });

  it('the comments control opens the rail without becoming a mode', () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({ openAnnotations: 1 })} />
      </ArtifactShell>,
    );

    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Toggle comments'));

    // A panel, not a mode: edit stays offered, the hash is untouched, and the
    // title says nothing — there is no second mode for it to announce.
    expect(window.location.hash).toBe('');
    expect(document.title).toBe('doc');
    // Opening the rail narrows the document so comments never cover it.
    expect(screen.getByLabelText('Artifact viewport').style.right).not.toBe('0px');
  });

  it('keeps the document full-width while view-mode annotations overlap it', () => {
    const { unmount } = render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({ openAnnotations: 2 })} />
      </ArtifactShell>,
    );
    expect(screen.getByLabelText('Artifact viewport').style.right).toBe('0px');
    unmount();

    render(<ArtifactSurface {...surfaceProps({ openAnnotations: 2 })} />);
    expect(screen.getByLabelText('Artifact viewport').style.right).toBe('0px');
  });

  it('copies a canonical catalog query using the logical table in the default schema', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ visibility: 'private', shares: [], access: 'readwrite', rows: [], columns: [], refreshedAt: '2026-09-06T10:00:00Z' }))));
    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps({ format: 'dataset', catalog: {
      kind: 'postgres', connectionId: 'owner-connection', defaultSchema: 'sales', refreshSeconds: 60,
      tables: [
        { schema: 'crm', name: 'contacts', columns: [], source: { schema: 'external', table: 'contact_source' } },
        { schema: 'sales', name: 'orders', columns: [], source: { schema: 'external', table: 'order_source' } },
      ],
    } })} /></ArtifactShell>);
    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Copy dataset reference'));
    expect(writeText).toHaveBeenCalledWith('<Query name="data" source="story1">{`SELECT * FROM "sales"."orders"`}</Query>');
    fireEvent.click(screen.getByLabelText('Share'));
    await screen.findByLabelText('PostgreSQL read-only access');
    expect(screen.queryByLabelText('Make read & write')).not.toBeInTheDocument();
  });

  it('dataset tier: the ref copy is for authors, not readers', () => {
    const dataset = surfaceProps({ format: 'dataset', content: '[{"a":1}]', columns: [{ name: 'a', type: 'number' }] });
    const reader = render(<ArtifactSurface {...dataset} />);
    expect(screen.queryByLabelText('Copy dataset reference')).not.toBeInTheDocument();
    reader.unmount();

    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...dataset} />
      </ArtifactShell>,
    );
    openDocumentControls();
    expect(screen.getByLabelText('Copy dataset reference')).toBeInTheDocument();
  });
});

/**
 * THE VIEW-MODE SELECTION BUBBLE'S PAGE HALF. Geometry belongs to the frame —
 * only it can see a Selection at an opaque origin — so the page's whole job is
 * AUTHORITY: which actions it grants, and which it will act on when the frame
 * asks. Both ends are asserted here, on the wire, because a helper that agrees
 * with itself proves nothing about the door.
 */
describe('the view-mode selection bubble is granted, and re-checked, by the page', () => {
  const NONCE = 'n'.repeat(32);
  const OTHER_NONCE = 'm'.repeat(32);
  type FakeFrameWindow = { postMessage: ReturnType<typeof vi.fn> };

  const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!;
  const windows = new WeakMap<HTMLIFrameElement, FakeFrameWindow>();

  beforeEach(() => {
    window.addEventListener('message', trustFirst);
    // A window PER ELEMENT: a replaced frame must be a different window, or the
    // re-grant this suite checks would pass by accident.
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get(this: HTMLIFrameElement) {
        let win = windows.get(this);
        if (!win) { win = { postMessage: vi.fn() }; windows.set(this, win); }
        return win;
      },
    });
  });
  afterEach(() => {
    window.removeEventListener('message', trustFirst);
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', originalContentWindow);
  });

  const frameWindow = () => (screen.getByTitle('artifact') as HTMLIFrameElement).contentWindow as unknown as FakeFrameWindow;
  const granted = (win: FakeFrameWindow) => win.postMessage.mock.calls
    .map((call) => call[0] as { type?: string })
    .filter((message) => message?.type === STORY_SELECTION_ACTIONS_MESSAGE);
  /**
   * The nonce announcement is the trust root: the page takes it only from a
   * REAL event. `dispatchEvent` stamps isTrusted FALSE by definition, and jsdom
   * exposes it as a non-configurable accessor, so the only way to hand the page
   * a trusted announcement is to flip the implementation object mid-dispatch —
   * from a listener registered before the component's own.
   */
  const trusted = new WeakSet<Event>();
  const trustFirst = (event: Event) => {
    if (!trusted.has(event)) return;
    for (const key of Object.getOwnPropertySymbols(event)) {
      const impl = (event as unknown as Record<symbol, { isTrusted?: boolean }>)[key];
      if (impl && typeof impl === 'object' && 'isTrusted' in impl) impl.isTrusted = true;
    }
  };
  const announce = (win: FakeFrameWindow, nonce = NONCE) => act(() => {
    const event = new MessageEvent('message', {
      data: { type: STORY_SESSION_MESSAGE, nonce }, source: win as unknown as MessageEventSource,
    });
    trusted.add(event);
    window.dispatchEvent(event);
  });
  const chose = (win: FakeFrameWindow, action: 'edit' | 'annotate', nonce = NONCE) => act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: STORY_SELECTION_ACTION_MESSAGE,
        nonce,
        action,
        selection: { kind: 'text', path: '0', tag: 'p', rect: { x: 0, y: 0, width: 10, height: 10 }, className: '', style: '', ancestors: [] },
      },
      source: win as unknown as MessageEventSource,
    }));
  });

  it('grants both actions in view mode and withdraws the bubble inside edit mode', async () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    const win = frameWindow();
    announce(win);
    expect(granted(win).at(-1)).toEqual({ type: STORY_SELECTION_ACTIONS_MESSAGE, edit: true, annotate: true });

    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Edit artifact'));
    expect(granted(win).at(-1)).toMatchObject({ edit: false, annotate: false });

    await waitFor(() => expect(screen.getByLabelText('Exit edit mode')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Exit edit mode'));
    await waitFor(() => expect(granted(win).at(-1)).toMatchObject({ edit: true, annotate: true }));

    // Opening the comments rail is NOT a mode: the bubble is untouched by it.
    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Toggle comments'));
    expect(granted(win).at(-1)).toMatchObject({ edit: true, annotate: true });
  });

  it('grants a named editor BOTH actions, and a reader nothing at all', () => {
    const { unmount } = render(
      <ArtifactShell role="editor">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    announce(frameWindow());
    expect(granted(frameWindow()).at(-1)).toMatchObject({ edit: true, annotate: true });
    unmount();

    render(<ArtifactSurface {...surfaceProps({})} />);
    announce(frameWindow());
    expect(granted(frameWindow()).at(-1)).toMatchObject({ edit: false, annotate: false });
  });

  it('re-grants to a frame that was replaced, and trusts that frame’s own nonce', () => {
    vi.useFakeTimers();
    try {
      render(
        <ArtifactShell role="owner">
          <ArtifactSurface {...surfaceProps({})} />
        </ArtifactShell>,
      );
      const dead = frameWindow();
      announce(dead);
      expect(granted(dead).at(-1)).toMatchObject({ edit: true, annotate: true });

      // Painted once, then silent: the liveness check throws the frame away.
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: STORY_PAINTED_MESSAGE, source: dead as unknown as MessageEventSource }));
      });
      act(() => { window.dispatchEvent(new Event('pageshow')); });
      act(() => { vi.advanceTimersByTime(2000); });

      const fresh = frameWindow();
      expect(fresh).not.toBe(dead);
      // A replaced document is a new session: it announces its OWN nonce, and
      // the page must both re-grant to it and sign against what it announced.
      announce(fresh, OTHER_NONCE);
      expect(granted(fresh).at(-1)).toMatchObject({ edit: true, annotate: true });

      chose(fresh, 'edit', OTHER_NONCE);
      expect(window.location.hash).toBe('#edit');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the composer on the words the owner chose, without entering a mode', () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    const win = frameWindow();
    announce(win);

    chose(win, 'annotate');
    expect(window.location.hash).toBe(''); // commenting is not a mode; nothing enters the URL
    expect(document.title).toBe('doc');
    // The words travel to the layer, which owns the composer. No mode is entered.
    expect(layerProps.at(-1)).toMatchObject({ initialSelection: { path: '0' }, railOpen: false });
  });

  it('keeps annotations ambient and offers only the rail action in artifact controls', async () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({ openAnnotations: 1 })} />
      </ArtifactShell>,
    );
    openDocumentControls();
    expect(screen.getByLabelText('Toggle comments')).toBeInTheDocument();
    expect(screen.queryByLabelText('Hide comments')).toBeNull();
    expect(screen.queryByLabelText('Show comments')).toBeNull();
    expect(layerProps.at(-1)).toMatchObject({ showViewComments: true, railOpen: false });
    expect(layerProps.at(-1)).not.toHaveProperty('commentsHidden');

    fireEvent.click(screen.getByLabelText('Toggle comments'));
    await waitFor(() => expect(layerProps.at(-1)).toMatchObject({ railOpen: true }));
  });

  it('refuses an action the viewer may not take, and one that arrives after a mode opened', () => {
    const { unmount } = render(<ArtifactSurface {...surfaceProps({})} />);
    const readerWin = frameWindow();
    announce(readerWin);
    chose(readerWin, 'edit');
    expect(window.location.hash).toBe('');
    unmount();
    window.location.hash = '';

    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    const win = frameWindow();
    announce(win);
    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Edit artifact'));

    // The bubble is withdrawn in edit mode, but a click and a mode change can
    // interleave — and the page re-checks the SAME rule before acting on it.
    chose(win, 'annotate');
    expect(window.location.hash).toBe('#edit');
    expect(document.title).toBe('doc [edit mode]');
    expect(layerProps.at(-1)).toMatchObject({ initialSelection: null });

    // A forged nonce is not an action either.
    chose(win, 'edit', OTHER_NONCE);
    expect(window.location.hash).toBe('#edit');
  });
});

/**
 * FORK — the one document action that is offered to EVERYONE the shell is
 * served to, and the only one that is. Every other row here is capability
 * chrome (edit needs write, comments need annotate); forking needs the right
 * to READ, which everyone holding this page already has — the door agrees,
 * refusing on the read ACL rather than on ownership.
 *
 * So this describe exists to hold the two halves the row could get wrong: WHO
 * is offered it (owner, editor, commenter — and a dataset, which has no
 * "Artifact" section of its own until now), and what each of the door's three
 * answers does.
 */
/**
 * REFRESH EXTERNAL IMAGES — owner chrome, unlike the fork row beside it.
 *
 * A refresh re-fetches bytes that every reader of every document naming that
 * URL will then be served, so it belongs to the person whose document named it
 * — not to an editor's neighbour, and certainly not to everyone who can read.
 */
describe('the refresh row', () => {
  it('is offered to the owner and to nobody else', () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    openDocumentControls();
    expect(screen.getByLabelText('Refresh external images')).toBeInTheDocument();
    cleanup();

    for (const role of ['editor', 'commenter'] as const) {
      render(
        <ArtifactShell role={role}>
          <ArtifactSurface {...surfaceProps({})} />
        </ArtifactShell>,
      );
      openDocumentControls();
      expect(screen.queryByLabelText('Refresh external images'), role).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('the fork row', () => {
  const forkResponse = (status: number, body: unknown) => vi.fn(async () => ({
    ok: status === 201, status, json: async () => body,
  })) as unknown as typeof fetch;

  /** Assign is observed the way login-form does it: a location whose href setter is a spy. */
  const withLocation = async (run: (assign: ReturnType<typeof vi.fn>) => Promise<void> | void, search = '') => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, pathname: '/a/story1', search, hash: '', origin: 'http://localhost:3000', set href(v: string) { assign(v); } },
    });
    try {
      await run(assign);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  };

  it('is offered to owner, editor and commenter alike — and on a dataset', () => {
    for (const role of ['owner', 'editor', 'commenter'] as const) {
      const { unmount } = render(
        <ArtifactShell role={role}>
          <ArtifactSurface {...surfaceProps({})} />
        </ArtifactShell>,
      );
      openDocumentControls();
      expect(screen.getByLabelText('Fork artifact'), role).toBeInTheDocument();
      expect(screen.getByLabelText('Fork artifact').querySelector('.lucide-git-fork'), role).toBeTruthy();
      expect(screen.getByLabelText('Fork artifact')).toHaveTextContent('fork');
      unmount();
    }

    // A dataset had no "Artifact" section at all — the row widens it rather
    // than living in a second place.
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({ format: 'dataset', content: '[]', columns: [] })} />
      </ArtifactShell>,
    );
    openDocumentControls();
    expect(screen.getByLabelText('Fork artifact')).toBeInTheDocument();
  });

  it('sits directly under the comments row', () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    openDocumentControls();
    const section = screen.getByLabelText('Document actions');
    const labels = [...section.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels.indexOf('Fork artifact')).toBe(labels.indexOf('Toggle comments') + 1);
  });

  it('POSTs the fork and goes to the copy', async () => {
    const fetchMock = forkResponse(201, { id: 'copy01', url: 'http://localhost:3000/@me/copy01-doc' });
    vi.stubGlobal('fetch', fetchMock);
    await withLocation(async (assign) => {
      render(
        <ArtifactShell role="owner">
          <ArtifactSurface {...surfaceProps({})} />
        </ArtifactShell>,
      );
      openDocumentControls();
      fireEvent.click(screen.getByLabelText('Fork artifact'));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:3000/@me/copy01-doc'));
      // The owner's sheet also loads its sharing state, so the fork call is
      // found by its address rather than by being first.
      const forkCall = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
        .find((call) => String(call[0]).endsWith('/fork'));
      expect(forkCall?.[0]).toBe('/api/my/artifacts/story1/fork');
      expect(forkCall?.[1]).toMatchObject({ method: 'POST' });
    });
  });

  it('forks ONCE however fast it is pressed — a double click is not two copies', async () => {
    const fetchMock = forkResponse(201, { id: 'copy01', url: 'http://localhost:3000/@me/copy01-doc' });
    vi.stubGlobal('fetch', fetchMock);
    await withLocation(async (assign) => {
      render(
        <ArtifactShell role="owner">
          <ArtifactSurface {...surfaceProps({})} />
        </ArtifactShell>,
      );
      openDocumentControls();
      const row = screen.getByLabelText('Fork artifact');
      // BOTH clicks inside one act(), which is the hazard: React has not
      // re-rendered, so `busy` is still false and `disabled` has not applied.
      // A guard that READS state lets both through — and this door creates a
      // real artifact each time.
      act(() => { row.click(); row.click(); });
      await waitFor(() => expect(assign).toHaveBeenCalled());
      const forkCalls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((call) => String(call[0]).endsWith('/fork'));
      expect(forkCalls.length).toBe(1);
    });
  });

  it('shows the door\'s own refusal, and lets it be dismissed', async () => {
    vi.stubGlobal('fetch', forkResponse(400, { error: 'unownable_mutation', details: ['ref_ab12cd is not yours to write'] }));
    await withLocation(async (assign) => {
      render(
        <ArtifactShell role="owner">
          <ArtifactSurface {...surfaceProps({})} />
        </ArtifactShell>,
      );
      openDocumentControls();
      fireEvent.click(screen.getByLabelText('Fork artifact'));
      const notice = await screen.findByLabelText('Fork refused');
      expect(notice).toHaveTextContent('ref_ab12cd is not yours to write');
      expect(assign).not.toHaveBeenCalled();
      fireEvent.click(screen.getByLabelText('Dismiss fork refusal'));
      await waitFor(() => expect(screen.queryByLabelText('Fork refused')).toBeNull());
    });
  });

  it('sends a browser with no account to login, and back here still asking to fork', async () => {
    vi.stubGlobal('fetch', forkResponse(409, { error: 'sign_in_required' }));
    await withLocation(async (assign) => {
      render(
        <ArtifactShell role="owner">
          <ArtifactSurface {...surfaceProps({})} />
        </ArtifactShell>,
      );
      openDocumentControls();
      fireEvent.click(screen.getByLabelText('Fork artifact'));
      await waitFor(() => expect(assign).toHaveBeenCalled());
      // The reader's own selection travels with them — the callback is this
      // address plus the intent, never a bare path.
      expect(String(assign.mock.calls[0][0]))
        .toBe(`/login?callbackUrl=${encodeURIComponent('/a/story1?$region=west&intent=fork')}`);
    }, '?$region=west');
  });
});
