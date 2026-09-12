import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MermaidEditorPanel from '../views/story/MermaidEditorPanel';

const embed = { code: 'flowchart TD; A-->B', title: 'Flow' };

describe('MermaidEditorPanel', () => {
  it('commits an edited source on blur and again on ⌘⏎', () => {
    const onChange = vi.fn();
    render(<MermaidEditorPanel embed={embed} onChange={onChange} />);
    const source = screen.getByLabelText('Diagram source');
    fireEvent.change(source, { target: { value: 'flowchart LR; A-->B' } });
    fireEvent.blur(source);
    expect(onChange).toHaveBeenCalledWith({ code: 'flowchart LR; A-->B' });
    fireEvent.change(source, { target: { value: 'flowchart LR; A-->C' } });
    fireEvent.keyDown(source, { key: 'Enter', metaKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ code: 'flowchart LR; A-->C' });
  });
  it('emits nothing for an unchanged source', () => {
    const onChange = vi.fn();
    render(<MermaidEditorPanel embed={embed} onChange={onChange} />);
    fireEvent.blur(screen.getByLabelText('Diagram source'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('names a refused source instead of writing it', () => {
    const onChange = vi.fn();
    render(<MermaidEditorPanel embed={embed} onChange={onChange} />);
    const source = screen.getByLabelText('Diagram source');
    fireEvent.change(source, { target: { value: '%%{init: {"theme":"dark"}}%%\nflowchart TD; A-->B' } });
    fireEvent.blur(source);
    expect(screen.getByLabelText('Diagram source error')).toHaveTextContent('configuration directives');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('commits the title on blur, empty as null', () => {
    const onChange = vi.fn();
    render(<MermaidEditorPanel embed={embed} onChange={onChange} />);
    const title = screen.getByLabelText('Diagram title');
    fireEvent.change(title, { target: { value: 'Order pipeline' } });
    fireEvent.blur(title);
    expect(onChange).toHaveBeenCalledWith({ title: 'Order pipeline' });
    fireEvent.change(title, { target: { value: '' } });
    fireEvent.blur(title);
    expect(onChange).toHaveBeenLastCalledWith({ title: null });
  });
});
