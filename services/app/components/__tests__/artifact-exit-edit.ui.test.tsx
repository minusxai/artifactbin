/**
 * EDIT MODE DOES NOT TOUCH THE DOCUMENT.
 *
 * Editing happens IN the frame the reader is already looking at, so the whole
 * class of faults this file was written for cannot occur: there is no second
 * document to build, nothing to reveal, and no moment where the page has to
 * decide whether a frame has painted yet. What has to be true now is simpler
 * and stronger — the frame is the SAME ELEMENT throughout, and the page's own
 * stale copy of the text never comes back over it.
 *
 * (An iframe that is re-parented reloads, so "same element" is not a detail:
 * it is the difference between a mode and a reload.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/ArtifactEditor', () => ({
  default: () => <div aria-label="Editor stub" />,
}));

import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
import { STORY_PAINTED_MESSAGE } from '@/lib/story-runtime/contract';

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
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', (async () => { throw new Error('unexpected fetch'); }) as unknown as typeof fetch);
  const windows = new WeakMap<HTMLIFrameElement, Window>();
  vi.spyOn(window.HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
    const existing = windows.get(this);
    if (existing) return existing;
    const win = { postMessage: () => {} } as unknown as Window;
    windows.set(this, win);
    return win;
  });
  window.location.hash = '';
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.location.hash = ''; });

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

const loader = () => screen.queryByLabelText('Loading document');
const theFrame = () => screen.getByTitle('artifact') as HTMLIFrameElement;
const painted = () => act(() => {
  window.dispatchEvent(new MessageEvent('message', { data: STORY_PAINTED_MESSAGE, source: theFrame().contentWindow }));
});

/** Enter edit mode the way the button does, and come back the way `done` does. */
const goEdit = () => act(() => { window.location.hash = '#edit'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
const leaveEdit = () => act(() => { window.location.hash = ''; window.dispatchEvent(new HashChangeEvent('hashchange')); });

describe('coming back from edit mode', () => {
  it('keeps the SAME frame element through edit and back — a mode, not a reload', async () => {
    vi.useFakeTimers();
    try {
      render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
      await painted();
      const original = theFrame();
      expect(original.className).toContain('opacity-100');

      goEdit();
      await vi.waitFor(() => expect(screen.queryByLabelText('Editor stub')).not.toBeNull());
      // The document is still there, still the same element, still shown.
      expect(theFrame()).toBe(original);
      expect(theFrame().className).toContain('opacity-100');

      await vi.advanceTimersByTimeAsync(10_000);
      leaveEdit();
      await vi.waitFor(() => expect(screen.queryByLabelText('Editor stub')).toBeNull());
      expect(theFrame()).toBe(original);
      expect(theFrame().className).toContain('opacity-100');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never asks the reader to wait again once the document has painted', async () => {
    // The loader exists for a frame that has nothing on it yet. Edit mode
    // never makes one, so after the first paint it must not come back — the
    // reader is looking at the document the whole time.
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    expect(loader()).not.toBeNull();
    await painted();
    expect(loader()).toBeNull();
    goEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).not.toBeNull());
    expect(loader()).toBeNull();
    leaveEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).toBeNull());
    expect(loader()).toBeNull();
  });

  it('keeps the frame where it is across edit mode — the document insets itself under the bars', async () => {
    // The editing bars (the document's own, pinned, and the editor toolbar
    // under it) overlay the frame; the DOCUMENT adds the room under them
    // (mx:reader-chrome pinned + inset), so the frame never moves and nothing
    // the reader was looking at jumps.
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await painted();
    const viewport = screen.getByLabelText('Artifact viewport');
    const readingTop = viewport.style.top;
    goEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).not.toBeNull());
    expect(viewport.style.top).toBe(readingTop);
    leaveEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).toBeNull());
    expect(viewport.style.top).toBe(readingTop);
  });

  it('shows the loader on a FIRST load', () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    expect(loader()).not.toBeNull();
  });

  it('does not paint white behind a dark document while its frame loads', () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props({ colorMode: 'dark' })} /></ArtifactShell>);
    const viewport = screen.getByLabelText('Artifact viewport');
    expect(viewport.getAttribute('style') ?? '').toMatch(/background/);
    expect(theFrame().className).not.toContain('bg-white');
  });
});
