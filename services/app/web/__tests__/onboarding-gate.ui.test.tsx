/**
 * THE ONE INTERRUPTION THE APP MAKES, and the four ways it must not.
 *
 * A brand-new account can land anywhere after its first sign-in — the home
 * page, a document somebody shared with them, whatever the login carried — so
 * the welcome page cannot be a step in one flow. It is a gate in the shell:
 * wherever they are, they go there once, with where they WERE as the callback.
 *
 * Everything else must pass straight through, and the reasons are each a bug
 * this file exists to prevent: a guest has no welcome page, a session that has
 * not loaded yet knows nothing (a gate that fired on `undefined` would bounce
 * every reader before their session arrived), and /welcome, /login and /start
 * are exempt or the redirect is an infinite loop.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { OnboardingGate } from '@/web/OnboardingGate';

type Session = { user: { id: string; email: string | null } | null; kind: string; onboarded: boolean } | null;
const session = { value: null as Session };
vi.mock('@/web/session', () => ({ useSession: () => ({ session: session.value, reload: () => {}, pages: null, sessionError: null }) }));

afterEach(cleanup);

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

const at = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <OnboardingGate>
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </OnboardingGate>
    </MemoryRouter>,
  );

const newAccount: Session = { user: { id: 'usr_new', email: 'a@b.c' }, kind: 'account', onboarded: false };

describe('the onboarding gate', () => {
  it('sends a new account to the welcome page carrying the address it was on', () => {
    session.value = newAccount;
    at('/@someone/doc?tab=2#note');
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/welcome?callbackUrl=${encodeURIComponent('/@someone/doc?tab=2#note')}`,
    );
  });

  it('never fires at the pages a person could be held on forever', () => {
    session.value = newAccount;
    for (const exempt of ['/welcome', '/login', '/start']) {
      at(exempt);
      expect(screen.getByTestId('where')).toHaveTextContent(exempt);
      cleanup();
    }
  });

  it('leaves guests, anonymous browsers and finished accounts alone', () => {
    for (const value of [
      { user: null, kind: 'none', onboarded: true } as Session,
      { user: null, kind: 'anon', onboarded: true } as Session,
      { user: { id: 'usr_done', email: 'a@b.c' }, kind: 'account', onboarded: true } as Session,
    ]) {
      session.value = value;
      at('/trash');
      expect(screen.getByTestId('where')).toHaveTextContent('/trash');
      cleanup();
    }
  });

  it('waits for the session rather than guessing at it', () => {
    session.value = null;
    at('/trash');
    expect(screen.getByTestId('where')).toHaveTextContent('/trash');
  });
});
