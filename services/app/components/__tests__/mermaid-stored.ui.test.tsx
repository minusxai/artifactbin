/**
 * A stored drawing in the reader (components/kit/mermaid): hydrates without a
 * mismatch, is kept while the reader's palette key is the one it was drawn
 * under — including across a colour-mode switch, which picks the other stored
 * variant — and gives way to the engine when its bytes will not load.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CSSProperties } from 'react';
import { Mermaid, MermaidImagesProvider } from '../kit/mermaid';
import { mermaidImageKey } from '@/lib/story-ui/mermaid-source';
import { parseMermaidMetrics, type MermaidMetrics } from '@/lib/mermaid-images/match';

const { renderMermaid } = vi.hoisted(() => ({ renderMermaid: vi.fn() }));
vi.mock('../kit/mermaid-render', () => ({ renderMermaid }));
beforeEach(() => {
  renderMermaid.mockReset();
  renderMermaid.mockResolvedValue({ src: 'data:image/svg+xml,engine', type: 'flowchart-v2', width: 10, height: 10 });
});
afterEach(() => vi.restoreAllMocks());

const CODE = 'flowchart TD\n  a --> b';

/** The palette key this (jsdom) reader computes: what the engine-drawn figure reports. */
async function readersPaletteKey(mode: 'light' | 'dark' = 'light'): Promise<string> {
  const { container, unmount } = render(<Mermaid code={CODE} colorMode={mode} />);
  await waitFor(() => expect(container.querySelector('figure')).toHaveAttribute('data-mx-mermaid-palette'));
  const key = container.querySelector('figure')!.getAttribute('data-mx-mermaid-palette')!;
  expect(container.querySelector('figure')).toHaveAttribute('data-mx-mermaid-key', mermaidImageKey(CODE, mode));
  unmount();
  renderMermaid.mockClear();
  return key;
}

/** Each mode's drawing records the palette it was drawn under (the dark palette is another key). */
const stored = (light: string, dark = light) => ({
  [mermaidImageKey(CODE, 'light')]: { src: '/assets/mermaid/light.svg', type: 'flowchart-v2', width: 120, height: 80, palette: light },
  [mermaidImageKey(CODE, 'dark')]: { src: '/assets/mermaid/dark.svg', type: 'flowchart-v2', width: 120, height: 80, palette: dark },
});

