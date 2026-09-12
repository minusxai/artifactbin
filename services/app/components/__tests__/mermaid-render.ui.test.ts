import { describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { mixHex, renderMermaid, type MermaidPalette } from '../kit/mermaid-render';
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="4 4 152 297"></svg>', diagramType: 'stateDiagram' })) } }));

const palette: MermaidPalette = {
  background: '#ffffff', foreground: '#111111', primary: '#0000ff', border: '#aaaaaa',
  card: '#f8f8f8', muted: '#eeeeee', accent: '#dddddd', mutedForeground: '#666666',
  fontFamily: 'Inter, sans-serif', fontMono: 'Menlo, monospace', fontSize: '13px', dark: false,
};
const markupOf = (src: string) => decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));

describe('Mermaid image dimensions', () => {
  it('preserves the diagram layout size instead of expanding to the document width', async () => {
    const result = await renderMermaid('stateDiagram-v2; Draft --> Saved', palette);
    expect(result).toMatchObject({ width: 152, height: 297 });
  });
});

describe('Mermaid theme', () => {
  it('renders the flat classic look in the document palette and type — no neo drop shadows', async () => {
    await renderMermaid('flowchart TD; A-->B', palette);
    const config = vi.mocked(mermaid.initialize).mock.calls.at(-1)?.[0];
    expect(config).toMatchObject({
      look: 'classic',
      theme: 'base',
      flowchart: { minNodeWidth: 72, wrappingWidth: 200 },
      themeVariables: {
        fontFamily: 'Inter, sans-serif', fontSize: '13px',
        primaryColor: '#f8f8f8', mainBkg: '#f8f8f8', nodeBorder: '#aaaaaa', primaryBorderColor: '#aaaaaa',
        textColor: '#111111', primaryTextColor: '#111111',
        lineColor: '#666666', arrowheadColor: '#666666', edgeLabelBackground: '#ffffff',
        clusterBkg: '#eeeeee', clusterBorder: '#aaaaaa',
        actorBkg: '#eeeeee', actorBorder: '#aaaaaa', noteBkgColor: '#dddddd',
        activationBkgColor: '#e0e0ff', activationBorderColor: '#0000ff', transitionColor: '#666666',
      },
    });
  });
  it('tells node kinds apart with the theme surfaces and its one accent', async () => {
    const result = await renderMermaid('flowchart TD; A([Start]) --> B{Ok?} --> C[Do]', palette);
    const markup = markupOf(result.src);
    const rendered = vi.mocked(mermaid.render).mock.calls.at(-1)?.[0];
    expect(markup).toContain(`#${rendered} .nodes .node rect, #${rendered} .nodes .node path { fill: #eeeeee; stroke: #aaaaaa; }`);
    expect(markup).toContain(`#${rendered} .nodes .node rect[rx]:not([rx="0"]), #${rendered} .nodes .node circle { fill: #e0e0ff; stroke: #0000ff; }`);
    expect(markup).toContain(`#${rendered} .nodes .node polygon { fill: #f8f8f8; stroke: #0000ff; }`);
    expect(markup).toContain(`#${rendered} .clusters .cluster rect { fill: #dddddd; stroke: #aaaaaa; stroke-dasharray: 4 3; }`);
  });
  it('mixes hex colours toward another, clamped', () => {
    expect(mixHex('#ffffff', '#0000ff', 0.12)).toBe('#e0e0ff');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#102030', '#102030', 0.5)).toBe('#102030');
  });
  it('sets edge labels in the mono utility face on an opaque ground, scoped to this diagram', async () => {
    const result = await renderMermaid('flowchart TD; A-->|yes|B', palette);
    const markup = markupOf(result.src);
    const rendered = vi.mocked(mermaid.render).mock.calls.at(-1)?.[0];
    expect(markup).toContain(`#${rendered} .edgeLabels .edgeLabel text`);
    expect(markup).toContain('font-family: Menlo, monospace');
    expect(markup).toContain('fill: #666666');
    expect(markup).toContain(`#${rendered} .edgeLabels .edgeLabel rect { opacity: 1; fill: #ffffff`);
  });
  it('shows the engine output untouched when it is not well-formed XML', async () => {
    vi.mocked(mermaid.render).mockResolvedValueOnce({ svg: '<svg><g></svg>', diagramType: 'flowchart-v2' });
    const result = await renderMermaid('flowchart TD; A-->B', palette);
    expect(markupOf(result.src)).toBe('<svg><g></svg>');
    expect(result).not.toHaveProperty('width');
  });
});
