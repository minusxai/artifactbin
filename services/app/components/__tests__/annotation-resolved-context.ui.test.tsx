/**
 * WHAT A RESOLVED COMMENT WAS ABOUT. Selecting a resolved thread used to expand
 * its card and nothing else: no highlight, no scroll, and for a thread whose
 * passage had been deleted only "annotated element was removed". The document
 * shows the passage when it can; the card shows the original quote when it cannot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE } from '@/lib/story-runtime/contract';
import { ANN, NONCE, RESOLVED, flush, fromFrame, installAnnotationFetch, layer, makeFrame } from '@/test/helpers/annotation-layer';

beforeEach(installAnnotationFetch);
afterEach(() => vi.unstubAllGlobals());

/** Serve this row as the resolved history; everything else keeps the shared stub. */
function serveResolved(row: typeof RESOLVED) {
  const base = globalThis.fetch;
  vi.stubGlobal('fetch', (async (url: RequestInfo | URL, init?: RequestInit) =>
    String(url).includes('status=resolved')
      ? new Response(JSON.stringify({ annotations: [row] }), { status: 200 })
      : base(url, init)) as typeof fetch);
}
const posts = (postMessage: ReturnType<typeof vi.fn>) =>
  postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);

describe('selecting a resolved thread', () => {
  it('highlights its passage: the same post names it open and carries its pin', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    expect(posts(postMessage).at(-1).pins.map((p: { id: string }) => p.id)).toEqual(['ann_1']);

    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    const last = posts(postMessage).at(-1);
    expect(last.openId).toBe(RESOLVED.id);
    expect(last.pins.map((p: { id: string }) => p.id)).toEqual(['ann_1', RESOLVED.id]);
    expect(last.pins.find((p: { id: string }) => p.id === RESOLVED.id)).toMatchObject({ path: RESOLVED.anchor!.path });
    // Never an open id without its pin: the frame records the scroll as done and cannot repeat it.
    for (const m of posts(postMessage)) if (m.openId) expect(m.pins.some((p: { id: string }) => p.id === m.openId)).toBe(true);
  });

  it('paints nothing resolved at rest, and stops when the thread is collapsed', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    fireEvent.click(screen.getByLabelText('Hide resolved conversation'));
    await flush();
    expect(posts(postMessage).at(-1)).toMatchObject({ openId: null, pins: [{ id: 'ann_1' }] });
    expect(posts(postMessage).at(-1).pins).toHaveLength(1);
  });

  it('shows the original quote when the passage was removed from the document', async () => {
    serveResolved({ ...RESOLVED, anchor: null, orphaned: true, quote: 'Size: about a day.', quote_found: false });
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    expect(screen.getByText('Size: about a day.')).toBeTruthy();
    expect(screen.getByText(/removed from the document/i)).toBeTruthy();
    expect(posts(postMessage).at(-1).pins.map((p: { id: string }) => p.id)).toEqual(['ann_1']);
  });

  it('shows the original quote when the quoted words were edited away, and still points at the block', async () => {
    serveResolved({ ...RESOLVED, quote: 'an older figure of 40%', quote_found: false });
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    expect(screen.getByText('an older figure of 40%')).toBeTruthy();
    expect(screen.getByText(/since been edited/i)).toBeTruthy();
    expect(posts(postMessage).at(-1).pins.map((p: { id: string }) => p.id)).toContain(RESOLVED.id);
  });

  it('does not repeat a passage the document is already showing', async () => {
    serveResolved({ ...RESOLVED, quote: 'an older figure', quote_found: true });
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    expect(screen.queryByText('an older figure')).toBeNull();
  });
  /**
   * Expanding a resolved thread is a choice the reader makes. A thread that was open and is
   * resolved by SOMEONE ELSE, live, is not that choice: its highlight lifts, as it always did.
   */
  it('lifts the highlight when the open thread is resolved from elsewhere', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    const view = render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fromFrame(contentWindow, { type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: ANN.id });
    await flush();
    expect(posts(postMessage).at(-1)).toMatchObject({ openId: ANN.id });

    serveResolved({ ...ANN, status: 'resolved', resolved_at: '2026-08-28T00:00:00Z' });
    view.rerender(layer(frame, { railOpen: true, liveAnnotations: [] }));
    await flush(); await flush();
    expect(posts(postMessage).at(-1)).toMatchObject({ openId: null, pins: [] });
  });
});
