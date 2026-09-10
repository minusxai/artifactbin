import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mermaid } from '../kit/mermaid';

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
  it('renders a syntax error without losing the editable source', async () => {
    renderMermaid.mockRejectedValue(new Error('parser internals'));
    const { container } = render(<Mermaid code="bad syntax" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Check its Mermaid syntax');
    expect(container.querySelector('pre')).toHaveTextContent('bad syntax');
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
