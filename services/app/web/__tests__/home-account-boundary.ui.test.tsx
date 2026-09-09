import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { HomePage } from '../pages/Home';
import { SessionProvider } from '../session';

vi.mock('@/components/viz/VegaChart', () => ({ VegaChart: () => <div /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['core', 'insights'])('rejects a %s payload stamped for another account', async part => {
  const session = { kind: 'account', user: { id: 'current', email: null } };
  const core = { signedIn: true, accountId: part === 'core' ? 'other' : 'current', artifacts: [{ id: 'ABC123', url: '/a/ABC123', title: 'Private row', format: 'markup', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-09', views: 0 }], shared: [] };
  const insights = { signedIn: true, accountId: part === 'insights' ? 'other' : 'current', sparklines: {}, feed: { mine: [], following: [] } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/session') ? session : url.includes('part=core') ? core : insights))));
  render(<MemoryRouter><SessionProvider><HomePage /></SessionProvider></MemoryRouter>);
  await screen.findByLabelText('Retry workspace');
  expect(screen.queryByLabelText('Open Private row')).toBeNull();
});
