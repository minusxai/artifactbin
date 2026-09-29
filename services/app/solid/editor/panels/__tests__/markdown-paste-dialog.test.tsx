/* @jsxImportSource solid-js */
/**
 * components/views/story/MarkdownPasteDialog.tsx in SOLID — behavioral coverage. The React
 * component had no dedicated test file (only the toolbar button that opens it, owned
 * elsewhere); this covers the dialog's own contract directly.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import MarkdownPasteDialog from '../MarkdownPasteDialog';

describe('MarkdownPasteDialog', () => {
  it('is a labelled dialog with a focused, editable textarea', () => {
    render(() => <MarkdownPasteDialog value="" onChange={vi.fn()} onClose={vi.fn()} onInsert={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Paste Markdown' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByLabelText('Markdown to insert'));
  });

  it('reports every keystroke through onChange', () => {
    const onChange = vi.fn();
    render(() => <MarkdownPasteDialog value="" onChange={onChange} onClose={vi.fn()} onInsert={vi.fn()} />);
    fireEvent.input(screen.getByLabelText('Markdown to insert'), { target: { value: '# Title' } });
    expect(onChange).toHaveBeenCalledWith('# Title');
  });

  it('shows the caller-owned value', () => {
    render(() => <MarkdownPasteDialog value="**bold**" onChange={vi.fn()} onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.getByLabelText('Markdown to insert')).toHaveValue('**bold**');
  });

  it('inserts on the Insert button and leaves on Cancel or Escape', () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(() => <MarkdownPasteDialog value="text" onChange={vi.fn()} onClose={onClose} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert Markdown' }));
    expect(onInsert).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
