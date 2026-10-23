import {nativeHtml} from '@/__tests__/native-html-fixture';
import { describe, expect, it } from 'vitest';
import { request, setSession, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser } from '@/lib/accounts';
import { measureQueries } from '@/lib/platform';

useAppHarness();

/**
 * THE KIND DOOR (`/api/page/artifact/:id?part=kind`): what a client navigation to an address it knows nothing about
 * asks FIRST (solid/pages/ArtifactAddress), so a document can be crossed to the server without its page payload being
 * fetched just to learn it is a document. Admitted exactly as the full door is (the same uniform 404 for a missing
 * and a private artifact), answered from the row's header: no document is read, no social counts, no runtime.
 */
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const door = async (id: string, query = 'part=kind', options: Parameters<typeof request>[1] = {}) => {
  const response = await pageRoute(request(`/api/page/artifact/${id}?${query}`, options), params(id));
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() as Record<string, unknown> };
};

async function world() {
  const user = await createUser({ email: 'mxmx_test_kind_door@example.com' });
  const token = await mintToken('kind-door', user.id);
  await claimToken(user.id, token.token);
  const create = async (json: Record<string, unknown>) => {
    const response = await createRoute(request('/api/artifacts', { method: 'POST', json, token: token.token }));
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json() as { id: string }).id;
  };
  return {
    user,
    doc: await create({ html:nativeHtml('<h1>Plan</h1><p>' + 'Body. '.repeat(400) + '</p>'), visibility: 'public' }),
    privateDoc: await create({ html:nativeHtml('<h1>Secret</h1>'), visibility: 'private' }),
    folder: await create({ format: 'folder', title: 'Reports', visibility: 'public' }),
  };
}

describe('the kind door', () => {
  it('names the format of a readable artifact and nothing else', async () => {
    const w = await world();
    expect(await door(w.doc)).toEqual({ status: 200, cache: 'no-store', body: { format: 'html' } });
    expect(await door(w.folder)).toEqual({ status: 200, cache: 'no-store', body: { format: 'folder' } });
  });

  it('refuses a private artifact and a missing one with the full door\'s own uniform 404', async () => {
    const w = await world();
    for (const id of [w.privateDoc, 'doesnotexist']) {
      const full = await door(id, '');
      expect(full.status).toBe(404);
      expect(await door(id)).toEqual(full);
    }
  });

  it('admits its owner to a private artifact', async () => {
    const w = await world();
    setSession({ user: { id: w.user.id, email: w.user.email, emailVerified: true } } as never);
    expect(await door(w.privateDoc)).toEqual({ status: 200, cache: 'no-store', body: { format: 'html' } });
  });

  it('reads no document: fewer statements than the full door, and not more for a page of any size', async () => {
    const w = await world();
    const kind = await measureQueries(() => door(w.doc));
    const full = await measureQueries(() => door(w.doc, ''));
    expect(kind.stats.count).toBeLessThan(full.stats.count);
    expect(kind.stats.count).toBeLessThanOrEqual(4);
  });
});
