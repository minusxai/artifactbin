/**
 * The document frame must be re-verified when the reader COMES BACK.
 *
 * Revealing the frame used to be a one-way latch: once `mx:painted` arrived the
 * page took down its loader and painted the frame opaque white over the
 * viewport, and nothing ever asked again. That frame is sandboxed with
 * no `allow-same-origin`, so it is opaque-origin and Chrome site-isolates it
 * into its own renderer — exactly the process a backgrounded tab loses first
 * under memory pressure. A reclaimed frame is not reloaded by the browser, so
 * the reader returned to a blank white page with no text and no way out but a
 * refresh.
 *
 * The document answers `mx:hello` for as long as it is alive (lib/story/document
 * .ts), so asking IS the liveness test: ask on the way back in, and a frame that
 * does not answer gets remounted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';


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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'story1',
  editId: 'edit_1',
  format: 'markup',
  title: 'doc',
  source: '<p>Hello</p>',
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

const frame = () => screen.getByTitle('artifact') as HTMLIFrameElement;

/** Answer as the frame itself — identity is the SOURCE window, never the origin. */
const paint = (el: HTMLIFrameElement) => {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: 'mx:painted', source: el.contentWindow }));
  });
};

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

/** Reveal the frame the way a healthy document does, and hand back its element. */
const renderRevealed = () => {
  render(<ArtifactSurface {...props()} />);
  const el = frame();
  paint(el);
  expect(el.className).toContain('opacity-100');
  return el;
};

describe('the document frame is re-verified on the way back in', () => {
  it('remounts a frame that no longer answers after the tab was hidden', () => {
    vi.useFakeTimers();
    const before = renderRevealed();
    // Nothing is listening inside a dead frame, so the hello goes unanswered.
    Object.defineProperty(before.contentWindow, 'postMessage', { value: vi.fn(), configurable: true });

    setVisibility('hidden');
    setVisibility('visible');
    act(() => { vi.advanceTimersByTime(3000); });

    const after = frame();
    expect(after).not.toBe(before); // a new element == a new document, refetched
    // ...and the reader sees a loader meanwhile, rather than the white
    // rectangle the dead frame was painting.
    expect(after.className).toContain('opacity-0');
    expect(screen.getByLabelText('Loading document')).toBeInTheDocument();
  });

  it('leaves a frame that ANSWERS exactly where it is', () => {
    vi.useFakeTimers();
    const before = renderRevealed();
    // A live document replies to every hello, for as long as it is alive.
    Object.defineProperty(before.contentWindow, 'postMessage', {
      value: (data: unknown) => { if (data === 'mx:hello') paint(before); },
      configurable: true,
    });

    setVisibility('hidden');
    setVisibility('visible');
    act(() => { vi.advanceTimersByTime(3000); });

    expect(frame()).toBe(before);
    expect(before.className).toContain('opacity-100');
    expect(screen.queryByLabelText('Loading document')).not.toBeInTheDocument();
  });

  it('asks on the way back in — it does not wait for the frame to volunteer', () => {
    vi.useFakeTimers();
    const el = renderRevealed();
    const post = vi.fn();
    Object.defineProperty(el.contentWindow, 'postMessage', { value: post, configurable: true });

    setVisibility('hidden');
    setVisibility('visible');

    expect(post).toHaveBeenCalledWith('mx:hello', '*');
  });

  /**
   * Before the first reveal the ASK LOOP already owns the frame (20 tries, then
   * it reveals anyway). A visibility flip in that window must not cut across it
   * and throw away a frame that is merely still loading.
   */
  it('does not touch a frame that has never been revealed', () => {
    vi.useFakeTimers();
    render(<ArtifactSurface {...props()} />);
    const before = frame();

    setVisibility('hidden');
    setVisibility('visible');
    act(() => { vi.advanceTimersByTime(3000); });

    expect(frame()).toBe(before);
  });

  /**
   * A bfcache restore is the same question asked by a different event: the page
   * comes back whole, but nothing guarantees the frame's process did.
   */
  it('re-verifies on a bfcache restore too', () => {
    vi.useFakeTimers();
    const before = renderRevealed();
    Object.defineProperty(before.contentWindow, 'postMessage', { value: vi.fn(), configurable: true });

    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    act(() => { vi.advanceTimersByTime(3000); });

    expect(frame()).not.toBe(before);
  });
});
