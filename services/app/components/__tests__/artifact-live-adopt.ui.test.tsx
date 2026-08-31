/**
 * A live edit is delivered TO the document, not around it.
 *
 * The page owns the stream — an opaque frame cannot hold an EventSource
 * against our origin — and used to deliver what it heard by replacing the
 * frame: the whole document re-fetched and re-hydrated, every chart rebuilt,
 * the reader's place on the page gone, once per agent write. It posts the new
 * version in instead, and replaces the frame only when the document does not
 * answer (one with no components ships no runtime at all).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';


import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
import { STORY_ADOPTS_MESSAGE, STORY_DOCUMENT_ACK_MESSAGE, STORY_DOCUMENT_MESSAGE } from '@/lib/story-runtime/contract';
import type { ArtifactLiveEvent } from '@/lib/story/live';

/** The one live connection, driven by the test. */
let stream: { emit: (frame: ArtifactLiveEvent) => void } | null = null;

class FakeEventSource {
  /** The named `data` channel (a dataset under the document changed). */
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  emitData(payload: unknown) { for (const fn of this.listeners.data ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent); }
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    // A version PING on the stream; the frame it points at is what the page's
    // fetch of `/a/<id>/events/frame` will answer.
    stream = { emit: (frame) => { served = frame; this.onmessage?.({ data: JSON.stringify({ editId: frame.editId, version: frame.version, by: null }) } as MessageEvent); } };
  }
  close() { stream = null; }
}

/** What the frame received, and whether it plays along. */
let posted: unknown[] = [];
let acks = true;
/** What `/a/<id>/events/frame` answers next. */
let served: ArtifactLiveEvent | null = null;

