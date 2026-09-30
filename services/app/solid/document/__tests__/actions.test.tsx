/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { DocumentActions } from '../DocumentActions';

it('keeps archived actions read only and exposes a reader fork', () => {
  const view = render(() => <DocumentActions id="abc" title="Report" version={2} archived owner canEdit canAnnotate
    like={{ liked: false, count: 0 }} accountSession={false} onCommentsChange={() => {}} />);
  expect(view.queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Delete Report' })).toBeNull();
  expect(view.getByRole('button', { name: 'Fork artifact' })).toBeTruthy();
});

it('toggles comments without changing document mode', () => {
  const comments = vi.fn();
  const view = render(() => <DocumentActions id="abc" title="Report" version={3} owner canEdit canAnnotate
    like={{ liked: false, count: 0 }} accountSession onCommentsChange={comments} />);
  fireEvent.click(view.getByRole('button', { name: 'Toggle comments' }));
  expect(comments).toHaveBeenCalledWith(true);
  expect(view.getByRole('button', { name: 'Toggle comments' })).toHaveAttribute('aria-pressed', 'true');
});

it('opens the social preview editor from an editable markup document, not from a non-editable or non-markup one', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ visibility: 'private', linkRole: 'viewer', shares: [] }) })));
  const view = render(() => <DocumentActions id="abc" title="Report" version={3} owner canEdit canAnnotate format="markup" source="<p>x</p>" editId="e1"
    like={{ liked: false, count: 0 }} accountSession onCommentsChange={() => {}} />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit social preview' }));
  // The crop editor is its own chunk: it arrives a moment after the press.
  expect(await screen.findByRole('dialog', { name: 'Social preview' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel social preview' }));
  expect(screen.queryByRole('dialog', { name: 'Social preview' })).toBeNull();
  view.unmount();

  const noSource = render(() => <DocumentActions id="abc" title="Report" version={3} owner canEdit canAnnotate format="markup"
    like={{ liked: false, count: 0 }} accountSession onCommentsChange={() => {}} />);
  fireEvent.click(noSource.getByRole('button', { name: 'Share' }));
  expect(screen.queryByRole('button', { name: 'Edit social preview' })).toBeNull();
  noSource.unmount();

  const notMarkup = render(() => <DocumentActions id="abc" title="Report" version={3} owner canEdit canAnnotate format="image" source="x" editId="e1"
    like={{ liked: false, count: 0 }} accountSession onCommentsChange={() => {}} />);
  fireEvent.click(notMarkup.getByRole('button', { name: 'Share' }));
  expect(screen.queryByRole('button', { name: 'Edit social preview' })).toBeNull();
});
