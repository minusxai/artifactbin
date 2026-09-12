/**
 * A shared artifact link opens on the document with public reader chrome.
 * ArtifactShell supplies role authority for editing, commenting and ownership.
 * This fixture tests Surface's private endpoint contract and visible controls;
 * the real TrustedUi/runtime security boundaries have their own suites.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { router, resetRouter } from '@/test/setup/router';
import { useLayoutEffect } from 'react';
import type { InlineStoryController, InlineStoryRuntimeProps } from '@/lib/story-runtime/InlineStoryRuntime';

const runtimes: Array<InlineStoryController & { send: ReturnType<typeof vi.fn>; emit(data: unknown): void }> = [];
vi.mock('@/lib/story-runtime/InlineStoryRuntime', () => ({
  InlineStoryRuntime: ({onController}: InlineStoryRuntimeProps) => {
    useLayoutEffect(() => {
      const listeners = new Set<(event: unknown) => void>();
      const controller = {
        nonce: crypto.randomUUID(), send: vi.fn(), update: vi.fn(), invalidate: vi.fn(),
        subscribe(listener: (event: unknown) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        getViewportRect: () => new DOMRect(), dispose: () => listeners.clear(),
        emit(data: unknown) { for (const listener of listeners) listener(data); },
      };
      runtimes.push(controller);
      onController(controller);
      return () => { onController(null); controller.dispose(); };
    }, [onController]);
    return <div data-mx-inline-story><p>hi</p></div>;
  },
}));

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
  default: (props: { onExit: () => void }) => (
    <header aria-label="Editor toolbar">
      <input aria-label="Title" />
      <button aria-label="Exit edit mode" className="text-accent" onClick={props.onExit}><span className="lucide-check" />done</button>
    </header>
  ),
}));

import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import {
  STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECTION_ACTION_MESSAGE,
} from '@/lib/story-runtime/contract';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  constructor() { FakeEventSource.last = this; }
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
  resetRouter();
  runtimes.length = 0;
  layerProps.length = 0;
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

/** Click the actual reader control; the private runtime is not its transport. */
const openDocumentControls = () => {
  // A dataset or image page has no frame: its bar carries the button itself.
  const button = screen.queryByLabelText('Open artifact controls');
  if (button) { fireEvent.click(button); return; }
  const trigger = document.querySelector<HTMLElement>('[data-mx-reader-trigger="controls"]');
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger!);
};

