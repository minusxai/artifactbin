/** The page-level hamburger carries the navigation without reserving a bar. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppBar, PageMenu } from '@/components/PageChrome';
import { SessionProvider } from '@/web/session';
import { pageDataChanged } from '@/web/page-data-events';
import { router, resetRouter } from '@/test/setup/router';

beforeEach(resetRouter);
afterEach(() => vi.unstubAllGlobals());

describe('page menu', () => {
  it('is one floating control, not a header', () => {
    const { container } = render(<PageMenu authed />);
    const burger = screen.getByLabelText('Open menu');
    expect(burger).toHaveClass('absolute', 'rounded-full');
    expect(container.querySelector('header')).toBeNull();
  });

  it('in edit mode the page bar carries the account button, fixed over the editor, with the mode named in the middle', () => {
    render(<AppBar fixed center={<span aria-label="Edit mode">edit mode</span>} />);
    const bar = screen.getByLabelText('Page bar');
    expect(bar).toHaveClass('fixed', 'top-0');
    expect(bar).toContainElement(screen.getByLabelText('Open menu'));
    expect(bar).toContainElement(screen.getByLabelText('Open page controls'));
    expect(screen.getByLabelText('Edit mode')).toHaveTextContent('edit mode');
    expect(screen.queryByLabelText('Current page')).toHaveTextContent('artifactbin');
  });

  it('offers the complete navigation and account action when opened', () => {
    render(<PageMenu authed />);
    expect(screen.queryByLabelText('Menu')).toBeNull();
    fireEvent.click(screen.getByLabelText('Open menu'));
    for (const label of ['Artifacts', 'Account', 'Human Docs', 'Sign out']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Tokens')).toBeNull();
  });

  it('sends a signed-out reader to login and back to the address they are on', () => {
    window.history.replaceState(null, '', '/@vivek/ab12cd-my-doc?$exp_desc=Dinner#ledger');
    router.path = '/@vivek/ab12cd-my-doc';
    render(<PageMenu authed={false} />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Login')).toHaveAttribute('href', `/login?callbackUrl=${encodeURIComponent('/@vivek/ab12cd-my-doc?$exp_desc=Dinner#ledger')}`);
    window.history.replaceState(null, '', '/');
  });

  it('puts page context in the page bar and keeps it out of the account menu', () => {
    router.path = '/@vivek/notes/ab12cd-my-doc';
    render(<><AppBar title="My doc" /><PageMenu authed title="My doc" triggerless /></>);
    fireEvent.click(screen.getByLabelText('Open menu'));
    const context = screen.getByLabelText('Current page');
    expect(context).toHaveTextContent('@vivek');
    expect(context).toHaveTextContent('My doc');
    expect(within(context).getByRole('link', { name: '@vivek' })).toHaveAttribute('href', '/@vivek');
    expect(screen.getByLabelText('Page bar')).toContainElement(context);
    expect(screen.getByLabelText('Menu')).not.toContainElement(context);
  });

  it('highlights the current destination', () => {
    render(<PageMenu authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Artifacts')).toHaveClass('text-accent');
    expect(screen.getByLabelText('Account')).not.toHaveClass('text-accent');
  });

  it('closes by click-away and keeps the catcher above the page', () => {
    render(<PageMenu authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    const overlay = screen.getByLabelText('Close the menu');
    expect(overlay).toHaveClass('fixed', 'z-40');
    fireEvent.click(overlay);
    expect(screen.queryByLabelText('Menu')).toBeNull();
  });

  it('is a full-width sheet on phones and a narrow drawer from sm up', () => {
    render(<PageMenu authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Menu')).toHaveClass('w-full', 'sm:w-72');
  });

  it('offers log in when there is no session', () => {
    render(<PageMenu authed={false} />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Login')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sign out')).toBeNull();
  });
});

describe('the menu button draws who is signed in', () => {
  type User = { id: string; email: string | null; username: string | null; image: string | null };
  let answer: { user: User | null; kind: 'account' | 'anon' | 'none'; onboarded: boolean };
  let sessionReads = 0;
  beforeEach(() => {
    sessionReads = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/page/session')) sessionReads++;
      return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
    }));
  });
  const account = (user: Partial<User>) => ({ user: { id: 'usr_bar', email: 'mxmx_test_bar@example.com', username: 'barperson', image: null, ...user }, kind: 'account' as const, onboarded: true });
  const bar = () => render(<SessionProvider><AppBar /><PageMenu authed triggerless /></SessionProvider>);

  it('keeps the plain glyph with no provider at all', () => {
    render(<AppBar />);
    expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('img')).toBeNull();
  });

  it('keeps the plain glyph when signed out or anonymous', async () => {
    answer = { user: null, kind: 'none', onboarded: true };
    const { unmount } = bar();
    await waitFor(() => expect(sessionReads).toBe(1));
    expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('svg')).not.toBeNull();
    unmount();

    answer = { user: null, kind: 'anon', onboarded: true };
    bar();
    await waitFor(() => expect(sessionReads).toBe(2));
    expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('img')).toBeNull();
  });

  it('shows the account picture, and keeps it (ringed) with the menu open', async () => {
    answer = account({ image: '/api/users/usr_bar/avatar?v=abc' });
    bar();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('img')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('img')).toHaveAttribute('src', '/api/users/usr_bar/avatar?v=abc');

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(close.querySelector('img')).toHaveAttribute('src', '/api/users/usr_bar/avatar?v=abc');
    expect(close).toHaveAttribute('aria-expanded', 'true');
  });

  it('draws the initial of the handle, then of the email, when there is no picture', async () => {
    answer = account({ username: 'barperson' });
    const { unmount } = bar();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open menu' })).toHaveTextContent('B'));
    expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('img')).toBeNull();
    unmount();

    answer = account({ username: null, email: 'zed@example.com' });
    bar();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open menu' })).toHaveTextContent('Z'));
  });

  it('falls back to the initial when the picture fails to load', async () => {
    answer = account({ image: '/api/users/usr_bar/avatar?v=gone' });
    bar();
    const img = await waitFor(() => { const found = screen.getByRole('button', { name: 'Open menu' }).querySelector('img'); expect(found).not.toBeNull(); return found!; });
    fireEvent.error(img);
    expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveTextContent('B');
  });

  it('picks up a new picture when page data changes, without flashing back to the glyph', async () => {
    answer = account({ image: null });
    bar();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open menu' })).toHaveTextContent('B'));

    answer = account({ image: '/api/users/usr_bar/avatar?v=new' });
    act(() => pageDataChanged());
    // The old session stays up while the new one is read: never a glyph in between.
    expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('svg')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open menu' }).querySelector('img')).toHaveAttribute('src', '/api/users/usr_bar/avatar?v=new'));
    expect(sessionReads).toBe(2);
  });
});

describe('the old /tokens address', () => {
  it('still forwards to /account', async () => {
    const { App } = await import('@/web/App');
    const src = String((await import('node:fs')).readFileSync('web/App.tsx', 'utf8'));
    expect(src.replace(/\s+/g, ' ')).toContain('path="/tokens" element={<Navigate to="/account" replace />}');
    expect(App).toBeTruthy();
  });
});
