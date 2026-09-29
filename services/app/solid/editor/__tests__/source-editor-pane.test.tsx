/* @jsxImportSource solid-js */
/**
 * components/__tests__/source-editor-pane.ui.test.tsx, PORTED to the Solid pane. Same three cases and
 * assertions, same stand-in: the rich editor module is mocked with a plain textarea (the React suite
 * mocks LazySourceEditor; here the lazy module itself). `rerender` with new props becomes signals.
 * The real CodeMirror mount is exercised in source-editor.test.tsx.
 */
import { expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';

vi.mock('../SourceEditor', () => ({ default: (props: {
  value: string; onChange: (text: string) => void; readOnly?: boolean; ariaLabel?: string;
}) => <textarea aria-label={props.ariaLabel ?? 'Markup source'} value={props.value} readOnly={props.readOnly} onChange={(event) => props.onChange(event.currentTarget.value)} /> }));
import SourceEditorPane from '../SourceEditorPane';

it('previews the current draft without emitting edits or replacing the editable buffer', async () => {
  const save = vi.fn();
  function Harness() {
    const [value, setValue] = createSignal('<section><p>Original</p></section>');
    return <SourceEditorPane value={value()} revision={0} onChange={(text) => { setValue(text); save(text); }} />;
  }
  render(() => <Harness />);
  const editor = await screen.findByLabelText('Markup source');
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
  render(() => <SourceEditorPane value="<section>" revision={0} onChange={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'View formatted' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Edit source' }));
  expect(await screen.findByLabelText('Markup source')).toHaveValue('<section>');
  expect(save).not.toHaveBeenCalled();
});

it('refreshes the read-only preview when a collaborator replaces the source', async () => {
  const [props, setProps] = createSignal({ value: '<p>First</p>', revision: 0 });
  render(() => <SourceEditorPane value={props().value} revision={props().revision} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'View formatted' }));
  await screen.findByLabelText('Formatted JSX');
  setProps({ value: '<p>Remote</p>', revision: 1 });
  await waitFor(() => expect((screen.getByLabelText('Formatted JSX') as HTMLTextAreaElement).value).toContain('Remote'));
});
