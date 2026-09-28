/* @jsxImportSource solid-js */
/**
 * THE MERMAID PORT (lib/islands/kit/mermaid) against today's React Mermaid (components/kit/mermaid), both
 * MOUNTED in the document with the same engine stub: the palette reaches Mermaid as hex through the
 * canvas (a theme token such as `oklch(...)` makes Mermaid throw), the figure carries the same marks
 * for the harvest, the image the same inline style, and `ready` waits for the image to load. A stored
 * drawing is served as React serves it and never loads the drawing code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { diffShapes, shapeOf } from './kit-parity';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Mermaid } from '../kit/mermaid';
import { Mermaid as ReactMermaid } from '@/components/kit/mermaid';
import { mermaidImageKey } from '@/lib/story-ui/mermaid-source';
import type { MermaidPalette } from '@/components/kit/mermaid-render';

const engine = vi.hoisted(() => ({ renderMermaid: vi.fn(async (_code: string, _palette: MermaidPalette) => ({ src: 'data:image/svg+xml,engine', type: 'flowchart-v2', width: 812.5, height: 90 })) }));
vi.mock('@/components/kit/mermaid-render', () => engine);
const drawCode = vi.hoisted(() => ({ loaded: 0 }));
vi.mock('@/lib/mermaid-images/reader-draw', async (original) => { drawCode.loaded++; return await original(); });

const CODE = 'flowchart LR\n  A --> B';
/** A canvas that resolves every colour to #102030, as a browser resolves `oklch(...)` to its sRGB bytes. */
const fakeCanvas = () => vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
  clearRect() {}, fillRect() {}, fillStyle: '', getImageData: () => ({ data: new Uint8ClampedArray([16, 32, 48, 255]) }),
}) as unknown as RenderingContext);

