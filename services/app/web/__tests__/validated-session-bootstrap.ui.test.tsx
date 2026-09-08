import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { cleanup(); document.getElementById('mx-page-data')?.remove(); vi.unstubAllGlobals(); vi.resetModules(); });

it('uses the server-validated session before the first client paint', async () => {
  vi.resetModules();
  const payload = document.createElement('script');
  payload.type = 'application/json'; payload.id = 'mx-page-data';
  payload.textContent = JSON.stringify({ path: '/', session: { kind: 'account', user: { id: 'qa_account', email: null }, mixpanel: { token: null, host: '' } }, presentation: 'workspace', ssr: false });
  document.head.append(payload);
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  const { SessionProvider, useSession } = await import('../session');
  function Probe() { const { session } = useSession(); return <p>{session?.user?.id ?? 'Pending session'}</p>; }
  render(<SessionProvider><Probe /></SessionProvider>);
  expect(screen.getByText('qa_account')).toBeVisible();
  expect(screen.queryByText('Pending session')).toBeNull();
});
