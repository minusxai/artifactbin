/**
 * The page half of annotations — the Google-Docs shape. One rig for the three
 * `components/__tests__/annotation-{layer,composer,picking}.ui.test.tsx` files.
 *
 * AnnotationLayer holds the data and the session; the frame only ever gets ids
 * + BODY paths (`mx:annotations`) and answers with pin clicks and — while the
 * layer is on — selections. Open threads float over the document at their
 * anchor y; a preview or annotated-node click opens that thread in the rail.
 * There is no annotate MODE any more: the layer and the editor coexist.
 * Resolved history sits collapsed below the open list; the on-page composer
 * carries the edit toolbar's breadcrumb so a comment can widen to an ancestor.
 */
import { vi } from 'vitest';
import { act } from '@testing-library/react';
import AnnotationLayer from '@/components/AnnotationLayer';
import type { AnnotationWire } from '@/lib/annotations';
import { ArtifactBackendProvider } from '@/lib/artifact-backend/context';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { httpBackend } from '@/test/helpers/artifact-backend';

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

/**
 * People drawn as their real faces: `ada` has a picture, `bob` does not, and an
 * agent replied too. The picture is painted over the initial; `bob` is his
 * initial on the colour his ACCOUNT id picks — never his label's.
 */
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

export function makeFrame() {
  const postMessage = vi.fn();
  const contentWindow = { postMessage } as unknown as Window;
  const frame = {
    contentWindow,
    getBoundingClientRect: () => ({ x: 0, y: 100, width: 800, height: 600, top: 100, left: 0, right: 800, bottom: 700 }),
  } as unknown as HTMLIFrameElement;
  return { frame, postMessage, contentWindow };
}

export const fromFrame = (contentWindow: Window, data: Record<string, unknown>) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: contentWindow as unknown as MessageEventSource }));
  });

export const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
/** Per-case knobs: an imported binding cannot be assigned to, so they live here. */
export const knobs: { refuseCreate: boolean; resolvedVisible: boolean; open: AnnotationWire[] } = { refuseCreate: false, resolvedVisible: true, open: [ANN] };

/** Reset the knobs and install the annotations fetch stub. Call from `beforeEach`. */
export function installAnnotationFetch() {
  fetchCalls.length = 0;
  knobs.refuseCreate = false;
  knobs.resolvedVisible = true;
  knobs.open = [ANN];
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('status=resolved')) {
      return new Response(JSON.stringify({ annotations: knobs.resolvedVisible ? [RESOLVED] : [] }), { status: 200 });
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

export const flush = () => act(async () => { await Promise.resolve(); });

export const layer = (frame: HTMLIFrameElement, over: Partial<Parameters<typeof AnnotationLayer>[0]> = {}, backend: ArtifactBackend = httpBackend(over.id ?? 'doc1')) => {
  const initialSelection = over.initialSelection && !Object.prototype.hasOwnProperty.call(over.initialSelection, 'nodeId')
    ? { ...over.initialSelection, nodeId: `node-${over.initialSelection.path.replaceAll('.', '-')}` }
    : over.initialSelection;
  return <ArtifactBackendProvider backend={backend}><AnnotationLayer
    id="doc1"
    frameRef={{ current: frame }}
    sessionNonce={NONCE}
    railOpen={false}
    liveAnnotations={null}
    showViewComments={false}
    topOffset={100}
    onRailOpenChange={() => {}}
    {...over}
    initialSelection={initialSelection}
  /></ArtifactBackendProvider>;
};
