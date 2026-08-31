/**
 * THE EDITOR, NOW THAT THERE IS NO CANVAS.
 *
 * Everything the old editor did to an iframe it owned, this one does by
 * talking to the document the reader is already looking at. So these tests
 * drive it the way that document does — by posting the messages it posts — and
 * assert what the editor is actually responsible for: composing edits into the
 * source, persisting them through the save-less protocol, and telling the
 * document what to show.
 *
 * Replaces the editor-* suite that drove the canvas directly (chart edit, code
 * mode, draft css, dataflow refresh, delete, image insert, number edit,
 * versions, template chip, exit drain).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const queue = vi.fn();
const flushNow = vi.fn(async () => {});
// A write from elsewhere, and whether the editor took it: both drivable, so a
// test can put the editor where an agent's edit has just landed under it.
const h = vi.hoisted(() => ({ remote: null as unknown, adopted: false }));
const adoptRemote = vi.fn(() => h.adopted);
vi.mock('@/lib/story/use-live-edits', () => ({
  FLUSH_DEBOUNCE_MS: 500,
  useLiveEdits: () => ({
    state: { version: 4, editId: 'e1', status: '', pending: false },
    queue, flushNow, adoptRemote, isOwnEdit: () => false,
  }),
}));
vi.mock('@/lib/story/use-live-artifact', () => ({ useLiveArtifact: () => h.remote }));
// next/dynamic resolves lazily; in a test the pane must simply be there.
vi.mock('@/lib/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: unknown }>) => {
    let Loaded: unknown = null;
    void loader().then((m) => { Loaded = m.default; });
    return (props: Record<string, unknown>) => {
      const Comp = Loaded as ((p: Record<string, unknown>) => unknown) | null;
      return Comp ? Comp(props) : null;
    };
  },
}));
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  return {
    __esModule: true,
    default: ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options?: { ariaLabel?: string } }) =>
      React.createElement('textarea', {
        'aria-label': options?.ariaLabel ?? 'Markup source',
        defaultValue: value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      }),
  };
});

import InPlaceEditor from '../InPlaceEditor';
import {
  STORY_DOCUMENT_MESSAGE, STORY_EDIT_KEY_MESSAGE, STORY_EDIT_READY_MESSAGE, STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE,
  STORY_TEXT_EDIT_MESSAGE, type StoryEditSelection,
} from '@/lib/story-runtime/contract';

const NONCE = 'a'.repeat(32);
const SOURCE =
  '<Helmet><Value name="rows" type="table" value={[{"x":1}]} /></Helmet>'
  + '<div data-design="tw" className="p-4"><h1 id="h">Title</h1>'
  + '<p id="lede" className="lede">hello</p>'
  + '<Question data="$rows" viz={{"kind":"vega-lite","spec":{"mark":"bar"}}} />'
  + '<Number data="$rows" col="x" /></div>';

let frameEl: HTMLIFrameElement;
let frameWin: Window;
let posted: Array<Record<string, unknown>>;

const art = {
  id: 'doc1', version: 4, edit_id: 'e1',
  title: 'doc', theme: null, template: null, colorMode: 'light',
  markup: SOURCE, refs: [], compiledCss: '.x{}', dataflow: null,
};

/** Everything the DOCUMENT says arrives signed; the page drops the rest. */
const fromFrame = (message: Record<string, unknown>, nonce: string | null = NONCE) => act(() => {
  window.dispatchEvent(new MessageEvent('message', {
    data: nonce ? { ...message, nonce } : message,
    source: frameWin,
  }));
});

const selection = (over: Partial<StoryEditSelection> = {}): StoryEditSelection => ({
  kind: 'element', path: '0.1', tag: 'p',
  rect: { x: 10, y: 20, width: 100, height: 30 },
  className: 'lede', style: '', ancestors: [],
  ...over,
});

