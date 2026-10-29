import { expect, it } from 'vitest';
import { POST as query } from '@/app/api/artifacts/[id]/query/route';
import { POST as create } from '@/app/api/artifacts/route';
import { POST as like } from '@/app/api/my/artifacts/[id]/like/route';
import { nativeHtml } from './native-html-fixture';
import { accountProfile } from '@/lib/artifacts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken } from '@/lib/authentication';
import { createUser } from '@/lib/accounts';
import { count, has, link } from '@/lib/social';
import { request, useAppHarness } from './harness';
useAppHarness();
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function account(label: string) {
  const user = await createUser({
    email: `mxmx_test_likes_${label}@example.com`,
  });
  const token = await mintToken(label, user.id);
  await claimToken(user.id, token.token);
  return { user, token };
}
async function publish(token: string, body: object) {
  const response = await create(
    request('/api/artifacts', { method: 'POST', token, json: body }),
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).id as string;
}
it('creates and claims artifacts without automatically liking them', async () => {
  const a = await account('owner');
  const id = await publish(a.token.token, { html: nativeHtml('<p>App</p>') });
  expect(await has(a.user.id, 'like', id)).toBe(false);
  expect(await count('like', id)).toBe(0);
  const anonymous = await mintToken('unclaimed');
  const claimed = await publish(anonymous.token, {
    html: nativeHtml('<p>Claimed</p>'),
  });
  await claimToken(a.user.id, anonymous.token);
  expect(await has(a.user.id, 'like', claimed)).toBe(false);
  await link(a.user.id, 'like', id);
  expect(await count('like', id)).toBe(1);
  expect((await accountProfile(a.user.id))!.liked).toContain(id);
});
it('does not provide an implicit likes query table or membership scope', async () => {
  const a = await account('namespace');
  const dataset = await publish(a.token.token, { dataset: [{ who: null }] });
  const hidden = await query(
    request(`/api/artifacts/${dataset}/query`, {
      method: 'POST',
      token: a.token.token,
      json: { sql: 'select * from _likes' },
    }),
    ctx(dataset),
  );
  expect(hidden.status).toBe(400);
  for (const scope of ['_likes', 'likes:abc123']) {
    const response = await create(
      request('/api/artifacts', {
        method: 'POST',
        token: a.token.token,
        json: {
          dataset: [{ who: null }],
          columns: [
            { name: 'who', type: 'user', constraints: { memberOf: [scope] } },
          ],
        },
      }),
    );
    expect(response.status).toBe(400);
  }
});
it('requires a signed-in session for likes and never accepts a chosen actor from the request', async () => {
  const owner = await account('guest'),
    other = await account('other');
  const id = await publish(owner.token.token, {
    visibility: 'public',
    html: nativeHtml('<p>App</p>'),
  });
  const anonymous = await like(
    request(`/api/my/artifacts/${id}/like`, {
      method: 'POST',
      json: { userId: owner.user.id },
    }),
    ctx(id),
  );
  expect(anonymous.status).toBe(401);
  expect(await anonymous.json()).toMatchObject({ error: 'sign_in_required' });
  expect(await count('like', id)).toBe(0);
  const signed = await like(
    request(`/api/my/artifacts/${id}/like`, {
      method: 'POST',
      actor: {
        credential: 'session',
        userId: other.user.id,
        email: other.user.email,
        emailVerified: true,
      },
      json: { userId: owner.user.id, likes: [owner.user.id] },
    }),
    ctx(id),
  );
  expect(signed.status).toBe(200);
  expect(await signed.json()).toEqual({ liked: true, count: 1 });
  expect(await has(owner.user.id, 'like', id)).toBe(false);
  expect(await has(other.user.id, 'like', id)).toBe(true);
});
