/**
 * THE EDITOR, NOW THAT THERE IS NO CANVAS — the shared rig for the three
 * `components/__tests__/in-place-editor-*.ui.test.tsx` files.
 *
 * Everything the old editor did to an iframe it owned, this one does by
 * talking to the document the reader is already looking at. So those tests
 * drive it the way that document does — by posting the messages it posts — and
 * assert what the editor is actually responsible for: composing edits into the
 * source, persisting them through the save-less protocol, and telling the
 * document what to show.
 *
 * Replaces the editor-* suite that drove the canvas directly (chart edit, code
 * mode, draft css, dataflow refresh, delete, image insert, number edit,
 * versions, template chip, exit drain).
 *
 * The four `vi.mock`s live here because they must install before
 * `InPlaceEditor` is imported — which only happens through `mount()` below, so
 * no test file can get the ordering wrong. Per-case knobs (`live`, and the
 * frame in `env`) are fields on exported objects: an imported binding cannot
 * be assigned to.
 */
import { render, act, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';

export const queue = vi.fn();
export const flushNow = vi.fn(async () => {});
// A write from elsewhere, and whether the editor took it: both drivable, so a
// test can put the editor where an agent's edit has just landed under it.
export const live = { remote: null as unknown, adopted: false };
export const adoptRemote = vi.fn(() => live.adopted);
vi.mock('@/lib/story/use-live-edits', () => ({
  FLUSH_DEBOUNCE_MS: 500,
  useLiveEdits: () => ({
    state: { version: 4, editId: 'e1', status: '', pending: false },
    queue, flushNow, adoptRemote, isOwnEdit: () => false,
  }),
}));
vi.mock('@/lib/story/use-live-artifact', () => ({ useLiveArtifact: () => live.remote }));
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
// Monaco itself is a browser concern — it bundles workers and paints on a
// canvas, neither of which jsdom has. Stubbing the SOURCE EDITOR rather than
// `@monaco-editor/react` keeps this test about what InPlaceEditor does with the
// text; that the real editor mounts at all is scripts/gate-editor-v2.mjs's
// question, and mocking the library instead is exactly why the CDN loader
// nobody could reach went unnoticed for so long.
vi.mock('@/components/SourceEditor', async () => {
  const React = await import('react');
  return {
    __esModule: true,
    default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
      React.createElement('textarea', {
        'aria-label': 'Markup source',
        defaultValue: value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      }),
  };
});

import InPlaceEditor from '@/components/InPlaceEditor';
import type { StoryEditSelection } from '@/lib/story-runtime/contract';

/** The editor's own prop types, so a case can widen `art` without importing the component. */
export type EditorProps = React.ComponentProps<typeof InPlaceEditor>;
export type EditorArt = EditorProps['art'];

export const NONCE = 'a'.repeat(32);
export const SOURCE =
  '<Helmet><Value name="rows" type="table" value={[{"x":1}]} /></Helmet>'
  + '<div data-design="tw" className="p-4"><h1 id="h">Title</h1>'
  + '<p id="lede" className="lede">hello</p>'
  + '<Question data="$rows" viz={{"kind":"vega-lite","spec":{"mark":"bar"}}} />'
  + '<Number data="$rows" col="x" /></div>';

/** The live frame and everything it said, rebuilt by `installEditorFrame`. */
export const env = {
  frameEl: null as unknown as HTMLIFrameElement,
  frameWin: null as unknown as Window,
  posted: [] as Array<Record<string, unknown>>,
};

export const art = {
  id: 'doc1', version: 4, edit_id: 'e1',
  title: 'doc', theme: null, template: null, colorMode: 'light',
  markup: SOURCE, refs: [], compiledCss: '.x{}', dataflow: null,
};

/** Everything the DOCUMENT says arrives signed; the page drops the rest. */
export const fromFrame = (message: Record<string, unknown>, nonce: string | null = NONCE) => act(() => {
  window.dispatchEvent(new MessageEvent('message', {
    data: nonce ? { ...message, nonce } : message,
    source: env.frameWin,
  }));
});

export const selection = (over: Partial<StoryEditSelection> = {}): StoryEditSelection => ({
  kind: 'element', path: '0.1', tag: 'p',
  rect: { x: 10, y: 20, width: 100, height: 30 },
  className: 'lede', style: '', ancestors: [],
  ...over,
});

export const sentToFrame = (type: string) => env.posted.filter((m) => m.type === type);
export const lastQueued = () => queue.mock.calls.at(-1)?.[0] as { source?: string; title?: string } | undefined;

/** The editor under the standard props, as an element — `mount()` renders it,
 *  and a case that needs to re-render the SAME tree passes it to `rerender`. */
export const editorElement = (over: Partial<React.ComponentProps<typeof InPlaceEditor>> = {}) => (
  <InPlaceEditor
    art={art as React.ComponentProps<typeof InPlaceEditor>['art']}
    frameRef={{ current: env.frameEl }}
    sessionNonce={NONCE}
    {...over}
  />
);

export const mount = (over: Partial<React.ComponentProps<typeof InPlaceEditor>> = {}): RenderResult =>
  render(editorElement(over));

/** Reset the doubles and stand up a fresh frame. Call from `beforeEach`. */
export function installEditorFrame() {
  queue.mockClear();
  flushNow.mockClear();
  adoptRemote.mockClear();
  live.remote = null;
  live.adopted = false;
  env.posted = [];
  env.frameEl = document.createElement('iframe');
  document.body.appendChild(env.frameEl);
  env.frameWin = {
    postMessage: (m: Record<string, unknown>) => {
      env.posted.push(m);
      // A real document answers the commit handshake; every exit waits for it.
      if (m.type === 'mx:commit') {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'mx:committed', nonce: NONCE },
          source: env.frameWin,
        }));
      }
    },
  } as unknown as Window;
  vi.spyOn(window.HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(env.frameWin);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    return {
      ok: true,
      json: async () => url === '/api/query'
        ? { tables: {}, errors: [] }
        : { css: '.compiled{}' },
    };
  }) as unknown as typeof fetch);
}

/** Call from `afterEach`. */
export function teardownEditorFrame() {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  env.frameEl.remove();
}