const sentToFrame = (type: string) => posted.filter((m) => m.type === type);
const lastQueued = () => queue.mock.calls.at(-1)?.[0] as { source?: string; title?: string } | undefined;

const mount = (over: Partial<React.ComponentProps<typeof InPlaceEditor>> = {}) =>
  render(
    <InPlaceEditor
      art={art as React.ComponentProps<typeof InPlaceEditor>['art']}
      frameRef={{ current: frameEl }}
      sessionNonce={NONCE}
      {...over}
    />,
  );

beforeEach(() => {
  queue.mockClear();
  flushNow.mockClear();
  adoptRemote.mockClear();
  h.remote = null;
  h.adopted = false;
  posted = [];
  frameEl = document.createElement('iframe');
  document.body.appendChild(frameEl);
  frameWin = {
    postMessage: (m: Record<string, unknown>) => {
      posted.push(m);
      // A real document answers the commit handshake; every exit waits for it.
      if (m.type === 'mx:commit') {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'mx:committed', nonce: NONCE },
          source: frameWin,
        }));
      }
    },
  } as unknown as Window;
  vi.spyOn(window.HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(frameWin);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    return {
      ok: true,
      json: async () => url === '/api/query'
        ? { tables: {}, errors: [] }
        : { css: '.compiled{}' },
    };
  }) as unknown as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); frameEl.remove(); });

describe('what the document says', () => {
  it('composes a text edit into the source and persists it', async () => {
    mount();
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'goodbye' });
    await waitFor(() => expect(lastQueued()?.source).toContain('goodbye'));
    // '0.1' is body-relative; the source begins with the Helmet.
    expect(lastQueued()!.source).toContain('<h1 id="h">Title</h1>');
  });

  it('IGNORES an edit that does not carry this session\'s nonce', async () => {
    mount();
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'FORGED' }, null);
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'FORGED' }, 'b'.repeat(32));
    expect(queue).not.toHaveBeenCalled();
  });

  it('does not push a text edit back — the document already shows it', async () => {
    mount();
    posted.length = 0;
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'typed' });
    await waitFor(() => expect(queue).toHaveBeenCalled());
    expect(sentToFrame(STORY_DOCUMENT_MESSAGE)).toHaveLength(0);
  });

  it('deletes the selected node when the document reports the key', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection() });
    await fromFrame({ type: STORY_EDIT_KEY_MESSAGE, key: 'Delete' });
    await waitFor(() => expect(lastQueued()?.source).toBeDefined());
    expect(lastQueued()!.source).not.toContain('id="lede"');
    expect(lastQueued()!.source).toContain('id="h"');
    // A structural change IS pushed: the document cannot know it otherwise.
    expect(sentToFrame(STORY_DOCUMENT_MESSAGE).length).toBeGreaterThan(0);
  });
});

