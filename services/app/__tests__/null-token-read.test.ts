/**
 * A row's creating token admits its holder, but a null token admits nobody. Anonymous and browser actors carry
 * `tokenId: null`, and so can rows (imported, or anchored to an account), so a bare `actor.tokenId === row.token_id`
 * let a guest and any signed-in stranger read a private document. Every serving door refuses them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { request, setSession, useAppHarness } from '@/__tests__/harness';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as exportRoute } from '@/app/a/[id]/export/route';
import { GET as downloadRoute } from '@/app/a/[id]/download/route';
import { createUser } from '@/lib/accounts';
import { createArtifact } from '@/lib/artifacts';
import { holdsCreatingToken } from '@/lib/artifact-access';
import { artifactPageResponse, readableApp } from '@/lib/document-serving';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
let session: string | null = null;
beforeEach(() => { session = null; setSession(() => (session ? { user: { id: session } } : null)); });

async function world() {
  const owner = (await createUser({ email: 'mxmx_test_nulltoken_owner@example.com' })).id;
  const stranger = (await createUser({ email: 'mxmx_test_nulltoken_stranger@example.com' })).id;
  const secret = await createArtifact(null, owner, { format: 'html', title: 'Imported plan', source: '<!doctype html><p>secret</p>', meta: {}, visibility: 'private' });
  return { owner, stranger, id: secret.id };
}
const doors = (id: string) => ({
  page: () => artifactPageResponse(request(`/a/${id}`), id),
  raw: () => rawRoute(request(`/a/${id}/raw`), params({ id })),
  export: () => exportRoute(request(`/a/${id}/export`), params({ id })),
  download: () => downloadRoute(request(`/a/${id}/download`), params({ id })),
});

describe('a private document with no creating token', () => {
  it('is refused to a guest and to a signed-in stranger on every door', async () => {
    const w = await world();
    for (const who of [null, w.stranger]) {
      session = who;
      for (const [door, open] of Object.entries(doors(w.id))) expect((await open()).status, `${door} as ${who ?? 'guest'}`).toBe(404);
      expect(await readableApp(request(`/a/${w.id}`), w.id)).toBeNull();
    }
  });

  it('still opens for its owner', async () => {
    const w = await world();
    session = w.owner;
    expect((await doors(w.id).page()).status).toBe(200);
    expect((await doors(w.id).raw()).status).toBe(200);
  });
});

describe('holdsCreatingToken', () => {
  it('matches only a real token', () => {
    expect(holdsCreatingToken({ token_id: null }, { tokenId: null })).toBe(false);
    expect(holdsCreatingToken({ token_id: 't1' }, { tokenId: null })).toBe(false);
    expect(holdsCreatingToken({ token_id: null }, { tokenId: 't1' })).toBe(false);
    expect(holdsCreatingToken({ token_id: 't1' }, { tokenId: 't2' })).toBe(false);
    expect(holdsCreatingToken({ token_id: 't1' }, { tokenId: 't1' })).toBe(true);
  });
});
