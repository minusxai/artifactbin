/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
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