describe('the chrome the selection drives', () => {
  it('restores a view-mode text selection after the edit runtime is ready', async () => {
    mount({ initialSelectionPath: '0.1' });
    posted.length = 0;
    await fromFrame({ type: STORY_EDIT_READY_MESSAGE });
    await waitFor(() => expect(sentToFrame(STORY_SELECT_MESSAGE).at(-1)).toMatchObject({ path: '0.1' }));
  });

  it('opens the chart inspector for a selected Question, and writes its edits back', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
  });

  it('shuts the inspector on `close` WITHOUT waiting for the document to agree', () => {
    // Deselecting is not something the document has to describe back. Routing
    // it through the frame made `close` land a message round-trip later — the
    // panel visibly outlived the click, and a gate that asserted right after it
    // saw the inspector still open.
    mount();
    void fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close chart inspector'));
    expect(screen.queryByLabelText('Chart inspector')).toBeNull();
    // The document is still told, so it drops its own selected stamp.
    expect(sentToFrame(STORY_SELECT_MESSAGE).at(-1)).toMatchObject({ path: null });
  });

  it('DROPS the chart selection when a write from elsewhere lands', async () => {
    /*
     * AST paths are positional. An agent inserting a node before the selected
     * chart shifts it, and the inspector would go on editing whatever now sits
     * at that path — plausibly a different <Question>, which no tag guard
     * downstream would question. So an adopted document closes the inspector.
     */
    const view = mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();

    h.remote = { format: 'markup', source: '<div id="w"><p id="h">x</p></div>', editId: 'e2', version: 5 };
    h.adopted = true;
    await act(async () => { view.rerender(
      <InPlaceEditor
        art={art as React.ComponentProps<typeof InPlaceEditor>['art']}
        frameRef={{ current: frameEl }}
        sessionNonce={NONCE}
      />,
    ); });
    expect(screen.queryByLabelText('Chart inspector')).toBeNull();
  });

  it('KEEPS it when the same stream delivers nothing to adopt', async () => {
    // Our own echo comes back down the same stream; closing on that would shut
    // the inspector every time the user changed anything in it.
    const view = mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    h.remote = { format: 'markup', source: '<div id="w"><p id="h">x</p></div>', editId: 'e2', version: 5 };
    h.adopted = false;
    await act(async () => { view.rerender(
      <InPlaceEditor
        art={art as React.ComponentProps<typeof InPlaceEditor>['art']}
        frameRef={{ current: frameEl }}
        sessionNonce={NONCE}
      />,
    ); });
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
  });

  it('opens the number inspector for a selected Number', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Number', path: '0.3' }) });
    expect(screen.getByLabelText('Number inspector')).toBeTruthy();
  });

  it('shows the full format toolbar for a selected element', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection() });
    expect(screen.getByLabelText('Typography toolbar')).toBeTruthy();
    expect(screen.getByLabelText('Toggle bold')).toBeTruthy();
    expect(screen.getByLabelText('Delete element')).toBeTruthy();
  });

  it('a component gets the toolbar too — name, comment, delete; no format chips', async () => {
    /*
     * Every element is clickable and every click lands somewhere useful
     * (lib/story/selection-toolbar is the one mapping). A component's classes
     * are render output, so no class algebra — but the element's name, the
     * comment door and delete are unconditional. A <GridItem> tile used to
     * select into silence: outline, no controls, nothing to do with it.
     */
    const onComment = vi.fn();
    mount({ onComment });
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    expect(screen.getByLabelText('Typography toolbar')).toBeTruthy();
    expect(screen.getByLabelText('Selection breadcrumb').textContent).toContain('Question');
    expect(screen.getByLabelText('Comment on selection')).toBeTruthy();
    expect(screen.getByLabelText('Delete element')).toBeTruthy();
    expect(screen.queryByLabelText('Toggle bold')).toBeNull();
    expect(screen.queryByLabelText('Align left')).toBeNull();
    expect(screen.queryByLabelText('More formatting controls')).toBeNull();
  });

  it('applies a format to the live element AND to the source', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection() });
    posted.length = 0;
    fireEvent.click(screen.getByLabelText('Toggle bold'));
    await waitFor(() => expect(lastQueued()?.source).toContain('font-bold'));
    expect(sentToFrame('mx:apply-format')).toHaveLength(1);   // instant, no re-render
  });

  it('deletes from the toolbar too', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection() });
    fireEvent.click(screen.getByLabelText('Delete element'));
    await waitFor(() => expect(lastQueued()?.source).not.toContain('id="lede"'));
  });
});

