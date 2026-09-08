import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { NavigationBoundary, useNavigationGuard, type NavigationGuard } from '../NavigationBoundary';

afterEach(cleanup);

function Editor({ guard }: { guard: NavigationGuard }) {
  useNavigationGuard(guard);
  return <><input aria-label="Unsaved draft" defaultValue="keep me" /><a href="/account" aria-label="Account">Account</a></>;
}

function mount(guard: NavigationGuard) {
  const router = createMemoryRouter([{ element: <NavigationBoundary><Outlet /></NavigationBoundary>, children: [
    { path: '/', element: <Editor guard={guard} /> },
    { path: '/account', element: <h1 aria-label="Account page">Account</h1> },
  ] }]);
  render(<RouterProvider router={router} />);
  return router;
}

describe('navigation retains the editor until persistence finishes', () => {
  it('intercepts an ordinary internal anchor and waits for the guard before changing routes', async () => {
    let finish!: (allowed: boolean) => void;
    const guard = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const router = mount(guard);
    const draft = screen.getByLabelText('Unsaved draft');
    fireEvent.click(screen.getByLabelText('Account'));
    await waitFor(() => expect(guard).toHaveBeenCalledOnce());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByLabelText('Unsaved draft')).toBe(draft);
    finish(true);
    await waitFor(() => expect(screen.getByLabelText('Account page')).toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/account');
  });

  it('keeps the same draft mounted when saving fails', async () => {
    const guard = vi.fn(async () => false);
    const router = mount(guard);
    const draft = screen.getByLabelText('Unsaved draft');
    fireEvent.change(draft, { target: { value: 'last typed text' } });
    fireEvent.click(screen.getByLabelText('Account'));
    await waitFor(() => expect(guard).toHaveBeenCalledOnce());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByLabelText('Unsaved draft')).toBe(draft);
    expect(draft).toHaveValue('last typed text');
  });
});
