import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StartPage } from '../pages/Start';

const navigate = vi.fn();
vi.mock('react-router', async original => ({ ...await original<typeof import('react-router')>(), useNavigate: () => navigate }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); navigate.mockReset(); sessionStorage.clear(); });

it('creates once under StrictMode, without a session or clipboard access, and replaces the entry page', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'doc123' }), { status: 201 }));
  vi.stubGlobal('fetch', fetcher);
  render(<StrictMode><StartPage /></StrictMode>);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/a/doc123', { replace: true }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('/api/start', { method: 'POST' });
});

it('shows a creation failure without redirecting or automatically retrying', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  render(<StartPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not create your artifact');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});
