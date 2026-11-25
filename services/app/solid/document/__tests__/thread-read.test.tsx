/* @jsxImportSource solid-js */
/**
 * Reading a thread marks its notifications read: an open thread whose newest comment is on screen, for a signed-in
 * account, asks the inbox to mark `thread:<id>:<user>` read at the thread's revision. A closed or folded thread does not.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { render } from '../../__tests__/helpers';
import { AnnotationThread } from '../AnnotationThread';
import { createThreadStore } from '../annotation-threads';
import { createReplyDrafts } from '../reply-drafts';
import { InboxProvider, type InboxContext } from '../../lib/notifications';
import { SessionProvider } from '../../lib/session';
import type { ArtifactBackend } from '@/lib/artifact-backend';
import type { AnnotationWire } from '@/lib/annotations';

const ANN = { id: 'ann_1', revision: 3, status: 'open', anchor: null, orphaned: false, anchor_version: 1, snippet: 'Revenue', quote: null, range: null, quote_found: null,
  thread: [{ id: 'ann_1', body: 'is this right?', author: { kind: 'human', label: 'You', transport: 'browser', user_id: null, image: null }, created_at: '2026-10-14T00:00:00Z' }],
  created_at: '2026-10-14T00:00:00Z', resolved_at: null } as AnnotationWire;

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it.each([
  { case: 'an open thread on screen', open: true, folded: false, read: true },
  { case: 'a closed thread', open: false, folded: false, read: false },
  { case: 'a folded thread', open: true, folded: true, read: false },
])('$case: marks read = $read', async ({ open, folded, read }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ kind: 'account', user: { id: 'usr_1' } }), { headers: { 'content-type': 'application/json' } })));
  // Everything observed is on screen at once.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe() { this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
  const load = vi.fn(async () => {});
  const controller = { createInboxController: () => ({ load, loadMore: async () => {}, state: () => null, error: () => '', failedAt: () => null, loading: () => false, reconnecting: () => false }) as InboxContext };
  render(() => {
    const backend = { unavailable: () => null, listAnnotations: async () => [ANN] } as unknown as ArtifactBackend;
    const threads = createThreadStore({ backend, artifactId: () => 'doc1', mayCreate: () => false, railOpen: () => false, live: () => null });
    if (open) threads.focus(ANN.id);
    if (folded) threads.toggleFold('threads', ANN.id);
    return <SessionProvider><InboxProvider loadController={async () => controller}>
      <AnnotationThread row={ANN} threads={threads} replies={createReplyDrafts('doc1')}
        actions={{ openThread: threads.open, hoverThread: () => {}, askDelete: () => {}, signIn: () => {} }}
        artifactId="doc1" backend={backend} hovered={false} mayCreate={false} />
    </InboxProvider></SessionProvider>;
  });
  if (read) await waitFor(() => expect(load).toHaveBeenCalledWith({ read: 'thread:ann_1:usr_1', revision: 3 }));
  else {
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ read: expect.any(String) }));
  }
});
