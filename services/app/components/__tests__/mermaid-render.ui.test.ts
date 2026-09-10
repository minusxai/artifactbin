import { describe, expect, it, vi } from 'vitest';
import { renderMermaid } from '../kit/mermaid-render';
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="4 4 152 297"></svg>', diagramType: 'stateDiagram' })) } }));
describe('Mermaid image dimensions', () => {
  it('preserves the diagram layout size instead of expanding to the document width', async () => {
    const result = await renderMermaid('stateDiagram-v2; Draft --> Saved', { background: '#fff', foreground: '#111', primary: '#00f', border: '#aaa', dark: false });
    expect(result).toMatchObject({ width: 152, height: 297 });
  });
});
