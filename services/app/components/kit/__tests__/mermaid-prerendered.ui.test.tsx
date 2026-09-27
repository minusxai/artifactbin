/**
 * A diagram harvested to SVG after publish is DRAWN BY THE SERVER and needs no
 * Mermaid code in the reader: the server render carries the stored image, the
 * client hydrates the same image, and the engine is imported only when the
 * reader's resolved palette differs from the one it was drawn with (or nothing
 * is stored) — exactly today's path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { StoryRuntimeApp } from '@/lib/story-runtime/StoryRuntimeApp';
import { mermaidImageKey } from '@/lib/story-ui/mermaid-source';

const engine = vi.hoisted(() => ({ renderMermaid: vi.fn(async () => ({ src: 'data:image/svg+xml,engine', type: 'flowchart-v2', width: 10, height: 10 })) }));
vi.mock('@/components/kit/mermaid-render', () => engine);

const CODE = 'flowchart TD\n  a --> b';
const nodes = parseJsxOrThrow(`<Mermaid code={${JSON.stringify(CODE)}} />`).nodes;
const STORED = '/assets/mermaid/abc123.svg';

afterEach(() => { engine.renderMermaid.mockClear(); });

describe('a prerendered Mermaid diagram', () => {
  it('is in the server render as the stored image', () => {
    const images = { [mermaidImageKey(CODE, 'light')]: { src: STORED, type: 'flowchart-v2', width: 120, height: 80, palette: 'any' } };
    const html = renderToString(<StoryRuntimeApp nodes={nodes} refData={{}} colorMode="light" mermaidImages={images} />);
    expect(html).toContain(`src="${STORED}"`);
    expect(html).not.toContain('Rendering diagram');
  });

  it('never imports the engine when nothing is stored for it: today\'s path still draws', async () => {
    await act(async () => { render(<StoryRuntimeApp nodes={nodes} refData={{}} colorMode="light" />); });
    expect(engine.renderMermaid).toHaveBeenCalledTimes(1);
  });

  it('draws with the engine when the stored palette is not the reader\'s', async () => {
    const images = { [mermaidImageKey(CODE, 'light')]: { src: STORED, type: 'flowchart-v2', width: 120, height: 80, palette: 'not-this-palette' } };
    await act(async () => { render(<StoryRuntimeApp nodes={nodes} refData={{}} colorMode="light" mermaidImages={images} />); });
    expect(engine.renderMermaid).toHaveBeenCalledTimes(1);
  });

  it('distinguishes light from dark and one diagram from another', () => {
    expect(mermaidImageKey(CODE, 'light')).not.toBe(mermaidImageKey(CODE, 'dark'));
    expect(mermaidImageKey(CODE, 'light')).not.toBe(mermaidImageKey(CODE + ' ', 'light'));
    expect(mermaidImageKey(CODE, 'light')).toBe(mermaidImageKey(CODE, 'light'));
  });
});