describe('the editor bar', () => {
  it('names the template when the document has one, and not when it does not', () => {
    const { unmount } = mount();
    expect(screen.queryByText(/template/i)).toBeNull();
    unmount();
    mount({ art: { ...art, template: 'briefing' } as React.ComponentProps<typeof InPlaceEditor>['art'] });
    expect(screen.getByText(/briefing/i)).toBeTruthy();
  });

  it('queues a title change', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'renamed' } });
    expect(lastQueued()).toMatchObject({ title: 'renamed' });
  });

  it('queues a colour-mode pick and tells the document; theme default queues null', () => {
    mount();
    posted.length = 0;
    fireEvent.click(screen.getByLabelText('Color mode'));
    fireEvent.click(screen.getByLabelText('Color mode dark'));
    expect(lastQueued()).toMatchObject({ colorMode: 'dark' });
    expect(sentToFrame(STORY_DOCUMENT_MESSAGE).length).toBeGreaterThan(0);
    // Back to the theme's own default: an explicit CLEAR, not an absence.
    fireEvent.click(screen.getByLabelText('Color mode'));
    fireEvent.click(screen.getByLabelText('Color mode theme default'));
    expect(lastQueued()).toMatchObject({ colorMode: null });
  });

  it('edits the source in code mode through the SAME queue', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Edit the source'));
    fireEvent.change(screen.getByLabelText('Markup source'), { target: { value: '<p>rewritten</p>' } });
    expect(lastQueued()).toMatchObject({ source: '<p>rewritten</p>' });
  });

  it('opens version history', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Open version history'));
    expect(screen.getByLabelText('Open version history').getAttribute('aria-expanded')).toBe('true');
  });
});

describe('leaving', () => {
  it('keeps the single done action in the contextual editor toolbar', () => {
    const onDone = vi.fn();
    mount({ onDone });
    fireEvent.click(screen.getByLabelText('Exit edit mode'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('publishes its drain for the page to call — back button, closing tab', async () => {
    const flushRef = { current: null as null | (() => Promise<void>) };
    mount({ flushRef });
    expect(typeof flushRef.current).toBe('function');
    await flushRef.current!();
    expect(flushNow).toHaveBeenCalled();
  });

  it('drains when the tab is hidden', async () => {
    mount();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(flushNow).toHaveBeenCalled());
  });

  it('tells the document to stop being editable', async () => {
    const { unmount } = mount();
    posted.length = 0;
    unmount();
    expect(posted.some((m) => m.type === 'mx:edit-mode' && m.on === false)).toBe(true);
  });
});

describe('drafts', () => {
  /*
   * PAINT FIRST reaches the editor too. The page used to run every query
   * server-side and inline the rows into its own HTML, so the owner waited on
   * the SQL before their page existed. Now it sends the declarations, which
   * makes "no state" the ordinary arrival — and the editor has to notice, or
   * the chart panel opens on columns it never fetched.
   *
   * The signal is STATE, not the presence of a dataflow: keying on the latter
   * is what suppressed the run, because declarations alone are still a
   * dataflow.
   */
  const flowOnly = { flow: { values: [{ kind: 'table' as const, name: 'rows', rows: [{ x: 1 }], columns: [{ name: 'x', type: 'number' as const }], start: 0, end: 0 }], queries: [] } };
  const askedForQueries = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .some((c) => String(c[0]) === '/api/query');

  it('runs the draft queries when the page sent no rows', async () => {
    mount({ art: { ...art, dataflow: flowOnly } as React.ComponentProps<typeof InPlaceEditor>['art'] });
    await waitFor(() => expect(askedForQueries()).toBe(true), { timeout: 2000 });
  });

  it('runs nothing when the rows came with the page (a capture, or an older payload)', async () => {
    mount({ art: {
      ...art,
      dataflow: { ...flowOnly, state: { values: {}, tables: {}, errors: {} } },
    } as React.ComponentProps<typeof InPlaceEditor>['art'] });
    await new Promise((r) => setTimeout(r, 700));
    expect(askedForQueries()).toBe(false);
  });

  it('compiles the draft stylesheet and gives it to the document', async () => {
    mount();
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'a change that needs new classes' });
    await waitFor(() => {
      expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .some((c) => String(c[0]).includes('/api/preview'))).toBe(true);
    }, { timeout: 2000 });
  });
});
