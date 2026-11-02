/** Account-owned publication survives login; unrelated accounts retain private access boundaries. */
import { beforeEach, expect, it } from 'vitest';
import { useAppHarness, request, setSession, mintAccountToken } from '@/__tests__/harness';
import { observedRequest } from '@/__tests__/conditional-request';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { GET as listMineRoute } from '@/app/api/my/artifacts/route';
import { GET as getMineRoute } from '@/app/api/my/artifacts/[id]/route';

useAppHarness();
beforeEach(() => setSession(null));

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function publish(token: string, title: string, visibility?: string) {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { title, html: `<h1>${title}</h1>`, ...(visibility ? { visibility } : {}) } }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; visibility: string };
}

it('the account lists what its connection published, and the connection still edits after the person signs in again', async () => {
  const connection = await mintAccountToken('claim-connection');
  const kept = await publish(connection.token, 'Quarterly Review');
  await publish(connection.token, 'Scratch Notes');
  setSession({ user: { id: connection.userId!, email: connection.email! } });
  const listed = await listMineRoute(request('/api/my/artifacts'));
  expect(listed.status).toBe(200);
  const titles = ((await listed.json()) as { artifacts: Array<{ title: string }> }).artifacts.map((a) => a.title).sort();
  expect(titles).toEqual(expect.arrayContaining(['Quarterly Review', 'Scratch Notes']));
  const edited = await putArtifactRoute(await observedRequest(`/api/artifacts/${kept.id}`, { method: 'PUT', token: connection.token, json: { html: '<h1>Updated after login</h1>' } }), params(kept.id));
  expect(edited.status).toBe(200);
  expect(((await edited.json()) as { id: string }).id).toBe(kept.id);
});

it('keeps an unrelated account connection private', async () => {
  const account = await mintAccountToken('claim-account');
  const stranger = await mintAccountToken('claim-stranger');
  const unrelated = await publish(stranger.token, 'Not Yours', 'private');
  setSession({ user: { id: account.userId!, email: account.email! } });
  expect((await getMineRoute(request(`/api/my/artifacts/${unrelated.id}`), params(unrelated.id))).status).toBe(404);
});
