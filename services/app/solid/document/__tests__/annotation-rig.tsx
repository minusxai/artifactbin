/* @jsxImportSource solid-js */
/**
 * The page half of annotations, rigged — the Solid twin of test/helpers/annotation-layer. One rig for
 * the layer, composer, picking, fold and resolved-context tests (not itself a test file).
 *
 * The layer holds the data and the session; the document runtime only ever gets ids + BODY paths
 * (`mx:annotations`) and answers with pin clicks and selections. The runtime here is a fake
 * StoryController whose viewport sits 100px down an 800×600 window, the geometry the React rig's
 * iframe reported, and every request goes through the real HTTP backend over a stubbed `fetch`.
 */
import { vi } from 'vitest';
import { createSignal } from 'solid-js';
import type { AnnotationWire } from '@/lib/annotations';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { STORY_ANNOTATIONS_MESSAGE, type StoryController, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { render } from '../../__tests__/helpers';
import { TrustedUi } from '../../components/TrustedUi';
import { AnnotationLayer, type AnnotationLayerProps } from '../AnnotationLayer';

export const NONCE = 'n'.repeat(32);

export const ANN: AnnotationWire = {
  id: 'ann_1',
  status: 'open',
  anchor: { key: 'a1a2b3', path: '1', spanStart: 10, spanEnd: 40 },
  orphaned: false,
  anchor_version: 2,
  snippet: 'Revenue grew 40%',
  quote: null,
  range: null,
  quote_found: null,
  thread: [
    { id: 'ann_1', body: 'is this right?', author: { kind: 'human', label: 'vivek', transport: 'browser', user_id: 'usr_vivek', image: null }, created_at: '2026-08-27T00:00:00Z' },
    { id: 'ann_2', body: 'one more thought', author: { kind: 'human', label: 'vivek', transport: 'browser', user_id: 'usr_vivek', image: null }, created_at: '2026-08-27T01:00:00Z' },
  ],
  created_at: '2026-08-27T00:00:00Z',
  resolved_at: null,
};

export const RESOLVED: AnnotationWire = {
  ...ANN,
  id: 'ann_old',
  status: 'resolved',
  snippet: 'an older figure',
  thread: [
    { id: 'ann_old', body: 'please verify the older figure', author: { kind: 'human', label: null, transport: 'browser', user_id: null, image: null }, created_at: '2026-08-26T00:00:00Z' },
    { id: 'ann_reply', body: 'verified and corrected', author: { kind: 'agent', label: 'Codex', transport: 'mcp', user_id: null, image: null }, created_at: '2026-08-26T01:00:00Z' },
  ],
  resolved_at: '2026-08-26T02:00:00Z',
};

export const MCP_AGENT: AnnotationWire = {
  ...ANN,
  id: 'ann_mcp',
  anchor: { key: 'mcp-key', path: '3', spanStart: 90, spanEnd: 120 },
  thread: [
    { id: 'ann_mcp', body: 'replied over MCP', author: { kind: 'agent', label: 'Claude Code', transport: 'mcp', user_id: null, image: null }, created_at: '2026-08-29T00:00:00Z' },
  ],
};

export const GENERIC_AGENT: AnnotationWire = {
  ...ANN,
  id: 'ann_agent',
  anchor: { key: 'agent-key', path: '2', spanStart: 50, spanEnd: 80 },
  thread: [
    { id: 'ann_agent', body: 'completed by an unidentified agent', author: { kind: 'agent', label: null, transport: 'http', user_id: null, image: null }, created_at: '2026-08-28T00:00:00Z' },
  ],
};

/** `ada` has a picture, `bob` does not, and an agent replied too. */
export const ADA_IMAGE = '/api/users/usr_ada/avatar?v=abc123';
export const FACES: AnnotationWire = {
  ...ANN,
  id: 'ann_faces',
  anchor: { key: 'faces-key', path: '4', spanStart: 130, spanEnd: 160 },
  thread: [
    { id: 'ann_faces', body: 'a face on this', author: { kind: 'human', label: 'ada', transport: 'browser', user_id: 'usr_ada', image: ADA_IMAGE }, created_at: '2026-08-30T00:00:00Z' },
    { id: 'ann_faces_2', body: 'ada again', author: { kind: 'human', label: 'ada', transport: 'browser', user_id: 'usr_ada', image: ADA_IMAGE }, created_at: '2026-08-30T01:00:00Z' },
    { id: 'ann_faces_3', body: 'bob here', author: { kind: 'human', label: 'bob', transport: 'browser', user_id: 'usr_bob', image: null }, created_at: '2026-08-30T02:00:00Z' },
    { id: 'ann_faces_4', body: 'Codex here', author: { kind: 'agent', label: 'Codex', transport: 'http', user_id: null, image: null }, created_at: '2026-08-30T03:00:00Z' },
  ],
};

export const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
/** Per-case knobs: an imported binding cannot be assigned to, so they live here. */
export const knobs: { refuseCreate: boolean; resolvedVisible: boolean; open: AnnotationWire[]; resolved: AnnotationWire[] | null; sessions: unknown[] | null } =
  { refuseCreate: false, resolvedVisible: true, open: [ANN], resolved: null, sessions: null };

/** Reset the knobs and install the annotations fetch stub. Call from `beforeEach`. */
export function installAnnotationFetch() {
  fetchCalls.length = 0;
  knobs.refuseCreate = false;
  knobs.resolvedVisible = true;
  knobs.open = [ANN];
  knobs.resolved = null;
  knobs.sessions = null;
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    const u = String(url);
    if (u === '/api/remote/sessions') return new Response(JSON.stringify({ sessions: knobs.sessions ?? [] }), { status: 200 });
    if (u.includes('/members')) return new Response(JSON.stringify({ people: [], mentions: {} }), { status: 200 });
    if (u.includes('status=resolved')) {
      return new Response(JSON.stringify({ annotations: knobs.resolved ?? (knobs.resolvedVisible ? [RESOLVED] : []) }), { status: 200 });
    }
    if (u.endsWith('/annotations') && (!init || init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ annotations: knobs.open }), { status: 200 });
    }
    if (init?.method === 'POST' && u.endsWith(`/annotations/${ANN.id}`)) {
      const body = JSON.parse(String(init.body)) as { resolve?: boolean };
      return new Response(JSON.stringify({ ...ANN, status: body.resolve ? 'resolved' : 'open' }), { status: 200 });
    }
    if (init?.method === 'POST' && u.endsWith(`/annotations/${RESOLVED.id}`)) {
      const body = JSON.parse(String(init.body)) as { reopen?: boolean };
      if (body.reopen) knobs.resolvedVisible = false;
      return new Response(JSON.stringify({ ...RESOLVED, status: body.reopen ? 'open' : 'resolved', resolved_at: body.reopen ? null : RESOLVED.resolved_at }), { status: 200 });
    }
    if (init?.method === 'POST') {
      if (knobs.refuseCreate) {
        return new Response(JSON.stringify({ error: 'invalid_jsx', details: [{ message: 'Inline style attribute is not allowed' }] }), { status: 400 });
      }
      return new Response(JSON.stringify({ ...ANN, id: 'ann_new', thread: [{ ...ANN.thread[0], body: 'fresh note' }] }), { status: 201 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch);
}

/** Let every pending request and its JSON body settle. */
export const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A document runtime: `send` is what the layer posts, `emit` is the runtime answering. */
export function makeRuntime(viewport = { left: 0, top: 100, width: 800, height: 600 }) {
  const listeners = new Set<(data: unknown) => void>();
  const send = vi.fn();
  const rect = { ...viewport };
  const controller = {
    nonce: NONCE, send, update: vi.fn(), invalidate: vi.fn(), dispose: vi.fn(),
    getViewportRect: () => ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height }) as DOMRect,
    subscribe: (listener: (data: unknown) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } as unknown as StoryController;
  const emit = (data: Record<string, unknown>) => { for (const listener of [...listeners]) listener({ nonce: NONCE, ...data }); };
  const posts = () => send.mock.calls.map((call) => call[0]).filter((message) => message?.type === STORY_ANNOTATIONS_MESSAGE);
  return { ref: { current: controller as StoryController | null }, controller, send, emit, posts, rect, listeners };
}

