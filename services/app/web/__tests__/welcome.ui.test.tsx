/**
 * THE WELCOME PAGE — the one screen a new account sees before anything else,
 * and the only place the app ever interrupts somebody.
 *
 * Three controls and nothing else: the picture, the handle, Confirm. What is
 * asserted here is what makes it usable — every control has a name, a refused
 * handle KEEPS the person on the page (a confirmation that navigated away from
 * an error would strand them with a name they did not choose), and Confirm
 * returns them to wherever they were going when they were intercepted.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { WelcomePage } from '@/web/pages/Welcome';
import { resetRouter, router } from '@/test/setup/router';

const session = {
  value: { user: { id: 'usr_new1', email: 'mxmx_test_new@example.com' }, kind: 'account', onboarded: false } as
    | { user: { id: string; email: string | null } | null; kind: string; onboarded: boolean }
    | null,
};
vi.mock('@/web/session', () => ({ useSession: () => ({ session: session.value, reload: () => {}, pages: null, sessionError: null }) }));

const patches: Array<Record<string, unknown>> = [];
const patchAnswer = { status: 200, body: {} as Record<string, unknown> };

beforeEach(() => {
  resetRouter();
  router.search = new URLSearchParams([['callbackUrl', '/trash?x=1']]);
  patches.length = 0;
  patchAnswer.status = 200;
  patchAnswer.body = { username: 'newbie_ab12', welcome_pending: false };
  session.value = { user: { id: 'usr_new1', email: 'mxmx_test_new@example.com' }, kind: 'account', onboarded: false };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/my/profile/image')) {
      return new Response(JSON.stringify({ image: '/api/users/usr_new1/avatar?v=deadbeef' }), { status: 200 });
    }
    if (String(url).includes('/api/my/profile')) {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(patchAnswer.body), { status: patchAnswer.status });
      }
      return new Response(JSON.stringify({ username: 'newbie_ab12', image: null, welcome_pending: true }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderPage = () => render(<MemoryRouter><WelcomePage /></MemoryRouter>);

/** Where a `<Navigate>` actually went, as text a test can read. */
function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

const Routed = () => (
  <MemoryRouter initialEntries={['/welcome?callbackUrl=%2Ftrash%3Fx%3D1']}>
    <Routes>
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>
);

describe('the welcome page', () => {
  it('offers exactly the picture, the handle and Confirm — each one named', async () => {
    renderPage();
    // No picture yet: the uploader offers an upload, not a generated initial.
    expect(await screen.findByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
    await waitFor(() => expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('newbie_ab12'));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('saves the handle and the confirmation together, then returns to where the person was headed', async () => {
    renderPage();
    await waitFor(() => expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('newbie_ab12'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'chosen_name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(patches).toEqual([{ username: 'chosen_name', welcome_pending: false }]));
    await waitFor(() => expect(router.replaced).toEqual(['/trash?x=1']));
  });

  it('defaults to the root when nothing said where to go back to', async () => {
    router.search = new URLSearchParams();
    renderPage();
    await waitFor(() => expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('newbie_ab12'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(router.replaced).toEqual(['/']));
  });

  it('keeps the person here when the handle is refused, and says why', async () => {
    patchAnswer.status = 409;
    patchAnswer.body = { error: 'username_taken' };
    renderPage();
    await waitFor(() => expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('newbie_ab12'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/taken/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(router.replaced).toEqual([]);
  });

  it('puts the chosen picture on the page without a reload', async () => {
    const { container } = renderPage();
    await screen.findByRole('button', { name: 'Upload a photo' });
    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file.accept).toBe('image/png,image/jpeg,image/webp,image/gif,image/avif');

    fireEvent.change(file, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' })] } });
    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/users/usr_new1/avatar?v=deadbeef');
    });
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
  });

  it('shows a refused picture as a sentence and keeps the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/my/profile/image')) return new Response(JSON.stringify({ error: 'image_too_large' }), { status: 413 });
      if (String(url).includes('/api/my/profile') && init?.method !== 'PATCH') {
        return new Response(JSON.stringify({ username: 'newbie_ab12', image: null, welcome_pending: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const { container } = renderPage();
    await screen.findByRole('button', { name: 'Upload a photo' });
    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(file, { target: { files: [new File([new Uint8Array([1])], 'huge.png', { type: 'image/png' })] } });

    expect(await screen.findByText(/over 50 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor to log in, and one already through it to the account page', async () => {
    session.value = { user: null, kind: 'none', onboarded: true };
    render(<Routed />);
    // Back to THIS page afterwards, callback and all — otherwise logging in
    // would drop the destination the shell was holding on their behalf.
    const here = `/welcome?${new URLSearchParams([['callbackUrl', '/trash?x=1']]).toString()}`;
    expect(await screen.findByTestId('where')).toHaveTextContent(`/login?callbackUrl=${encodeURIComponent(here)}`);
    cleanup();

    session.value = { user: { id: 'usr_old', email: 'a@b.c' }, kind: 'account', onboarded: true };
    render(<Routed />);
    expect(await screen.findByTestId('where')).toHaveTextContent('/account');
  });
});