describe('the surface header buttons are owner chrome', () => {
  it('a reader has no Share button or owner controls', () => {
    render(<ArtifactSurface {...surfaceProps({})} />);
    expect(screen.queryByLabelText('Edit artifact')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Share')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Copy agent instructions')).not.toBeInTheDocument();
    // Standalone raw rendering is not a reader navigation affordance.
    expect(screen.queryByLabelText('Open the raw artifact')).not.toBeInTheDocument();
  });

  it('opens sharing directly from the reader bar for the owner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ visibility: 'private', linkRole: 'viewer', shares: [] }))));
    for (const role of ['owner'] as const) {
      render(<ArtifactShell role={role}><ArtifactSurface {...surfaceProps({})} /></ArtifactShell>);
      const share = document.querySelector<HTMLElement>('[data-mx-reader-rail] [data-mx-reader-action="share"]')!;
      fireEvent.click(share);
      expect(await screen.findByRole('dialog', { name: 'Sharing' })).toBeInTheDocument();
      expect(await screen.findByLabelText('Make public')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('Close sharing'));
      expect(screen.queryByRole('dialog', { name: 'Sharing' })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('keeps all actions directly in the bar and hides top-bar sharing from editors', () => {
    render(<ArtifactShell role="editor"><ArtifactSurface {...surfaceProps({})} /></ArtifactShell>);
    const rail = document.querySelector('[data-mx-reader-rail]')!;
    expect(rail.querySelector('[data-mx-reader-action="share"]')).toBeNull();
    expect(rail.querySelector('details')).toBeNull();
    expect(rail.querySelector('[data-mx-reader-action="like"]')).not.toBeNull();
    expect(rail.querySelector('[data-mx-reader-action="fork"]')).not.toBeNull();
    expect(rail.querySelector('[data-mx-github-star]')).not.toBeNull();
  });

  it('shows the current visibility icon on Share and updates it after sharing changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(JSON.stringify({ visibility: init?.method === 'PUT' ? 'public' : 'private', linkRole: 'viewer', shares: [] }))));
    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps({})} /></ArtifactShell>);
    const share = document.querySelector<HTMLElement>('[data-mx-reader-action="share"]')!;
    expect(share.querySelector('[data-mx-visibility="private"]')).not.toBeNull();
    fireEvent.click(share);
    fireEvent.click(await screen.findByLabelText('Make public'));
    await waitFor(() => expect(share.querySelector('[data-mx-visibility="public"]')).not.toBeNull());
  });

  it('uses identical visibility geometry in the toolbar and sharing dialog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ visibility: 'unlisted', linkRole: 'viewer', shares: [] }))));
    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps({ visibility: 'unlisted' })} /></ArtifactShell>);
    const share = document.querySelector<HTMLElement>('[data-mx-reader-action="share"]')!;
    fireEvent.click(share);
    const option = await screen.findByLabelText('Make unlisted');
    expect(share.querySelector('svg')?.innerHTML).toBe(option.querySelector('svg')?.innerHTML);
  });

  it('uses the users icon for private invitations and restores the lock when the last person is removed', async () => {
    let shares = [{ email: 'mxmx_test_guest@example.com', role: 'viewer' }];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if (init?.method === 'PUT') shares = JSON.parse(String(init.body)).shares;
      return new Response(JSON.stringify({ visibility: 'private', linkRole: 'viewer', shares }));
    }));
    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps({ hasInvitedUsers: true })} /></ArtifactShell>);
    const share = document.querySelector<HTMLElement>('[data-mx-reader-action="share"]')!;
    expect(share.querySelector('[data-mx-sharing-icon="shared"]')).not.toBeNull();
    fireEvent.click(share);
    fireEvent.click(await screen.findByLabelText('Remove mxmx_test_guest@example.com'));
    await waitFor(() => expect(share.querySelector('[data-mx-sharing-icon="private"]')).not.toBeNull());
    fireEvent.change(screen.getByLabelText('Invite email'), { target: { value: 'mxmx_test_guest@example.com' } });
    fireEvent.click(screen.getByLabelText('Add email'));
    await waitFor(() => expect(share.querySelector('[data-mx-sharing-icon="shared"]')).not.toBeNull());
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
    expect(within(screen.getByLabelText('Owner actions')).getByLabelText('Share')).toBeInTheDocument();
    expect(screen.queryByLabelText('Copy agent instructions')).not.toBeInTheDocument();
  });

  it('offers social-preview framing inside sharing to markup owners and editors, but not commenters or viewers', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({visibility:'private',linkRole:'viewer',shares:[]}))));
    for (const role of ['owner', 'editor'] as const) {
      render(<ArtifactShell role={role}><ArtifactSurface {...surfaceProps({ source: '<p>hi</p>' })} /></ArtifactShell>);
      openDocumentControls();
      expect(screen.queryByLabelText('Edit social preview'), role).not.toBeInTheDocument();
      fireEvent.click(within(screen.getByLabelText(role === 'owner' ? 'Owner actions' : 'Document actions')).getByLabelText('Share'));
      expect(screen.getByRole('dialog', { name: 'Sharing' }), role).toContainElement(screen.getByLabelText('Edit social preview'));
      if (role === 'editor') {
        expect(await screen.findByLabelText('Make public')).toBeInTheDocument();
        expect(screen.getByLabelText('Invite email')).toBeInTheDocument();
      }
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
    await waitFor(() => expect(screen.getByLabelText('Exit edit mode')).toBeInTheDocument());
    expect(screen.queryByLabelText('Edit artifact')).not.toBeInTheDocument();
    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Toggle comments'));
    expect(layerProps.at(-1)).toMatchObject({ railOpen: true, topOffset: 92 });
    expect(screen.getByLabelText('Exit edit mode')).toHaveClass('text-accent');
    expect(screen.getByLabelText('Exit edit mode').querySelector('.lucide-check')).toBeTruthy();
    expect(screen.getByLabelText('Exit edit mode')).toHaveTextContent('done');
    expect(screen.getByLabelText('Editor toolbar')).toContainElement(screen.getByLabelText('Title'));
    // The trusted reader controls remain available alongside the editor.
    expect(screen.getByLabelText('Open menu')).toHaveAttribute('data-mx-reader-trigger', 'menu');
    expect(document.querySelector('[data-mx-reader-trigger="controls"]')).toBeInTheDocument();
    expect(document.title).toBe('doc [edit mode]');

    fireEvent.click(screen.getByLabelText('Exit edit mode'));
    // Exiting preserves the same reader controls rather than duplicating them.
    await waitFor(() => expect(screen.getByLabelText('Open menu')).toHaveAttribute('data-mx-reader-trigger', 'menu'));
    expect(screen.getByLabelText('Open artifact controls')).toHaveAttribute('data-mx-reader-trigger', 'controls');
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
    // The rail sits UNDER the document's bar and the frame stays full-width:
    // the bar drawn inside it must not narrow, and its controls must not move.
    expect(screen.getByLabelText('Artifact viewport').style.right).toBe('0px');
    expect(layerProps.at(-1)).toMatchObject({ railOpen: true, topOffset: 44 });
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

  it('refreshes authoritative catalog metadata and rows after a live dataset mutation without losing the chosen table', async () => {
    const initialCatalog = { kind: 'stored' as const, defaultSchema: 'sales', refreshSeconds: 0, tables: [
      { schema: 'sales', name: 'orders', objectKey: 'v1', columns: [{ name: 'value', type: 'number' as const }] },
      { schema: 'sales', name: 'other', objectKey: 'v1-other', columns: [{ name: 'value', type: 'number' as const }] },
    ] };
    let latest = 1;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url.endsWith('/events/frame')) return new Response(JSON.stringify({ editId: 'edit_2', version: 2, format: 'dataset', content: '[]', title: 'updated' }));
      if (url === '/api/page/artifact/story1') return new Response(JSON.stringify({ surface: { version: 2, catalog: { ...initialCatalog, tables: initialCatalog.tables.map(t => ({ ...t, objectKey: 'v2', columns: [...t.columns, { name: 'added', type: 'string' }] })) } } }));
      return new Response(JSON.stringify({ rows: [{ value: latest === 1 ? 42 : 84, added: 'new column' }], columns: latest === 1 ? [{ name: 'value', type: 'number' }] : [{ name: 'value', type: 'number' }, { name: 'added', type: 'string' }], truncated: false, refreshedAt: '2026-09-06T10:00:00Z' }));
    }));
    render(<ArtifactSurface {...surfaceProps({ format: 'dataset', catalog: initialCatalog })} />);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('42'));
    fireEvent.change(screen.getByLabelText('Dataset table'), { target: { value: 'other' } });
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('42'));
    latest = 2;
    act(() => FakeEventSource.last!.onmessage?.({ data: JSON.stringify({ editId: 'edit_2', version: 2 }) } as MessageEvent));
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('84'));
    expect(screen.getByLabelText('Table preview')).toHaveTextContent('added');
    expect(screen.getByLabelText('Dataset table')).toHaveValue('other');
    expect(screen.getByLabelText('Dataset schema')).toHaveValue('sales');
    expect(requests).toContain('/api/page/artifact/story1');
  });

  it('copies a canonical catalog query using the logical table in the default schema', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ visibility: 'private', shares: [], access: 'readwrite', rows: [], columns: [], refreshedAt: '2026-09-06T10:00:00Z' }))));
    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps({ format: 'dataset', catalog: {
      kind: 'postgres', defaultSchema: 'sales', refreshSeconds: 60,
      tables: [
        { schema: 'crm', name: 'contacts', columns: [], source: { schema: 'external', table: 'contact_source' } },
        { schema: 'sales', name: 'orders', columns: [], source: { schema: 'external', table: 'order_source' } },
      ],
    } })} /></ArtifactShell>);
    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Copy dataset reference'));
    expect(writeText).toHaveBeenCalledWith('<Query name="data" source="ref:story1">{`SELECT * FROM "sales"."orders"`}</Query>');
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
 * Selection geometry belongs to the inline runtime; Surface owns authority.
 * Exercise both grants and action re-checks through the private controller.
 */
