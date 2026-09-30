/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { createMemoryHistory, MemoryRouter, Route, useLocation, useNavigate } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { OnboardingGate } from '../OnboardingGate';

const [session, setSession] = createSignal<{ user: { id: string } | null; onboarded: boolean } | null>(null);
vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session }) }));
let navigate: ReturnType<typeof useNavigate> | undefined;
function Where() { const location = useLocation(); navigate = useNavigate(); return <p data-testid="where">{location.pathname}{location.search}{location.hash}</p>; }
function at(path: string) { const history = createMemoryHistory(); history.set({ value: path, replace: true }); return render(() => <MemoryRouter history={history}><Route path="*" component={() => <OnboardingGate><Where /></OnboardingGate>} /></MemoryRouter>); }
afterEach(() => { cleanup(); setSession(null); navigate = undefined; });

it('waits for identity and sends an unonboarded account to welcome with its return address', async () => {
  at('/@owner/story?tab=2#note');
  expect(screen.getByTestId('where')).toHaveTextContent('/@owner/story?tab=2#note');
  setSession({ user: { id: 'new' }, onboarded: false });
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/welcome?callbackUrl=${encodeURIComponent('/@owner/story?tab=2#note')}`));
});

it('exempts welcome, login, start, and guests', async () => {
  for (const path of ['/welcome', '/login', '/start']) {
    setSession({ user: { id: 'new' }, onboarded: false });
    at(path);
    expect(screen.getByTestId('where')).toHaveTextContent(path);
    cleanup();
  }
  setSession({ user: null, onboarded: false });
  at('/');
  expect(screen.getByTestId('where')).toHaveTextContent('/');
});

it('keeps a pending intent on its route until navigation leaves it', async () => {
  setSession({ user: { id: 'new' }, onboarded: false });
  at('/@owner/story?intent=fork');
  expect(screen.getByTestId('where')).toHaveTextContent('/@owner/story?intent=fork');
  navigate?.('/@owner/story', { replace: true });
  expect(screen.getByTestId('where')).toHaveTextContent('/@owner/story');
  navigate?.('/@owner/other');
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/welcome?callbackUrl=${encodeURIComponent('/@owner/other')}`));
});
