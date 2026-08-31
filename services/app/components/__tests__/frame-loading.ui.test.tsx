/**
 * What the page shows while the document's frame loads: a loading indicator on
 * the document's own ground, and NOTHING of the document itself.
 *
 * The page used to carry a server-rendered copy of the document's markup
 * (`renderStoryStaticBody`) to paint under the frame. It existed for crawlers,
 * and crawlers stopped reaching this page when readers started getting the
 * document top-level (proxy.ts) — only owners and a private document's invited
 * readers see the shell, and for them a loader is fine. Removing it also takes
 * agent-authored markup out of the app's own origin on page load: the frame is
 * the ONE place the document renders here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';


import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';

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
});

const PHRASE = 'a sentence only the document carries';

const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'story1',
  editId: 'edit_1',
  format: 'markup',
  title: 'doc',
  source: `<p>${PHRASE}</p>`,
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
const loader = () => screen.queryByLabelText('Loading document');

/** Answer as the frame itself — identity is the SOURCE window, never the origin. */
const paint = () => act(() => {
  window.dispatchEvent(new MessageEvent('message', { data: 'mx:painted', source: frame().contentWindow }));
});

describe('while the document frame loads', () => {
  it('shows a loading indicator, and takes it down once the document has painted', () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    expect(loader()).not.toBeNull();
    expect(frame().className).toContain('opacity-0');

    paint();
    expect(loader()).toBeNull();
    expect(frame().className).toContain('opacity-100');
  });

  it("never puts the document's own markup in the page — the frame is the one place it renders", () => {
    const { container } = render(<ArtifactShell role="owner"><ArtifactSurface {...props()} /></ArtifactShell>);
    expect(screen.queryByText(PHRASE)).toBeNull();
    expect(container.innerHTML).not.toContain(PHRASE);
    expect(screen.queryByLabelText('Document text')).toBeNull();
  });

  it('sits the loader on the document\'s own ground, not the app\'s', () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props({ colorMode: 'dark' })} /></ArtifactShell>);
    const viewport = screen.getByLabelText('Artifact viewport');
    expect(viewport.getAttribute('style') ?? '').toMatch(/background/);
    expect(viewport.contains(loader())).toBe(true);
  });
});