describe('the view-mode selection bubble is granted, and re-checked, by the page', () => {
  const OTHER_NONCE = 'm'.repeat(32);
  const currentRuntime = () => runtimes.at(-1)!;
  const granted = (win: ReturnType<typeof currentRuntime>) => win.send.mock.calls
    .map((call) => call[0] as { type?: string })
    .filter((message) => message?.type === STORY_SELECTION_ACTIONS_MESSAGE);
  const chose = (win: ReturnType<typeof currentRuntime>, action: 'edit' | 'annotate', nonce = win.nonce) => act(() => {
    win.emit({
        type: STORY_SELECTION_ACTION_MESSAGE,
        nonce,
        action,
        selection: { kind: 'text', path: '0', tag: 'p', rect: { x: 0, y: 0, width: 10, height: 10 }, className: '', style: '', ancestors: [] },
    });
  });

  it('grants both actions in view mode and withdraws the bubble inside edit mode', async () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    const win = currentRuntime();
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

  it('opening the rail reserves content space without remounting the runtime', async () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    const win = currentRuntime();
    const viewport = screen.getByLabelText('Artifact viewport');
    expect(viewport).toHaveStyle({paddingTop: '44px', paddingRight: '0px'});

    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Toggle comments'));
    expect(viewport).toHaveStyle({paddingTop: '44px', paddingRight: '320px'});
    expect(screen.getByLabelText('Artifact viewport').style.right).toBe('0px');
    expect(layerProps.at(-1)).toMatchObject({ railOpen: true, topOffset: 44 });

    // Under the editor the rail drops below BOTH bars; the runtime survives.
    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Edit artifact'));
    await waitFor(() => expect(screen.getByLabelText('Exit edit mode')).toBeInTheDocument());
    expect(viewport).toHaveStyle({paddingTop: '92px', paddingRight: '320px'});
    expect(layerProps.at(-1)).toMatchObject({ railOpen: true, topOffset: 92 });

    openDocumentControls();
    fireEvent.click(screen.getByLabelText('Toggle comments'));
    expect(viewport).toHaveStyle({paddingTop: '92px', paddingRight: '0px'});
    expect(currentRuntime()).toBe(win);
  });

  it('grants a named editor BOTH actions, and a reader nothing at all', () => {
    const { unmount } = render(
      <ArtifactShell role="editor">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    expect(granted(currentRuntime()).at(-1)).toMatchObject({ edit: true, annotate: true });
    unmount();

    render(<ArtifactSurface {...surfaceProps({})} />);
    expect(granted(currentRuntime()).at(-1)).toMatchObject({ edit: false, annotate: false });
  });

  it('re-grants a replacement document and rejects the previous runtime session', () => {
      const view = render(
        <ArtifactShell role="owner">
          <ArtifactSurface {...surfaceProps({})} />
        </ArtifactShell>,
      );
      const dead = currentRuntime();
      expect(granted(dead).at(-1)).toMatchObject({ edit: true, annotate: true });

      view.rerender(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps({id: 'story2'})} /></ArtifactShell>);

      const fresh = currentRuntime();
      expect(fresh).not.toBe(dead);
      expect(granted(fresh).at(-1)).toMatchObject({ edit: true, annotate: true });
      chose(dead, 'edit');
      expect(window.location.hash).toBe('');
      chose(fresh, 'edit', dead.nonce);
      expect(window.location.hash).toBe('');
      chose(fresh, 'edit');
      expect(window.location.hash).toBe('#edit');
  });

  it('opens the composer on the words the owner chose, without entering a mode', () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    const win = currentRuntime();

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
    const readerWin = currentRuntime();
    chose(readerWin, 'edit');
    expect(window.location.hash).toBe('');
    unmount();
    window.location.hash = '';

    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    const win = currentRuntime();
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
  const forkResponse = (status: number, body: unknown) => vi.fn(async (url: string) => url.endsWith('/sharing')
    ? new Response(JSON.stringify({ visibility: 'private', linkRole: 'viewer', shares: [] }))
    : { ok: status === 201, status, json: async () => body }) as unknown as typeof fetch;

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
      expect(screen.getByLabelText('Fork artifact').querySelector('svg'), role).toBeTruthy();
      expect(screen.getByLabelText('Fork artifact')).toHaveTextContent('fork');
      unmount();
    }

    // Data artifacts expose the same action directly in their app bar.
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({ format: 'dataset', content: '[]', columns: [] })} />
      </ArtifactShell>,
    );
    openDocumentControls();
    expect(screen.getByLabelText('Fork artifact')).toBeInTheDocument();
  });

  it('sits in the action rail outside artifact settings', () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...surfaceProps({})} />
      </ArtifactShell>,
    );
    openDocumentControls();
    const section = screen.getByLabelText('Document actions');
    const labels = [...section.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).not.toContain('Fork artifact');
    expect(screen.getByLabelText('Fork artifact').closest('[data-mx-reader-rail]')).not.toBeNull();
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
  fireEvent.click(screen.getByLabelText('Confirm fork'));
      await waitFor(() => expect(router.pushed).toContain('http://localhost:3000/@me/copy01-doc'));
      expect(assign).not.toHaveBeenCalled();
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
    await withLocation(async (_assign) => {
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
      const confirm = screen.getByLabelText('Confirm fork');
      act(() => { confirm.click(); confirm.click(); });
      await waitFor(() => expect(router.pushed.length).toBe(1));
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
  fireEvent.click(screen.getByLabelText('Confirm fork'));
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
  fireEvent.click(screen.getByLabelText('Confirm fork'));
      await waitFor(() => expect(router.pushed.length).toBe(1));
      expect(assign).not.toHaveBeenCalled();
      // The reader's own selection travels with them — the callback is this
      // address plus the intent, never a bare path.
      expect(router.pushed[0])
        .toBe(`/login?callbackUrl=${encodeURIComponent('/a/story1?$region=west&intent=fork')}`);
    }, '?$region=west');
  });
});

