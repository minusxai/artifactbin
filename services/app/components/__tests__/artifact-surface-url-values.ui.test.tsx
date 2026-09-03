/**
 * F2, the OWNER'S PAGE half — the address bar follows the reader's picks even
 * when the document is FRAMED.
 *
 * Measured on the spike: an owner is served the SHELL, so the document's own
 * `__mxValues` rewrites the FRAME's url (`/a/<id>/raw?edit=1&$x=1`) and the
 * address bar never moves. So the framed document reports its selection up the
 * signed channel and the PAGE writes the address — and the page re-derives
 * what it writes through `writeUrlValues` against the flow it holds, because
 * the frame is sandboxed markup and never an authority.
 *
 * The other half is the iframe `src`, and it is a trap rather than a feature:
 * the frame must be SEEDED with the link's selection once and then never
 * again. Re-applying the live address to `src` navigates the frame, which is a
 * full document reload — every chart rebuilt, the reader's place gone — once
 * per pick, and it would look perfectly correct in a browser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import { STORY_SESSION_MESSAGE, STORY_VALUES_MESSAGE } from '@/lib/story-runtime/contract';
import { declarationsOf } from '@/lib/artifacts';

const NONCE = 'nonce0123456789abcdef';
const SOURCE = '<Helmet><Value name="region" type="string" default="north" /><Value name="top" type="number" default={10} /></Helmet><div>hi</div>';
const FLOW = declarationsOf(SOURCE)!;

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch);
  window.history.replaceState(null, '', '/a/story1');
});
afterEach(() => { vi.unstubAllGlobals(); });

const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'story1', editId: 'edit_1', format: 'markup', title: 'doc', source: SOURCE, template: null, refs: [],
  version: 1, content: '', columns: [], compiledCss: null, theme: null, colorMode: null,
  dataflow: { flow: FLOW },
  ...over,
});

const frame = () => screen.getByTitle('artifact') as HTMLIFrameElement;

/**
 * The nonce announcement is the trust root and the page takes it only from a
 * REAL event; `dispatchEvent` stamps isTrusted false, so the implementation
 * object is flipped mid-dispatch (the pattern artifact-owner-chrome uses).
 */
const trusted = new WeakSet<Event>();
const trustFirst = (event: Event) => {
  if (!trusted.has(event)) return;
  for (const key of Object.getOwnPropertySymbols(event)) {
    const impl = (event as unknown as Record<symbol, { isTrusted?: boolean }>)[key];
    if (impl && typeof impl === 'object' && 'isTrusted' in impl) impl.isTrusted = true;
  }
};
beforeEach(() => window.addEventListener('message', trustFirst));
afterEach(() => window.removeEventListener('message', trustFirst));

const announce = (win: Window) => act(() => {
  const event = new MessageEvent('message', { data: { type: STORY_SESSION_MESSAGE, nonce: NONCE }, source: win as unknown as MessageEventSource });
  trusted.add(event);
  window.dispatchEvent(event);
});

const picked = (win: Window, values: Record<string, unknown>, nonce = NONCE) => act(() => {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: STORY_VALUES_MESSAGE, nonce, values },
    source: win as unknown as MessageEventSource,
  }));
});

describe('the iframe src carries the link\'s selection', () => {
  it('forwards the page\'s $ params — and only those — into the document it frames', () => {
    render(<ArtifactSurface {...props({ search: '?$region=west&v=2&key=nope' })} />);
    const src = frame().getAttribute('src')!;
    expect(src).toContain('$region=west');
    expect(src).not.toContain('v=2');
    expect(src).not.toContain('key=nope');
  });

  it('adds nothing when the link names no selection', () => {
    render(<ArtifactSurface {...props({ search: '?v=2' })} />);
    expect(frame().getAttribute('src')).toBe('/a/story1/raw');
  });

  it('does NOT re-navigate the frame when the address follows a pick', () => {
    render(<ArtifactSurface {...props({ search: '?$region=west' })} />);
    const before = frame();
    const src = before.getAttribute('src');
    const win = before.contentWindow!;
    announce(win);
    picked(win, { region: 'south' });
    expect(window.location.search).toBe('?$region=south');
    // Same element, same src: a src write is a full document reload.
    expect(frame()).toBe(before);
    expect(frame().getAttribute('src')).toBe(src);
  });
});

describe('mx:values from the framed document', () => {
  it('rewrites the address, keeping every other param and the hash', () => {
    window.history.replaceState(null, '', '/a/story1?v=2#section-3');
    render(<ArtifactSurface {...props({ search: '?v=2' })} />);
    const win = frame().contentWindow!;
    announce(win);
    picked(win, { region: 'south', top: 10 });
    // `top` is at its declared default, so it is not in the link at all.
    expect(window.location.search).toBe('?v=2&$region=south');
    expect(window.location.hash).toBe('#section-3');
    expect(window.location.pathname).toBe('/a/story1');
  });

  it('drops a param that returned to its default, and writes an explicit "All" as an empty value', () => {
    window.history.replaceState(null, '', '/a/story1?$region=south');
    render(<ArtifactSurface {...props({ search: '?$region=south' })} />);
    const win = frame().contentWindow!;
    announce(win);
    picked(win, { region: 'north' });
    expect(window.location.search).toBe('');
    picked(win, { region: null });
    expect(window.location.search).toBe('?$region=');
  });

  it('re-derives what it writes: a name the document does not declare never reaches the address', () => {
    render(<ArtifactSurface {...props()} />);
    const win = frame().contentWindow!;
    announce(win);
    picked(win, { region: 'south', nope: 'x' });
    expect(window.location.search).toBe('?$region=south');
  });

  it('ignores an unsigned message and one from a window that is not the frame', () => {
    render(<ArtifactSurface {...props()} />);
    const win = frame().contentWindow!;
    announce(win);
    picked(win, { region: 'south' }, 'not-the-nonce');
    expect(window.location.search).toBe('');
    const stranger = document.createElement('iframe');
    document.body.appendChild(stranger);
    picked(stranger.contentWindow!, { region: 'south' });
    expect(window.location.search).toBe('');
  });

  it('is a replaceState, never a push — a pick is not a navigation', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<ArtifactSurface {...props()} />);
    const win = frame().contentWindow!;
    announce(win);
    picked(win, { region: 'south' });
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
