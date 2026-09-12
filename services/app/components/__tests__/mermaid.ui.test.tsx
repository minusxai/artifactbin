import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mermaid } from '../kit/mermaid';
import { GridItemContext } from '../kit/grid';

const { renderMermaid } = vi.hoisted(() => ({ renderMermaid: vi.fn() }));
vi.mock('../kit/mermaid-render', () => ({ renderMermaid }));
beforeEach(() => {
  renderMermaid.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe('Mermaid', () => {
  it('shows accessible output and marks export readiness after the image loads', async () => {
    renderMermaid.mockResolvedValue({ src: 'data:image/svg+xml,test', type: 'flowchart-v2' });
    const { container } = render(<Mermaid code="flowchart TD; A-->B" title="Shift flow" />);
    const image = await screen.findByRole('img', { name: 'Shift flow' });
    expect(container.querySelector('figure')).toHaveAttribute('data-mx-mermaid-state', 'pending');
    fireEvent.load(image);
    expect(container.querySelector('figure')).toHaveAttribute('data-mx-mermaid-state', 'ready');
    expect(container.querySelector('figure')).toHaveAttribute('data-mermaid-type', 'flowchart-v2');
  });
  it('hands the engine the document surfaces, edge colour and type, not just four colours', async () => {
    renderMermaid.mockResolvedValue({ src: 'data:image/svg+xml,test', type: 'flowchart-v2' });
    render(<Mermaid code="flowchart TD; A-->B" />);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    expect(renderMermaid).toHaveBeenCalledWith('flowchart TD; A-->B', expect.objectContaining({
      card: expect.stringMatching(/^#[0-9a-f]{6}$/),
      muted: expect.stringMatching(/^#[0-9a-f]{6}$/),
      mutedForeground: expect.stringMatching(/^#[0-9a-f]{6}$/),
      fontFamily: expect.any(String),
      fontMono: expect.any(String),
      fontSize: expect.stringMatching(/^\d+px$/),
    }));
  });
  it('keeps the diagram at its layout size in prose and never shows a source disclosure', async () => {
    renderMermaid.mockResolvedValue({ src: 'data:image/svg+xml,test', type: 'flowchart-v2', width: 152, height: 297 });
    const { container } = render(<Mermaid code="flowchart TD; A-->B" title="Shift flow" />);
    const image = await screen.findByRole('img', { name: 'Shift flow' });
    expect(image.style.width).toBe('152px');
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByText('Diagram source')).toBeNull();
  });
  it('fills a grid cell: tile title chrome, and the image scales to fit the cell', async () => {
    renderMermaid.mockResolvedValue({ src: 'data:image/svg+xml,test', type: 'flowchart-v2', width: 152, height: 297 });
    const { container } = render(
      <GridItemContext.Provider value={true}><Mermaid code="flowchart TD; A-->B" title="Order pipeline" /></GridItemContext.Provider>,
    );
    const image = await screen.findByRole('img', { name: 'Order pipeline' });
    expect(container.querySelector('figure')).toHaveClass('h-full');
    expect(container.querySelector('figcaption')).toHaveClass('border-b', 'font-mono');
    expect(image).toHaveClass('object-contain', 'flex-1');
    expect(image.style.width).toBe('');
  });
  it('renders a syntax error in place of the image; the source stays in the code prop for the inspector', async () => {
    renderMermaid.mockRejectedValue(new Error('parser internals'));
    const { container } = render(<Mermaid code="bad syntax" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Check its Mermaid syntax');
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('figure')).toHaveAttribute('data-mx-mermaid-state', 'error');
  });
  it('never replaces a newer source edit with an older render result', async () => {
    let finishOld!: (value: { src: string; type: string }) => void;
    renderMermaid.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce({ src: 'data:image/svg+xml,new', type: 'sequence' });
    const { rerender } = render(<Mermaid code="flowchart TD; A-->B" />);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    rerender(<Mermaid code="sequenceDiagram; A->>B: Hi" />);
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'data:image/svg+xml,new');
    await act(async () => finishOld({ src: 'data:image/svg+xml,old', type: 'flowchart-v2' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/svg+xml,new');
  });
  it('refuses legacy stored configuration directives before loading the engine', () => {
    render(<Mermaid code={'%%{init: {"securityLevel":"loose"}}%%'} />);
    expect(screen.getByRole('alert')).toHaveTextContent('configuration directives');
    expect(renderMermaid).not.toHaveBeenCalled();
  });
});
