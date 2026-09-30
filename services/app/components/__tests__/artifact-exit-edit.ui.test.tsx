/** The compiled reader hands its live document to the editor and reloads the compiled page on exit. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';

const surfaceSpies = vi.hoisted(() => ({
  flush: vi.fn(async () => {}),
  reload: vi.fn(),
  annotationProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/islands/live-update', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/islands/live-update')>(),
  reloadKeepingPlace: surfaceSpies.reload,
}));
vi.mock('@/lib/story-runtime/anchor', () => ({ currentAnchor: vi.fn(() => null) }));

vi.mock('@/components/ArtifactEditor', () => ({
  default: ({ flushRef }: { flushRef?: { current: null | (() => Promise<void>) } }) => {
    if (flushRef) flushRef.current = surfaceSpies.flush;
    return <div aria-label="Editor stub" />;
  },
}));

vi.mock('@/components/AnnotationLayer', () => ({
  default: (props: Record<string, unknown>) => {
    surfaceSpies.annotationProps.push(props);
    return <div aria-label="Annotations stub" />;
  },
}));

import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
import { currentAnchor } from '@/lib/story-runtime/anchor';
import { setupSurface, surfaceProps } from '@/test/helpers/inline-surface';

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
  setupSurface();
  vi.mocked(currentAnchor).mockReset();
  vi.mocked(currentAnchor).mockReturnValue(null);
  surfaceSpies.flush.mockClear();
  surfaceSpies.reload.mockClear();
  surfaceSpies.annotationProps.length = 0;
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

const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => surfaceProps({ source: '<p>first</p>', ...over });

const loader = () => screen.queryByLabelText('Loading document');
const theFrame = () => document.querySelector<HTMLElement>('[data-mx-inline-story]')!;
const painted = () => waitFor(() => expect(theFrame()).not.toBeNull());

/** Enter edit mode the way the button does, and come back the way `done` does. */
const goEdit = () => act(() => { window.location.hash = '#edit'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
const leaveEdit = () => act(() => { window.location.hash = ''; window.dispatchEvent(new HashChangeEvent('hashchange')); });

describe('coming back from edit mode', () => {
  it('never gives comment creation an editor drain, while normal edit exit still flushes', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    // The comment layer is an on-demand chunk (AnnotationLayerOnDemand): wait for it to mount.
    await waitFor(() => expect(surfaceSpies.annotationProps.length).toBeGreaterThan(0));
    expect(surfaceSpies.annotationProps.at(-1)).not.toHaveProperty('beforeCreate');
    goEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).not.toBeNull());
    expect(surfaceSpies.flush).not.toHaveBeenCalled();
    leaveEdit();
    await waitFor(() => expect(surfaceSpies.flush).toHaveBeenCalledTimes(1));
  });

  it('hands the visible document to the editor and reloads the compiled reader on exit', async () => {
    {
      render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
      await painted();
      const original = theFrame();
      expect(original).toHaveTextContent('first');

      goEdit();
      await vi.waitFor(() => expect(screen.queryByLabelText('Editor stub')).not.toBeNull());
      expect(theFrame()).toBe(original);
      expect(theFrame()).toHaveTextContent('first');

      const beforeExit = { path: '0.1', fraction: 0.25 };
      vi.mocked(currentAnchor).mockReturnValueOnce(beforeExit).mockReturnValue({ path: '0.2', fraction: 0.75 });
      leaveEdit();
      await vi.waitFor(() => expect(screen.queryByLabelText('Editor stub')).toBeNull());
      await vi.waitFor(() => expect(surfaceSpies.reload).toHaveBeenCalledWith(window, beforeExit));
    }
  });

  it('does not show loading ink while the editor takes over the painted document', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await painted();
    expect(loader()).toBeNull();
    goEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).not.toBeNull());
    expect(loader()).toBeNull();
    leaveEdit();
    await waitFor(() => expect(surfaceSpies.reload).toHaveBeenCalledWith(window, null));
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

  it('compensates for the 44px editor inset before reloading the reader', async () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(806);
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await painted();
    goEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).not.toBeNull());
    scroll.mockClear();
    surfaceSpies.reload.mockClear();
    leaveEdit();
    await waitFor(() => expect(surfaceSpies.reload).toHaveBeenCalled());
    expect(scroll).toHaveBeenCalledWith(0, 762);
    expect(scroll.mock.invocationCallOrder.at(-1)!).toBeLessThan(surfaceSpies.reload.mock.invocationCallOrder.at(-1)!);
  });

  it('cancels pending scroll restoration when the surface unmounts', async () => {
    const view = render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await painted();
    goEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).not.toBeNull());
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++sequence, callback); return sequence; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    leaveEdit();
    await waitFor(() => expect(screen.queryByLabelText('Editor stub')).toBeNull());
    await waitFor(() => expect(frames.size).toBeGreaterThan(0));
    view.unmount();
    surfaceSpies.reload.mockClear();
    // Run both paints, if the disposed surface left them scheduled.
    for (let paint = 0; paint < 2; paint++) {
      const pending = [...frames.values()]; frames.clear();
      act(() => { for (const callback of pending) callback(0); });
    }
    expect(surfaceSpies.reload).not.toHaveBeenCalled();
  });

  it('does not retain a loader after the first runtime mount', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    await painted();
    expect(loader()).toBeNull();
  });

  it('does not paint white behind a dark document while its runtime loads', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props({ colorMode: 'dark' })} /></ArtifactShell>);
    const viewport = screen.getByLabelText('Artifact viewport');
    expect(viewport.getAttribute('style') ?? '').toMatch(/background/);
    await painted();
    expect(theFrame().className).not.toContain('bg-white');
  });
});
