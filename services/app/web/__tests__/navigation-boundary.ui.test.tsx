import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { isClientRoute, NavigationBoundary, useNavigationGuard, type NavigationGuard } from '../NavigationBoundary';

afterEach(cleanup);
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });

function Editor({ guard }: { guard: NavigationGuard }) {
  useNavigationGuard(guard);
  return <><input aria-label="Unsaved draft" defaultValue="keep me" /><a href="/account" aria-label="Account">Account</a></>;
}

function mount(guard: NavigationGuard, initialEntries = ['/']) {
  const router = createMemoryRouter([{ element: <NavigationBoundary><Outlet /></NavigationBoundary>, children: [
    { path: '/', element: <Editor guard={guard} /> },
    { path: '/account', element: <h1 aria-label="Account page">Account</h1> },
    { path: '/chat', element: <h1 aria-label="Chat page">Chat</h1> },
  ] }], { initialEntries });
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

  it('guards programmatic back, retains a failed draft, and supports retry', async () => {
    const guard = vi.fn(async () => false);
    const router = mount(guard);
    await act(async () => { await router.navigate('/?state=2'); });
    const draft = screen.getByLabelText('Unsaved draft');
    // Same-document state does not run a guard or remount the editor.
    expect(guard).not.toHaveBeenCalled();
    await act(async () => { await router.navigate('/account'); });
    expect(draft).toBe(screen.getByLabelText('Unsaved draft'));
    guard.mockResolvedValue(true);
    await act(async () => { await router.navigate('/account'); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.search).toBe('?state=2');
  });

  it('blocks browser history POP out of an editor and retries without losing the history entry', async () => {
    const guard = vi.fn(async () => false);
    const router = mount(guard, ['/account', '/']);
    const draft = screen.getByLabelText('Unsaved draft');
    await act(async () => { await router.navigate(-1); });
    expect(guard).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByLabelText('Unsaved draft')).toBe(draft);
    guard.mockResolvedValue(true);
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    await act(async () => { await router.navigate(1); });
    expect(router.state.location.pathname).toBe('/');
  });

  it('modified and download links do not invoke the SPA guard', () => {
    const guard = vi.fn(async () => true);
    mount(guard);
    const link = screen.getByLabelText('Account');
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    link.setAttribute('download', '');
    fireEvent.click(link);
    link.removeAttribute('download');
    link.setAttribute('target', '_blank');
    fireEvent.click(link);
    expect(guard).not.toHaveBeenCalled();
  });

  it('the latest deliberate destination wins while one persistence operation is pending', async () => {
    let finish!: (allowed: boolean) => void;
    const guard = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const router = mount(guard);
    await act(async () => { await router.navigate('/account'); });
    await waitFor(() => expect(guard).toHaveBeenCalledOnce());
    await act(async () => { await router.navigate('/chat'); });
    await act(async () => { finish(true); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    expect(guard).toHaveBeenCalledOnce();
  });

  it('a signal update during persistence cannot erase the requested destination', async () => {
    let finish!: (allowed: boolean) => void;
    const guard = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const router = mount(guard);
    await act(async () => { await router.navigate('/account'); });
    await waitFor(() => expect(guard).toHaveBeenCalledOnce());
    await act(async () => { await router.navigate('/?$value=3', { replace: true }); });
    await act(async () => { finish(true); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
  });

  it('preserves destination state and REPLACE after a signal commit during save', async () => {
    let finish!: (allow: boolean) => void;
    const router = mount(() => new Promise(resolve => { finish = resolve; }), ['/chat', '/']);
    await act(async () => { await router.navigate('/account', { replace: true, state: { selected: 12 } }); });
    await act(async () => { await router.navigate('/?$count=2', { replace: true }); });
    await act(async () => { finish(true); });
    expect(router.state.location.pathname).toBe('/account');
    expect(router.state.location.state).toEqual({ selected: 12 });
    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.pathname).toBe('/chat');
  });

  it('preserves the POP history stack after a signal commit during a back save', async () => {
    let finish!: (allow: boolean) => void;
    const router = mount(() => new Promise(resolve => { finish = resolve; }), ['/chat', '/account', '/']);
    await act(async () => { await router.navigate(-1); });
    await act(async () => { await router.navigate('/?$count=2', { replace: true }); });
    await act(async () => { finish(true); });
    expect(router.state.location.pathname).toBe('/account');
    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.pathname).toBe('/chat');
  });

  it('failed save retains the draft and applies a deferred same-document signal URL', async () => {
    let finish!: (allow: boolean) => void;
    const router = mount(() => new Promise(resolve => { finish = resolve; }));
    const draft = screen.getByLabelText('Unsaved draft');
    await act(async () => { await router.navigate('/account'); });
    await act(async () => { await router.navigate('/?$count=2', { replace: true, state: { signal: 2 } }); });
    await act(async () => { finish(false); });
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('?$count=2');
    expect(router.state.location.state).toEqual({ signal: 2 });
    expect(screen.getByLabelText('Unsaved draft')).toBe(draft);
  });

  it('captures the latest deliberate continuation even when React batches a following signal update', async () => {
    let finish!: (allow: boolean) => void;
    const router = mount(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { await router.navigate('/account'); });
    await act(async () => {
      void router.navigate('/chat');
      void router.navigate('/?$count=2', { replace: true });
    });
    await act(async () => { finish(true); });
    expect(router.state.location.pathname).toBe('/chat');
  });

  it('intercepts a composed anchor from trusted shadow UI', async () => {
    const router = mount(async () => true);
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<a href="/chat">chat</a>';
    fireEvent.click(shadow.querySelector('a')!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    host.remove();
  });

  it.each(['/api/page/session', '/a/a1/raw', '/a/a1/export', '/assets/file.png', '/auth/callback', '/docs', '/docs/markup', '/@user/doc/raw'])('leaves server-only route %s native', (path) => {
    expect(isClientRoute(new URL(path, window.location.origin))).toBe(false);
  });
});
