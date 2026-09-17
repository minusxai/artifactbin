/**
 * AN OLDER VERSION, IN THE BROWSER. `?version=N` on the served document renders that archived
 * version read-only for whoever may read the version history (the owner and editors), so a
 * live session can drive it and an image export can photograph it. Nobody else learns it exists.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as replaceRoute } from '@/app/api/artifacts/[id]/route';
import { artifactState } from '@/lib/artifact-state';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function twoVersions() {
  const owner = await mintToken('archived-render');
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: '<p>Version one</p>', visibility: 'public' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const head = (await getArtifactById(id))!;
  const replaced = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: { markup: '<p>Version two</p>', expectedVersion: 1, expectedState: artifactState(head) } }), params({ id }));
  expect(replaced.status, await replaced.clone().text()).toBe(200);
  return { owner, id };
}

describe('?version=N on the served document', () => {
  it('renders the archived version read-only for its owner, and the head without it', async () => {
    const { owner, id } = await twoVersions();
    const old = await serveArtifact(request(`/a/${id}/raw?version=1`, { token: owner.token }), params({ id }));
    expect(old.status).toBe(200);
    const html = await old.text();
    expect(html).toContain('Version one');
    expect(html).not.toContain('Version two');
    expect(html).toMatch(/version 1 of 2/i);
    expect(html).not.toMatch(/mutateUrl|\/mutate/);
    const head = await serveArtifact(request(`/a/${id}/raw`, { token: owner.token }), params({ id }));
    expect(await head.text()).toContain('Version two');
  });

  it('is not found for a reader who cannot read the version history, and for a version that does not exist', async () => {
    const { owner, id } = await twoVersions();
    expect((await serveArtifact(request(`/a/${id}/raw?version=1`), params({ id }))).status).toBe(404);
    expect((await serveArtifact(request(`/a/${id}/raw?version=9`, { token: owner.token }), params({ id }))).status).toBe(404);
    expect((await serveArtifact(request(`/a/${id}/raw?version=x`, { token: owner.token }), params({ id }))).status).toBe(404);
  });

  it('tells the page which archived version it is showing', async () => {
    const { owner, id } = await twoVersions();
    const data = await pageData(request(`/api/page/artifact/${id}?version=1`, { token: owner.token }), params({ id }));
    expect(data.status, await data.clone().text()).toBe(200);
    const body = await data.json();
    expect(body.archived).toEqual({ version: 1, head: 2 });
    expect(JSON.stringify(body)).toContain('Version one');
  });
});
