/** The app's `users` row is created lazily from the session actor the proxy attaches — the boot-time "adopt" sync is gone. */
import { describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';

import { sessionActor } from '@/lib/viewer';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

const rows = async () => (await (await harness.db()).query<{ id: string; email: string }>('SELECT id, email FROM users ORDER BY id')).rows;

describe('lazy users upsert', () => {
  it('a session actor the app has never seen creates its users row on the first request', async () => {
    await sessionActor(attachActor(new Request('http://localhost/api/page/session'), { credential: 'session', userId: 'usr_new1', email: 'new@example.com', emailVerified: true }));
    expect(await rows()).toEqual([{ id: 'usr_new1', email: 'new@example.com' }]);
  });
  it('a changed email updates the row, and an unchanged one does not re-write it', async () => {
    const r = () => new Request('http://localhost/api/page/session');
    await sessionActor(attachActor(r(), { credential: 'session', userId: 'usr_x', email: 'one@example.com', emailVerified: true }));
    await sessionActor(attachActor(r(), { credential: 'session', userId: 'usr_x', email: 'two@example.com', emailVerified: true }));
    expect(await rows()).toEqual([{ id: 'usr_x', email: 'two@example.com' }]);
  });
  it('a bearer actor creates nothing', async () => {
    await sessionActor(attachActor(new Request('http://localhost/api/artifacts'), { credential: 'bearer', tokenId: 'tok_1' }));
    expect(await rows()).toEqual([]);
  });
});
