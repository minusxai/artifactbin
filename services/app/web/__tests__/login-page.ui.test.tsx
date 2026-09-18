import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { LoginPage } from '../pages/Login';

const state = vi.hoisted(() => ({ session: null as null | { user: null | { id: string }; kind: string }, sessionError: null as Error | null }));
vi.mock('../session', () => ({ useSession: () => state }));
beforeEach(() => { state.session = null; state.sessionError = null; });
const show = (search = '') => render(<MemoryRouter initialEntries={['/login' + search]}><LoginPage /></MemoryRouter>);

it('does not flash the form while the session is loading', () => {
  show();
  expect(screen.queryByLabelText('Email')).toBeNull();
});
it('shows the form to guests', () => {
  state.session = { user: null, kind: 'anon' };
  show();
  expect(screen.getByLabelText('Email')).toBeTruthy();
});
it.each([['', '/'], ['?callbackUrl=%2Foauth%2Fauthorize%3Fx%3D1%23foo', '/oauth/authorize?x=1#foo'], ['?callbackUrl=https://evil.example', '/'], ['?callbackUrl=/login', '/']])('replaces signed-in login navigation %s', async (search, target) => {
  state.session = { user: { id: 'account' }, kind: 'account' };
  const replace = vi.fn();
  const original = window.location;
  Object.defineProperty(window, 'location', { configurable: true, value: { origin: original.origin, replace } });
  try {
    show(search);
    expect(screen.queryByLabelText('Email')).toBeNull();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(target));
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  }
});
