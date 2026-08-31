/** Wave 3: the app reads ONLY the actor attached to the Request. A signed header alone — even with the old secret set — is nobody. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signActor } from '@artifactbin/utils';
import { ACTOR_HEADER } from '@artifactbin/contracts';

const SECRET = 's'.repeat(32);
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('sessionActor without the fallback', () => {
  it('a signed header alone is nobody: the fallback is gone', async () => {
    vi.stubEnv('CONTRACT__ACTOR_SECRET', SECRET); vi.resetModules();
    const { sessionActor } = await import('@/lib/viewer');
    const req = new Request('http://x/api/page/session', { headers: { [ACTOR_HEADER]: signActor({ credential: 'session', userId: 'usr_header', email: 'h@example.com', emailVerified: true }, SECRET) } });
    const actor = await sessionActor(req);
    expect(actor.credential).toBe('none');
    expect(actor.viewer).toBeNull();
  });
});
