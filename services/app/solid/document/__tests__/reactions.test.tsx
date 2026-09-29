/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { LikeAction } from '../LikeAction';

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('sends a like once and displays the server answer', async () => {
  const fetcher = vi.fn(async () => Response.json({ liked: true, count: 4 }));
  vi.stubGlobal('fetch', fetcher);
  const change = vi.fn();
  const view = render(() => <LikeAction id="abc" accountSession initial={{ liked: false, count: 3 }} onChange={change} />);
  fireEvent.click(view.getByRole('button', { name: 'Like artifact' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Unlike artifact' })).toHaveTextContent('4'));
  expect(fetcher).toHaveBeenCalledWith('/api/my/artifacts/abc/like', { method: 'POST', credentials: 'same-origin' });
  expect(change).toHaveBeenCalledWith({ liked: true, count: 4 });
});

it('sends anonymous readers to login with the like intent', () => {
  window.history.replaceState(null, '', '/a/abc?$region=west#note');
  const navigate = vi.fn();
  const view = render(() => <LikeAction id="abc" accountSession={false} initial={{ liked: false, count: 0 }} navigate={navigate} />);
  fireEvent.click(view.getByRole('button', { name: 'Like artifact' }));
  const callback = new URL(navigate.mock.calls[0]![0] as string, location.origin).searchParams.get('callbackUrl');
  expect(callback).toBe('/a/abc?$region=west&intent=like#note');
  expect(screen.queryByRole('alert')).toBeNull();
});
