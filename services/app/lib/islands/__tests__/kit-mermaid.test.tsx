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

beforeEach(() => { engine.renderMermaid.mockClear(); drawCode.loaded = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('Mermaid, drawn by the reader', () => {
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
