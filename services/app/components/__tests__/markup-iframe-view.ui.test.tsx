/**
 * Unified serving: markup VIEW mode is the
 * sandboxed /raw iframe — the html tier's exact mechanism — not the in-page
 * story engine. The engine remains the EDIT canvas only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';


import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';

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
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', (async () => {
    throw new Error('unexpected fetch');
  }) as unknown as typeof fetch);
});

afterEach(() => vi.unstubAllGlobals());

const markupProps = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'story1',
  editId: 'edit_1',
  format: 'markup',
  title: 'doc',
  source: '<Helmet><title>doc</title></Helmet><p>Hello</p>',
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

describe('markup view mode is the sandboxed /raw iframe', () => {
  it('renders the document iframe, sandboxed, pointed at /raw', () => {
    render(<ArtifactSurface {...markupProps()} />);
    const frame = screen.getByTitle('artifact');
    expect(frame).toHaveAttribute('src', '/a/story1/raw');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('does not mount the story engine in view mode', () => {
    render(<ArtifactSurface {...markupProps()} />);
    expect(screen.queryByLabelText('Story canvas')).not.toBeInTheDocument();
  });

  it('owner keeps the edit affordance on markup docs', () => {
    render(
      <ArtifactShell role="owner">
        <ArtifactSurface {...markupProps({})} />
      </ArtifactShell>,
    );
    fireEvent.click(screen.getByLabelText('Open artifact controls'));
    expect(screen.getByLabelText('Edit artifact')).toBeInTheDocument();
  });

  it('readers get no edit button', () => {
    render(<ArtifactSurface {...markupProps()} />);
    expect(screen.queryByLabelText('Edit artifact')).not.toBeInTheDocument();
  });

  it('allows fullscreen so a deck can present from inside the frame', () => {
    render(<ArtifactSurface {...markupProps()} />);
    expect(screen.getByTitle('artifact')).toHaveAttribute('allow', expect.stringContaining('fullscreen'));
  });

  /**
   * The document announces its paint in a burst that stops after ~3s, and the
   * `onLoad` belt only catches a load that happens AFTER hydration attached
   * it. A page that hydrates late misses both, and the reader is then left on
   * the loader with a live document hidden behind it. So the page ASKS,
   * repeatedly, until it is told.
   */
  it('asks the frame whether it has painted, and reveals it on the answer', () => {
    vi.useFakeTimers();
    try {
      render(<ArtifactSurface {...markupProps()} />);
      const frame = screen.getByTitle('artifact') as HTMLIFrameElement;
      const post = vi.fn();
      Object.defineProperty(frame.contentWindow, 'postMessage', { value: post, configurable: true });

      act(() => { vi.advanceTimersByTime(1000); });
      expect(post).toHaveBeenCalledWith('mx:hello', '*');

      // The answer comes from the frame itself — identity is the source window.
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', { data: 'mx:painted', source: frame.contentWindow }),
        );
      });
      expect(frame.className).toContain('opacity-100');
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * And if the document never answers at all (it is not ours to trust), the
   * frame is revealed anyway rather than leaving a live document invisible.
   */
  it('reveals the frame even if nothing ever answers', () => {
    vi.useFakeTimers();
    try {
      render(<ArtifactSurface {...markupProps()} />);
      const frame = screen.getByTitle('artifact');
      expect(frame.className).toContain('opacity-0');
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByTitle('artifact').className).toContain('opacity-100');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a capture render asks for the chrome-less document and PASSES THE KEY DOWN', () => {
    // The exporter is the only caller that loads the page with ?key= — it
    // screenshots this frame, so the rail/present bar must not be in it.
    //
    // The key has to ride along, and it arrives as a PROP rather than being
    // read from the URL: this frame's request is its own (no session, no page
    // query), and it is made on the FIRST paint. Read from `window`, the key
    // was necessarily absent during SSR, the browser fetched the unkeyed URL,
    // and a private document 404'd inside the frame — the export then
    // photographed a transparent frame over the page's ground.
    render(<ArtifactSurface {...markupProps({ captureKey: 'signed-export-key' })} />);
    expect(screen.getByTitle('artifact')).toHaveAttribute('src', '/a/story1/raw?chrome=0&key=signed-export-key');
  });

  it('a human render carries no key and keeps the document\'s own chrome', () => {
    render(<ArtifactSurface {...markupProps()} />);
    expect(screen.getByTitle('artifact')).toHaveAttribute('src', '/a/story1/raw');
  });
});
