/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { DeleteAction } from '../DeleteAction';

afterEach(() => vi.unstubAllGlobals());

it('confirms before moving a document to trash and reports refusal', async () => {
  const fetcher = vi.fn(async () => Response.json({ error: 'forbidden' }, { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DeleteAction id="abc" title="Report" onDeleted={() => {}} />);
  fireEvent.click(view.getByRole('button', { name: 'Delete Report' }));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('forbidden'));
});