it('dataset editors can open sharing controls', async () => {
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({visibility:'private',linkRole:'viewer',shares:[],access:'readwrite'}))));
  render(<ArtifactShell role="editor"><ArtifactSurface {...surfaceProps({format:'dataset'})} /></ArtifactShell>);
  openDocumentControls();
  fireEvent.click(within(screen.getByLabelText('Document actions')).getByLabelText('Share'));
  expect(await screen.findByLabelText('Invite email')).toBeInTheDocument();
});

it('updates the retained runtime when refreshed server props advance the document', async () => {
  const initial=surfaceProps({source:'<p>old</p>',version:1});
  const view=render(<ArtifactShell role="owner"><ArtifactSurface {...initial} /></ArtifactShell>);
  const nodes=storyUpdateParts('<p>new document</p>')!.nodes;
  const runtime={title:'Updated document',data:{nodes,refData:{},colorMode:'light' as const},baseCss:'',compiledCss:null,authorCss:null,authorScript:null,theme:null};
  view.rerender(<ArtifactShell role="owner"><ArtifactSurface {...initial} source="<p>new document</p>" version={2} editId="edit_2" runtime={runtime} /></ArtifactShell>);
  await waitFor(()=>expect(runtimes.at(-1)!.update).toHaveBeenCalledWith(expect.objectContaining({nodes})));
  expect(runtimes).toHaveLength(1);
});
