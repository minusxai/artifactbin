import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useState } from 'react';

vi.mock('../LazySourceEditor', () => ({ default: ({ value, onChange, readOnly, ariaLabel = 'Markup source' }: {
  value: string; onChange: (text: string) => void; readOnly?: boolean; ariaLabel?: string;
}) => <textarea aria-label={ariaLabel} value={value} readOnly={readOnly} onChange={event => onChange(event.target.value)} /> }));
import SourceEditorPane from '../SourceEditorPane';

it('previews the current draft without emitting edits or replacing the editable buffer', async () => {
  const save = vi.fn();
  function Harness() {
    const [value, setValue] = useState('<section><p>Original</p></section>');
    return <SourceEditorPane value={value} revision={0} onChange={text => { setValue(text); save(text); }} />;
  }
  render(<Harness />);
  const editor = screen.getByLabelText('Markup source');
  const draft = '<section><p>Unsaved draft</p><p>Another line</p></section>';
  fireEvent.change(editor, { target: { value: draft } });
  save.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'View formatted' }));
  const preview = await screen.findByLabelText('Formatted JSX');
  expect(preview).toHaveAttribute('readonly');
  expect((preview as HTMLTextAreaElement).value).toContain('Unsaved draft');
  expect((preview as HTMLTextAreaElement).value).toContain('\n');
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit source' }));
  expect(screen.getByLabelText('Markup source')).toBe(editor);
  expect(editor).toHaveValue(draft);
  expect(save).not.toHaveBeenCalled();
});

it('leaves invalid source available for editing when formatting fails', async () => {
  const save = vi.fn();
  render(<SourceEditorPane value="<section>" revision={0} onChange={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'View formatted' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Edit source' }));
  expect(screen.getByLabelText('Markup source')).toHaveValue('<section>');
  expect(save).not.toHaveBeenCalled();
});

it('refreshes the read-only preview when a collaborator replaces the source', async () => {
  const view = render(<SourceEditorPane value="<p>First</p>" revision={0} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'View formatted' }));
  await screen.findByLabelText('Formatted JSX');
  view.rerender(<SourceEditorPane value="<p>Remote</p>" revision={1} onChange={() => {}} />);
  await waitFor(() => expect((screen.getByLabelText('Formatted JSX') as HTMLTextAreaElement).value).toContain('Remote'));
});