beforeEach(() => {
  posted = [];
  acks = true;
  stream = null;
  vi.stubGlobal('EventSource', FakeEventSource);
  served = null;
  vi.stubGlobal('fetch', (async (url: string) => {
    if (String(url).endsWith('/events/frame') && served) return new Response(JSON.stringify(served), { headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected fetch ${String(url)}`);
  }) as unknown as typeof fetch);
  // jsdom gives an iframe a real contentWindow; stand in for the document
  // inside it, which in the browser is another origin entirely.
  // One stand-in window per iframe ELEMENT: the page identifies the frame by
  // `event.source`, so a fresh object per access would fail every check the
  // real code makes.
  const windows = new WeakMap<HTMLIFrameElement, Window>();
  vi.spyOn(window.HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
    const existing = windows.get(this);
    if (existing) return existing;
    const win = {
      postMessage: (data: unknown) => {
        posted.push(data);
        if (acks && (data as { type?: string })?.type === STORY_DOCUMENT_MESSAGE) {
          window.dispatchEvent(new MessageEvent('message', { data: STORY_DOCUMENT_ACK_MESSAGE, source: win }));
        }
      },
    } as unknown as Window;
    windows.set(this, win);
    return win;
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'doc123',
  editId: 'edit_1',
  format: 'markup',
  title: 'doc',
  source: '<p>first</p>',
  template: null,
  refs: [],
  version: 1,
  content: '',
  columns: [],
  compiledCss: null,
  theme: null,
  colorMode: null,
  ...over,
});

const frame = (over: Partial<ArtifactLiveEvent> = {}): ArtifactLiveEvent => ({
  editId: 'edit_2',
  version: 2,
  format: 'markup',
  title: 'doc',
  source: '<p>second</p>',
  content: null,
  theme: null,
  colorMode: null,
  template: null,
  nodes: [{ type: 'element', tag: 'p', isComponent: false, attributes: [], children: [], selfClosing: false, start: 0, end: 0 }],
  ...over,
} as ArtifactLiveEvent);

const iframeKey = () => (screen.getByTitle('artifact') as HTMLIFrameElement).getAttribute('src');
const theFrame = () => screen.getByTitle('artifact');

/**
 * The document announcing that it can adopt updates — what the runtime does as
 * it starts. Without it the page replaces the frame instead, which is right for
 * a document that ships no runtime at all.
 */
const announceAdopts = () => act(() => {
  window.dispatchEvent(new MessageEvent('message', {
    data: STORY_ADOPTS_MESSAGE,
    source: (theFrame() as HTMLIFrameElement).contentWindow,
  }));
});

describe('a live edit reaches an open document', () => {
  it('posts the new version into the frame instead of replacing it', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    const before = theFrame();

    await waitFor(() => expect(stream).not.toBeNull());
    announceAdopts();
    stream!.emit(frame());

    await waitFor(() => expect(posted.some((p) => (p as { type?: string })?.type === STORY_DOCUMENT_MESSAGE)).toBe(true));
    const update = posted.find((p) => (p as { type?: string })?.type === STORY_DOCUMENT_MESSAGE) as { nodes: unknown[] };
    expect(update.nodes).toHaveLength(1);
    expect(theFrame()).toBe(before);       // same element: no reload
    // The owner's copy carries the runtime up front (?edit=1), because editing
    // happens inside this frame and a prose document ships none otherwise.
    expect(iframeKey()).toBe('/a/doc123/raw?edit=1');
  });

  it('carries the design and the stylesheet when they change', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await waitFor(() => expect(stream).not.toBeNull());
    announceAdopts();
    stream!.emit(frame({ compiledCss: '.x{}', authorCss: '.y{}', theme: 'modernist' as never, colorMode: 'dark' }));

    // The frame is also being asked `mx:hello`; the update is the one with a type.
    const update = async () => posted.find((p) => (p as { type?: string })?.type === STORY_DOCUMENT_MESSAGE);
    await waitFor(async () => expect(await update()).toBeTruthy());
    expect(await update()).toMatchObject({ compiledCss: '.x{}', authorCss: '.y{}', theme: 'modernist', colorMode: 'dark' });
  });

  it('does NOT hide the document behind the loader while updating', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await waitFor(() => expect(stream).not.toBeNull());
    announceAdopts();
    // The frame has painted, so the loader is gone; an update must not bring it back.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: 'mx:painted', source: (theFrame() as HTMLIFrameElement).contentWindow }));
    });
    await waitFor(() => expect(screen.queryByLabelText('Loading document')).toBeNull());

    stream!.emit(frame());
    await waitFor(() => expect(posted.some((p) => (p as { type?: string })?.type === STORY_DOCUMENT_MESSAGE)).toBe(true));
    expect(screen.queryByLabelText('Loading document')).toBeNull();
    expect((theFrame() as HTMLIFrameElement).className).toContain('opacity-100');
  });

  it('replaces the frame when the document never answers', async () => {
    vi.useFakeTimers();
    try {
      acks = false;
      render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
      await vi.waitFor(() => expect(stream).not.toBeNull());
      announceAdopts();
      const before = theFrame();
      stream!.emit(frame());
      // It is ASKED repeatedly first — the runtime is a module that loads after
      // the document says it painted, so one unanswered ask means nothing.
      await vi.advanceTimersByTimeAsync(5000);
      // The state update lands inside a timer callback, so wait for React to
      // commit it rather than reading the tree in the same tick.
      await vi.waitFor(() => expect(theFrame()).not.toBe(before));   // fell back to a reload
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces the frame at once for a document that ships no runtime', async () => {
    // A document of pure prose hydrates nothing, so nothing in it is listening.
    // Waiting for an ack it can never send is a reader looking at an edit that
    // has already been made.
    vi.useFakeTimers();
    try {
      render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
      await vi.waitFor(() => expect(stream).not.toBeNull());
      // …but only once it has been on screen long enough to have said so: a
      // runtime is a large module, and a slow link is not a missing one.
      await vi.advanceTimersByTimeAsync(4000);
      const before = theFrame();
      posted.length = 0;
      stream!.emit(frame());
      await vi.waitFor(() => expect(theFrame()).not.toBe(before));
      expect(posted.some((p) => (p as { type?: string })?.type === STORY_DOCUMENT_MESSAGE)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still delivers to a document that has not announced YET (a slow runtime)', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await waitFor(() => expect(stream).not.toBeNull());
    // No announcement, but the frame has only just appeared.
    stream!.emit(frame());
    await waitFor(() => expect(posted.some((p) => (p as { type?: string })?.type === STORY_DOCUMENT_MESSAGE)).toBe(true));
  });

  it('replaces the frame for a version it cannot describe (source that no longer parses)', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await waitFor(() => expect(stream).not.toBeNull());
    announceAdopts();
    const before = theFrame();
    stream!.emit(frame({ nodes: undefined }));
    await waitFor(() => expect(theFrame()).not.toBe(before));
  });
});