const themed = () => {
  const theme = document.createElement('div');
  theme.setAttribute('style', '--background: oklch(1 0 0); --foreground: oklch(0.141 0.005 285.823); --primary: oklch(0.21 0.006 285.885)');
  document.body.append(theme);
  return theme;
};
async function mountBoth(drawings: Record<string, unknown> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const react = themed();
  const root = createRoot(react);
  const { MermaidImagesProvider } = await import('@/components/kit/mermaid');
  await act(async () => { root.render(createElement(MermaidImagesProvider, { value: drawings as never }, createElement(ReactMermaid, { code: CODE, colorMode: 'light', id: 'm' }))); });
  const solid = themed();
  const island = fakeIsland();
  island.drawings = () => drawings as never;
  let dispose!: () => void;
  await act(async () => { dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" id="m" /></IslandProvider>, solid); });
  // Both sides draw asynchronously (a dynamic import, then the engine): settle until neither is still drawing.
  const drawing = () => [react, solid].some((host) => host.querySelector('[role="status"]'));
  const settle = async () => { await vi.waitFor(() => { if (drawing()) throw new Error('still drawing'); }, { timeout: 5000 }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  return {
    react, solid, settle,
    load: async () => { for (const host of [react, solid]) host.querySelector('img')?.dispatchEvent(new Event('load')); await settle(); },
    cleanup: async () => { await act(async () => root.unmount()); dispose(); react.remove(); solid.remove(); },
  };
}

beforeEach(() => { document.documentElement.setAttribute('data-mx-ready', ''); engine.renderMermaid.mockClear(); drawCode.loaded = 0; });
afterEach(() => { document.documentElement.removeAttribute('data-mx-ready'); vi.restoreAllMocks(); });

describe('Mermaid, drawn by the reader', () => {
  it('reads the document mode while a compiled island is mounted detached', async () => {
    fakeCanvas();
    document.documentElement.classList.add('dark');
    const host = document.createElement('div');
    const island = fakeIsland();
    let dispose!: () => void;
    try {
      dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
      await vi.waitFor(() => expect(engine.renderMermaid).toHaveBeenCalled());
      expect(engine.renderMermaid.mock.calls[0]?.[1].dark).toBe(true);
    } finally { dispose?.(); document.documentElement.classList.remove('dark'); }
  });
  it('redraws after a detached island joins a themed story root', async () => {
    fakeCanvas();
    const root = themed();
    root.classList.add('dark');
    const host = document.createElement('div');
    const island = fakeIsland();
    let dispose!: () => void;
    try {
      dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
      await vi.waitFor(() => expect(engine.renderMermaid).toHaveBeenCalled());
      root.append(host);
      await vi.waitFor(() => expect(engine.renderMermaid.mock.calls.at(-1)?.[1].dark).toBe(true));
    } finally { dispose?.(); root.remove(); }
  });
  it('waits for a per-visit mode override before the first engine draw', async () => {
    fakeCanvas();
    document.documentElement.setAttribute('data-mx-reader-mode', 'dark');
    const host = themed();
    host.classList.add('light');
    const island = fakeIsland();
    let dispose!: () => void;
    try {
      dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(engine.renderMermaid).not.toHaveBeenCalled();
      host.classList.replace('light', 'dark');
      await vi.waitFor(() => expect(engine.renderMermaid.mock.calls.at(-1)?.[1].dark).toBe(true));
      expect(engine.renderMermaid).toHaveBeenCalledTimes(1);
    } finally { dispose?.(); host.remove(); document.documentElement.removeAttribute('data-mx-reader-mode'); }
  });
  it('uses the live reader mode after the document theme changes', async () => {
    fakeCanvas();
    const host = themed();
    const island = fakeIsland();
    let dispose!: () => void;
    try {
      dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
      await vi.waitFor(() => expect(engine.renderMermaid).toHaveBeenCalled());
      host.classList.add('dark');
      await vi.waitFor(() => expect(engine.renderMermaid.mock.calls.at(-1)?.[1].dark).toBe(true));
    } finally { dispose?.(); host.remove(); }
  });
  it('hands Mermaid the theme as hex, resolved through the canvas as React does', async () => {
    fakeCanvas();
    const both = await mountBoth();
    try {
      expect(engine.renderMermaid).toHaveBeenCalledTimes(2);
      const [reactPalette, solidPalette] = engine.renderMermaid.mock.calls.map((c) => c[1]);
      expect(solidPalette).toEqual(reactPalette);
      expect(solidPalette!.background).toBe('#102030');
      expect(Object.values(solidPalette!).filter((v) => typeof v === 'string' && v.includes('oklch'))).toEqual([]);
    } finally { await both.cleanup(); }
  });

  it('marks the figure and styles the image as React does, and is ready only once the image has loaded', async () => {
    fakeCanvas();
    const both = await mountBoth();
    try {
      expect(both.solid.querySelector('figure')?.getAttribute('data-mx-mermaid-state')).toBe('pending');
      await both.load();
      expect(diffShapes(shapeOf(both.react), shapeOf(both.solid))).toEqual([]);
      const figure = both.solid.querySelector('figure')!;
      expect(figure.getAttribute('data-mx-mermaid-state')).toBe('ready');
      expect(figure.getAttribute('data-mx-mermaid-key')).toBe(mermaidImageKey(CODE, 'light'));
      expect(figure.getAttribute('data-mx-mermaid-palette')).toMatch(/^[0-9a-f]{32}$/);
      expect(figure.getAttribute('data-mx-mermaid-palette')).toBe(both.react.querySelector('figure')?.getAttribute('data-mx-mermaid-palette'));
      // Byte for byte: React writes a client-rendered image's style through the CSSOM.
      expect(both.solid.querySelector('img')?.getAttribute('style')).toBe(both.react.querySelector('img')?.getAttribute('style'));
      expect(both.solid.querySelector('img')?.getAttribute('style')).toMatch(/^width: 812\.5px; max-width: 100%; height: auto;$/);
    } finally { await both.cleanup(); }
  });
});

describe('Mermaid, from a stored drawing', () => {
  const stored = { [mermaidImageKey(CODE, 'light')]: { src: '/assets/mermaid/abc.svg', type: 'flowchart-v2', width: 856.234375, height: 120, palette: 'p' } };
  it('selects the stored image for a persisted reader mode override before the root changes', async () => {
    document.documentElement.setAttribute('data-mx-reader-mode', 'dark');
    const host = themed();
    host.classList.add('light');
    const island = fakeIsland();
    island.drawings = () => ({
      [mermaidImageKey(CODE, 'light')]: { ...stored[mermaidImageKey(CODE, 'light')] },
      [mermaidImageKey(CODE, 'dark')]: { src: '/assets/mermaid/dark.svg', type: 'flowchart-v2', width: 800, height: 110, palette: 'd' },
    }) as never;
    let dispose!: () => void;
    try {
      dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
      await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/dark.svg'));
      host.classList.replace('light', 'dark');
      await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-mx-reader-mode')).toBe(false));
      host.classList.replace('dark', 'light');
      await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/abc.svg'));
    } finally { dispose?.(); host.remove(); document.documentElement.removeAttribute('data-mx-reader-mode'); }
  });
  it('switches stored images with the reader mode', async () => {
    const host = themed();
    host.classList.add('light');
    const island = fakeIsland();
    island.drawings = () => ({
      [mermaidImageKey(CODE, 'light')]: { ...stored[mermaidImageKey(CODE, 'light')] },
      [mermaidImageKey(CODE, 'dark')]: { src: '/assets/mermaid/dark.svg', type: 'flowchart-v2', width: 800, height: 110, palette: 'd' },
    }) as never;
    let dispose!: () => void;
    try {
      dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
      expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/abc.svg');
      host.classList.replace('light', 'dark');
      await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/dark.svg'));
    } finally { dispose?.(); host.remove(); }
  });
  it('selects the dark stored image on first mount inside a dark story', async () => {
    const host = themed();
    host.classList.add('dark');
    const island = fakeIsland();
    island.drawings = () => ({
      [mermaidImageKey(CODE, 'light')]: { ...stored[mermaidImageKey(CODE, 'light')] },
      [mermaidImageKey(CODE, 'dark')]: { src: '/assets/mermaid/dark.svg', type: 'flowchart-v2', width: 800, height: 110, palette: 'd' },
    }) as never;
    let dispose!: () => void;
    try {
      dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
      await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/dark.svg'));
    } finally { dispose?.(); host.remove(); }
  });
  it('uses the story root mode when a nested author element has a mode class', async () => {
    const story = themed();
    story.setAttribute('data-mx-inline-story', '');
    story.classList.add('dark');
    const nested = document.createElement('div');
    nested.classList.add('light');
    story.append(nested);
    const island = fakeIsland();
    island.drawings = () => ({
      [mermaidImageKey(CODE, 'light')]: { ...stored[mermaidImageKey(CODE, 'light')] },
      [mermaidImageKey(CODE, 'dark')]: { src: '/assets/mermaid/dark.svg', type: 'flowchart-v2', width: 800, height: 110, palette: 'd' },
    }) as never;
    let dispose!: () => void;
    try {
      dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, nested);
      await vi.waitFor(() => expect(nested.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/dark.svg'));
    } finally { dispose?.(); story.remove(); }
  });
  it('serves the stored image as React does, never loads the drawing code, and is ready once it loads', async () => {
    const both = await mountBoth(stored);
    try {
      expect(engine.renderMermaid).not.toHaveBeenCalled();
      expect(drawCode.loaded).toBe(0);
      const img = both.solid.querySelector('img')!;
      expect(img.getAttribute('src')).toBe('/assets/mermaid/abc.svg');
      // The server's string, as React's server renderer writes it (and hydration leaves it).
      expect(img.getAttribute('style')).toBe('width:856.234375px;max-width:100%;height:auto');
      expect(both.solid.querySelector('figure')?.getAttribute('data-mx-mermaid-state')).toBe('pending');
      await both.load();
      expect(both.solid.querySelector('figure')?.getAttribute('data-mx-mermaid-state')).toBe('ready');
      expect(diffShapes(shapeOf(both.react), shapeOf(both.solid))).toEqual([]);
    } finally { await both.cleanup(); }
  });

  it('draws with the engine when the stored bytes will not load', async () => {
    fakeCanvas();
    const both = await mountBoth(stored);
    try {
      for (const host of [both.react, both.solid]) host.querySelector('img')?.dispatchEvent(new Event('error'));
      await both.settle();
      expect(engine.renderMermaid).toHaveBeenCalledTimes(2);
      expect(both.solid.querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,engine');
    } finally { await both.cleanup(); }
  });
});