describe('a stored Mermaid drawing', () => {
  it('hydrates the server render without a mismatch and loads no engine when the palette is the reader\'s', async () => {
    const images = stored(await readersPaletteKey());
    const tree = <MermaidImagesProvider value={images}><Mermaid code={CODE} title="Flow" /></MermaidImagesProvider>;
    const host = document.createElement('div');
    host.innerHTML = renderToString(tree);
    document.body.appendChild(host);
    const onRecoverableError = vi.fn();
    await act(async () => { hydrateRoot(host, tree, { onRecoverableError }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(host.querySelector('img')).toHaveAttribute('src', '/assets/mermaid/light.svg');
    fireEvent.load(host.querySelector('img')!);
    expect(host.querySelector('figure')).toHaveAttribute('data-mx-mermaid-state', 'ready');
    // Drawn from storage, so nothing marks it for the harvest.
    expect(host.querySelector('figure')).not.toHaveAttribute('data-mx-mermaid-palette');
    expect(renderMermaid).not.toHaveBeenCalled();
    host.remove();
  });

  it('switches colour mode to the other stored drawing, still without the engine', async () => {
    const images = stored(await readersPaletteKey('light'), await readersPaletteKey('dark'));
    expect(images[mermaidImageKey(CODE, 'light')]!.palette).not.toBe(images[mermaidImageKey(CODE, 'dark')]!.palette);
    const { rerender } = render(<MermaidImagesProvider value={images}><Mermaid code={CODE} title="Flow" colorMode="light" /></MermaidImagesProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    rerender(<MermaidImagesProvider value={images}><Mermaid code={CODE} title="Flow" colorMode="dark" /></MermaidImagesProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByRole('img', { name: 'Flow' })).toHaveAttribute('src', '/assets/mermaid/dark.svg');
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it('keeps showing the stored drawing while the engine redraws for a different palette, then shows the engine\'s', async () => {
    let finish!: (value: unknown) => void;
    renderMermaid.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<MermaidImagesProvider value={stored('another-palette')}><Mermaid code={CODE} title="Flow" /></MermaidImagesProvider>);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('img', { name: 'Flow' })).toHaveAttribute('src', '/assets/mermaid/light.svg');
    await act(async () => finish({ src: 'data:image/svg+xml,engine', type: 'flowchart-v2' }));
    expect(screen.getByRole('img', { name: 'Flow' })).toHaveAttribute('src', 'data:image/svg+xml,engine');
  });

  it('the engine measures only once the palette\'s faces have loaded', async () => {
    let release!: () => void;
    const face = new Promise<FontFace[]>((resolve) => { release = () => resolve([]); });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn(() => face), ready: Promise.resolve() } });
    try {
      render(<Mermaid code={CODE} title="Flow" />);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      expect(renderMermaid).not.toHaveBeenCalled();
      await act(async () => { release(); });
      await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it('an engine drawing whose fonts changed while it was drawn carries no palette, so it is never harvested', async () => {
    // Each measurement of the faces answers a wider box: a web face landing mid-draw.
    let width = 100;
    Object.defineProperty(window.SVGElement.prototype, 'getBBox', { configurable: true, value: () => ({ x: 0, y: -16, width: width++, height: 20 }) });
    try {
      const { container } = render(<Mermaid code={CODE} title="Flow" />);
      await waitFor(() => expect(screen.getByRole('img', { name: 'Flow' })).toHaveAttribute('src', 'data:image/svg+xml,engine'));
      expect(container.querySelector('figure')).not.toHaveAttribute('data-mx-mermaid-palette');
      expect(container.querySelector('figure')).not.toHaveAttribute('data-mx-mermaid-key');
    } finally {
      delete (window.SVGElement.prototype as unknown as { getBBox?: unknown }).getBBox;
    }
  });

  it('asks for the palette\'s own faces before judging a stored drawing', async () => {
    const load = vi.fn(async (_font: string, _text?: string) => [] as FontFace[]);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load, ready: Promise.resolve() } });
    try {
      const images = stored(await readersPaletteKey());
      // The engine asked for the same faces before it measured; now the stored drawing's check.
      load.mockClear();
      render(<MermaidImagesProvider value={images}><Mermaid code={CODE} title="Flow" /></MermaidImagesProvider>);
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      expect(load.mock.calls.map(([font]) => font)).toEqual([expect.stringMatching(/^\d+px /), expect.stringMatching(/^11px /)]);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(renderMermaid).not.toHaveBeenCalled();
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it('gives way to the engine when its bytes will not load', async () => {
    const images = stored(await readersPaletteKey());
    render(<MermaidImagesProvider value={images}><Mermaid code={CODE} title="Flow" /></MermaidImagesProvider>);
    fireEvent.error(screen.getByRole('img', { name: 'Flow' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Flow' })).toHaveAttribute('src', 'data:image/svg+xml,engine'));
    expect(renderMermaid).toHaveBeenCalledTimes(1);
  });
});

/**
 * THE DECISION ACROSS PLATFORMS, with the measurements injected: jsdom lays
 * nothing out, so each SVG text box the component asks for (`getBBox`, what
 * Mermaid itself measures a label with) answers what a real browser measured
 * for the label face (16px) and the edge-label face (11px) on production's
 * /a/HlRZLD (lib/mermaid-images/__tests__/match has the sources).
 */
const HARVEST_UNHINTED: MermaidMetrics = [855.9375, 20, -16, 646.796875, 14, -11];
const MACOS_BLINK: MermaidMetrics = [855.9375, 20, -16, 646.8125, 14, -11];
const LINUX_HINTED: MermaidMetrics = [851, 20, -16, 686, 14, -11];
const MACOS_WEBKIT: MermaidMetrics = [859.3125, 19.359375, -15.5, 646.8125, 14.546875, -11.234375];

describe('a stored drawing, judged by what Mermaid measures in this browser', () => {
  let faces: MermaidMetrics = HARVEST_UNHINTED;
  const measured: string[] = [];
  beforeEach(() => {
    measured.length = 0;
    Object.defineProperty(window.SVGElement.prototype, 'getBBox', {
      configurable: true,
      value(this: SVGElement) {
        const style = this.getAttribute('style') ?? '';
        measured.push(style);
        const [w, h, y] = /font-size:\s*11px/.test(style) ? faces.slice(3) : faces.slice(0, 3);
        return { x: 0, y, width: w, height: h };
      },
    });
  });
  afterEach(() => { delete (window.SVGElement.prototype as unknown as { getBBox?: unknown }).getBBox; });

  /** What the harvest's page records for the drawing its engine made: the palette key and the measurements. */
  async function harvested(): Promise<{ palette: string; metrics: MermaidMetrics }> {
    faces = HARVEST_UNHINTED;
    const { container, unmount } = render(<Mermaid code={CODE} />);
    await waitFor(() => expect(container.querySelector('figure')).toHaveAttribute('data-mx-mermaid-metrics'));
    const figure = container.querySelector('figure')!;
    const drawn = { palette: figure.getAttribute('data-mx-mermaid-palette')!, metrics: parseMermaidMetrics(figure.getAttribute('data-mx-mermaid-metrics'))! };
    unmount();
    renderMermaid.mockClear();
    return drawn;
  }
  const storedAs = (drawn: { palette: string; metrics: MermaidMetrics }) => ({
    [mermaidImageKey(CODE, 'light')]: { src: '/assets/mermaid/light.svg', type: 'flowchart-v2', width: 120, height: 80, palette: drawn.palette, metrics: [...drawn.metrics] },
  });

  it('the harvest records the faces as Mermaid measures them: SVG text boxes of the label face and the 11px edge-label face', async () => {
    const drawn = await harvested();
    expect(drawn.metrics).toEqual(HARVEST_UNHINTED);
    expect(measured.some((style) => /font-size:\s*11px/.test(style))).toBe(true);
    expect(measured.some((style) => /font-size:\s*1[2-6]px/.test(style))).toBe(true);
  });

  it('a reader whose faces measure as the unhinted harvest\'s (Blink on macOS) keeps the stored drawing and loads no engine', async () => {
    const images = storedAs(await harvested());
    faces = MACOS_BLINK;
    render(<MermaidImagesProvider value={images}><Mermaid code={CODE} title="Flow" /></MermaidImagesProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(screen.getByRole('img', { name: 'Flow' })).toHaveAttribute('src', '/assets/mermaid/light.svg');
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it.each([['hinted Linux (whole-pixel advances)', LINUX_HINTED], ['WebKit (a shorter line box)', MACOS_WEBKIT]])('a reader measuring like %s draws with the engine', async (_name, reader) => {
    const images = storedAs(await harvested());
    faces = reader;
    render(<MermaidImagesProvider value={images}><Mermaid code={CODE} title="Flow" /></MermaidImagesProvider>);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Flow' })).toHaveAttribute('src', 'data:image/svg+xml,engine'));
  });

  it('a drawing stored without measurements is never used by a browser that measures', async () => {
    const { palette } = await harvested();
    faces = HARVEST_UNHINTED;
    render(<MermaidImagesProvider value={{ [mermaidImageKey(CODE, 'light')]: { src: '/assets/mermaid/light.svg', type: 'flowchart-v2', palette } }}><Mermaid code={CODE} title="Flow" /></MermaidImagesProvider>);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
  });
});

describe('a drawing the harvest may store for every reader', () => {
  const WEB_FACES = { fontFamily: 'Inter, ui-sans-serif, sans-serif', '--font-mono': '"JetBrains Mono", ui-monospace, monospace' } as CSSProperties;
  const LATIN = 'U+0000-00FF,U+0131,U+0152-0153';
  function fonts(faces: Array<{ family: string; status: string; unicodeRange: string }>) {
    const load = vi.fn(async (_font: string, _text?: string) => [] as FontFace[]);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load, ready: Promise.resolve(), [Symbol.iterator]: () => faces[Symbol.iterator]() } });
    return load;
  }
  afterEach(() => { delete (document as unknown as { fonts?: unknown }).fonts; });
  const figureOf = async (code: string, style: CSSProperties = WEB_FACES) => {
    const { container } = render(<Mermaid code={code} style={style} />);
    await waitFor(() => expect(container.querySelector('figure')).toHaveAttribute('data-mx-mermaid-palette'));
    return container.querySelector('figure')!;
  };

  it('is drawn entirely in the document\'s loaded web fonts (the same font files on every platform)', async () => {
    fonts([{ family: 'Inter', status: 'loaded', unicodeRange: LATIN }, { family: '"JetBrains Mono"', status: 'loaded', unicodeRange: LATIN }]);
    expect(await figureOf(CODE)).toHaveAttribute('data-mx-mermaid-portable');
  });

  it('names the faces it was drawn in — the label face at its size, the edge-label face — for the server\'s measured table of readers', async () => {
    fonts([{ family: 'Inter', status: 'loaded', unicodeRange: LATIN }, { family: '"JetBrains Mono"', status: 'loaded', unicodeRange: LATIN }]);
    expect(await figureOf(CODE, { ...WEB_FACES, fontSize: '16px' } as CSSProperties)).toHaveAttribute('data-mx-mermaid-faces', 'Inter|16|JetBrains Mono');
  });

  it('is not when a face is a system font, has not loaded, or lacks one of the diagram\'s characters', async () => {
    fonts([{ family: 'Inter', status: 'loaded', unicodeRange: LATIN }, { family: '"JetBrains Mono"', status: 'loaded', unicodeRange: LATIN }]);
    expect(await figureOf(CODE, { fontFamily: 'Georgia, serif', '--font-mono': '"JetBrains Mono", monospace' } as CSSProperties)).not.toHaveAttribute('data-mx-mermaid-portable');
    expect(await figureOf('flowchart TD\n  a[数据] --> b')).not.toHaveAttribute('data-mx-mermaid-portable');
    fonts([{ family: 'Inter', status: 'loaded', unicodeRange: LATIN }, { family: '"JetBrains Mono"', status: 'unloaded', unicodeRange: LATIN }]);
    expect(await figureOf(CODE)).not.toHaveAttribute('data-mx-mermaid-portable');
  });

  it('asks for the faces covering the diagram\'s own characters before measuring (a unicode-range subset loads only when asked)', async () => {
    const load = fonts([{ family: 'Inter', status: 'loaded', unicodeRange: LATIN }]);
    await figureOf('flowchart TD\n  a[Café] --> b[Ärger]');
    expect(load.mock.calls.length).toBeGreaterThan(0);
    for (const [, text] of load.mock.calls) expect(text).toEqual(expect.stringContaining('é'));
    for (const [, text] of load.mock.calls) expect(text).toEqual(expect.stringContaining('Ä'));
  });
});