const backends = new Map<string, ArtifactBackend>();
/** One backend per id for the whole file, as the page memoises it. */
export const httpBackend = (id: string): ArtifactBackend => {
  let backend = backends.get(id);
  if (!backend) backends.set(id, backend = createHttpBackend(id));
  return backend;
};

type Over = Partial<AnnotationLayerProps>;
/** A selection handed in without a node id gets the one the React rig gave it. */
const withNode = (selection: StoryEditSelection | null | undefined) =>
  selection && !Object.prototype.hasOwnProperty.call(selection, 'nodeId')
    ? { ...selection, nodeId: `node-${selection.path.replaceAll('.', '-')}` } : selection;

/**
 * Mount the layer with the React rig's defaults (id doc1, rail closed, no live list, 100px top).
 * `set` changes props the way a React `rerender` did; `runtime` is the fake document.
 */
export function layer(over: Over = {}, runtime = makeRuntime(), options: { trusted?: boolean } = {}) {
  const [props, setProps] = createSignal<Over>({ ...over, initialSelection: withNode(over.initialSelection) });
  const view = render(() => {
    const p = () => props();
    const ui = () => <AnnotationLayer
      id={p().id ?? 'doc1'}
      backend={p().backend ?? httpBackend(p().id ?? 'doc1')}
      runtimeRef={p().runtimeRef ?? runtime.ref}
      sessionNonce={p().sessionNonce === undefined ? NONCE : p().sessionNonce}
      railOpen={p().railOpen ?? false}
      liveAnnotations={p().liveAnnotations ?? null}
      showViewComments={p().showViewComments ?? false}
      topOffset={p().topOffset ?? 100}
      rightInset={p().rightInset}
      onRailOpenChange={(open) => p().onRailOpenChange?.(open)}
      initialSelection={p().initialSelection}
      onSelectionConsumed={p().onSelectionConsumed}
      pickOnOpen={p().pickOnOpen}
      pickRequested={p().pickRequested}
      editId={p().editId}
      railHost={p().railHost}
      railSheet={p().railSheet}
      panelWidth={p().panelWidth}
      linkTarget={p().linkTarget}
      onAnnotationsChange={p().onAnnotationsChange}
    />;
    return options.trusted ? <TrustedUi overlay>{ui()}</TrustedUi> : ui();
  });
  const set = (next: Over) => setProps({ ...next, initialSelection: withNode(next.initialSelection) });
  return { ...view, runtime, set };
}

/** The shadow root a `trusted` mount renders into. */
export const trustedRoot = () => document.querySelector('[data-trusted-ui]')!.shadowRoot!;
