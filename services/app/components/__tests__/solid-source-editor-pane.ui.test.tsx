import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { EditorView } from '@codemirror/view';
import SolidSourceEditorPane from '../SolidSourceEditorPane';

it('hosts the Solid source editor and only applies announced source replacements', async () => {
  const onChange = vi.fn();
  const view = render(<SolidSourceEditorPane value="<p>First</p>" revision={0} onChange={onChange} />);
  await waitFor(() => expect(view.container.querySelector('.cm-editor')).not.toBeNull());
  const source = screen.getByRole('textbox', { name: 'Markup source' });
  const cm = EditorView.findFromDOM(source.closest('.cm-editor') as HTMLElement)!;
  expect(cm.state.doc.toString()).toBe('<p>First</p>');
  const current = () => EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Markup source' }).closest('.cm-editor') as HTMLElement)!;
  view.rerender(<SolidSourceEditorPane value="<p>Lagging echo</p>" revision={0} onChange={onChange} />);
  expect(cm.state.doc.toString()).toBe('<p>First</p>');
  expect(current() === cm).toBe(true);
  view.rerender(<SolidSourceEditorPane value="<p>Remote</p>" revision={1} onChange={onChange} />);
  await waitFor(() => expect(current().state.doc.toString()).toBe('<p>Remote</p>'));
  expect(current()).toBe(cm);
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps a controlled React echo from erasing a fast CodeMirror edit', async () => {
  const changes: string[] = [];
  function Host() {
    const [source, setSource] = useState('<p>First</p>');
    return <SolidSourceEditorPane value={source} revision={0} onChange={(next) => { changes.push(next); setSource(next); }} />;
  }
  const view = render(<Host />);
  await waitFor(() => expect(view.container.querySelector('.cm-editor')).not.toBeNull());
  const source = screen.getByRole('textbox', { name: 'Markup source' });
  const cm = EditorView.findFromDOM(source.closest('.cm-editor') as HTMLElement)!;
  const end = cm.state.doc.length;
  cm.dispatch({ changes: { from: end, insert: ' fast typing' } });
  await waitFor(() => expect(changes.at(-1)).toBe('<p>First</p> fast typing'));
  expect(cm.state.doc.toString()).toBe('<p>First</p> fast typing');
});
