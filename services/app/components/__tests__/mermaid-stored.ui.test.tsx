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
import { Mermaid, MermaidImagesProvider } from '../kit/mermaid';
import { mermaidImageKey } from '@/lib/story-ui/mermaid-source';

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

  it('gives way to the engine when its bytes will not load', async () => {
    const images = stored(await readersPaletteKey());
    render(<MermaidImagesProvider value={images}><Mermaid code={CODE} title="Flow" /></MermaidImagesProvider>);
    fireEvent.error(screen.getByRole('img', { name: 'Flow' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Flow' })).toHaveAttribute('src', 'data:image/svg+xml,engine'));
    expect(renderMermaid).toHaveBeenCalledTimes(1);
  });
});
