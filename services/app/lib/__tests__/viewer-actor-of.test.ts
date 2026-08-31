/**
 * THE HANDOFF, wave 1: the app reads the actor the proxy ATTACHED to the Request (utils actorOf) first;
 * the signed header stays as a fallback until wave 3 deletes it. A forged header cannot outrank an attached actor.
 */
import { describe, expect, it } from 'vitest';
import { attachActor, signActor } from '@artifactbin/utils';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { sessionActor } from '@/lib/viewer';

describe('sessionActor', () => {
  it('prefers the actor attached to the Request over any header', async () => {
    const req = new Request('http://x/api/page/session', { headers: { [ACTOR_HEADER]: signActor({ credential: 'bearer', tokenId: 'tok_forged' }, 'x'.repeat(32)) } });
    attachActor(req, { credential: 'session', userId: 'usr_attached', email: 'a@example.com', emailVerified: true });
    const actor = await sessionActor(req);
    expect(actor.credential).toBe('session');
    expect(actor.viewer?.userId).toBe('usr_attached');
  });
  it('with nothing attached and no valid header, resolves in-process and answers nobody for an anonymous request', async () => {
    const actor = await sessionActor(new Request('http://x/api/page/session'));
    expect(actor.credential).toBe('none');
    expect(actor.viewer).toBeNull();
  });
});
