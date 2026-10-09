/* @jsxImportSource solid-js */
/**
 * THE MERMAID PORT (lib/islands/kit/mermaid) against the retired React Mermaid, both
 * MOUNTED in the document with the same engine stub: the palette reaches Mermaid as hex through the
 * canvas (a theme token such as `oklch(...)` makes Mermaid throw), the figure carries the same marks
 * for the harvest, the image the same inline style, and `ready` waits for the image to load. A stored
 * drawing is served as React serves it and never loads the drawing code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Mermaid } from '../kit/mermaid';
import { mermaidImageKey } from '@/lib/jsx/mermaid-source';
import type { MermaidPalette } from '@/lib/mermaid-images/mermaid-render';

const engine = vi.hoisted(() => ({ renderMermaid: vi.fn(async (_code: string, _palette: MermaidPalette) => ({ src: 'data:image/svg+xml,engine', type: 'flowchart-v2', width: 812.5, height: 90 })) }));
vi.mock('@/lib/mermaid-images/mermaid-render', () => engine);
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
  it('uses the dark page before the island host is mounted, even when compiled props began light', async () => {
    const host = themed();
    host.setAttribute('data-mx-inline-story', '');
    host.classList.add('dark');
    const island = fakeIsland();
    island.drawings = () => ({ ...stored, [mermaidImageKey(CODE, 'dark')]: { ...stored[mermaidImageKey(CODE, 'light')], src: '/assets/mermaid/dark.svg' } }) as never;
    const dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
    try {
      await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/dark.svg'));
      expect(engine.renderMermaid).not.toHaveBeenCalled();
    } finally { dispose(); host.remove(); }
  });
  it('switches to the matching stored drawing when the reader changes colour', async () => {
    const host = themed();
    host.setAttribute('data-mx-inline-story', '');
    host.classList.add('light');
    const island = fakeIsland();
    island.drawings = () => ({ ...stored, [mermaidImageKey(CODE, 'dark')]: { ...stored[mermaidImageKey(CODE, 'light')], src: '/assets/mermaid/dark.svg' } }) as never;
    const dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, host);
    try {
      expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/abc.svg');
      host.classList.replace('light', 'dark');
      await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/dark.svg'));
      expect(engine.renderMermaid).not.toHaveBeenCalled();
    } finally { dispose(); host.remove(); }
  });
  it('tracks the story root when hydration begins in a detached mount', async () => {
    const story = themed();
    story.setAttribute('data-mx-inline-story', '');
    story.classList.add('light');
    const mount = document.createElement('div');
    const island = fakeIsland();
    island.drawings = () => ({ ...stored, [mermaidImageKey(CODE, 'dark')]: { ...stored[mermaidImageKey(CODE, 'light')], src: '/assets/mermaid/dark.svg' } }) as never;
    const dispose = render(() => <IslandProvider value={island}><Mermaid code={CODE} colorMode="light" /></IslandProvider>, mount);
    try {
      await Promise.resolve();
      story.append(mount);
      story.classList.replace('light', 'dark');
      await vi.waitFor(() => expect(story.querySelector('img')?.getAttribute('src')).toBe('/assets/mermaid/dark.svg'));
      expect(engine.renderMermaid).not.toHaveBeenCalled();
    } finally { dispose(); story.remove(); }
  });

});
