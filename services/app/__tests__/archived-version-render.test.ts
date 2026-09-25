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
import { archivedReadOnly } from '@/lib/archived-version';
import {documentEditBody} from './prepared-document';
import { getArtifactById, updateSharingFor } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function twoVersions() {
  const owner = await mintToken('archived-render');
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: '<p>Version one</p>', visibility: 'public' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const head = (await getArtifactById(id))!;
  const replaced = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: documentEditBody(head,{source:'<p>Version two</p>',whole:true}) }), params({ id }));
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

/**
 * WHO MAY OPEN AN OLDER VERSION: exactly whoever may read the artifact's
 * HISTORY — the owner and a named editor (lib/artifacts editorScope), which is
 * the scope `GET /api/my/artifacts/:id/versions/:version` already answers. A
 * viewer-role share may READ this public document and still gets the uniform
 * 404 here: history is not part of reading.
 */
describe('who may open an archived version', () => {
  const account = async (email: string) => {
    const token = await mintToken(email);
    const user = await createUser({ email });
    await claimToken(user.id, token.token);
    return token;
  };

  it('admits an editor share and refuses a viewer share', async () => {
    const { owner, id } = await twoVersions();
    const editor = await account('editor@x.com');
    const reader = await account('reader@x.com');
    const shared = await updateSharingFor({ tokenId: owner.id, userId: null }, id, {
      shares: [{ email: 'editor@x.com', role: 'editor' }, { email: 'reader@x.com', role: 'viewer' }],
    });
    expect(shared?.shares).toEqual([{ email: 'editor@x.com', role: 'editor' }, { email: 'reader@x.com', role: 'viewer' }]);

    const asEditor = await serveArtifact(request(`/a/${id}/raw?version=1`, { token: editor.token }), params({ id }));
    expect(asEditor.status).toBe(200);
    expect(await asEditor.text()).toContain('Version one');

    // A reader who may see the document but not its history learns nothing —
    // not even that the parameter exists.
    expect((await serveArtifact(request(`/a/${id}/raw?version=1`, { token: reader.token }), params({ id }))).status).toBe(404);
    expect((await pageData(request(`/api/page/artifact/${id}?version=1`, { token: reader.token }), params({ id }))).status).toBe(404);
    // …and still reads the head, exactly as before.
    const head = await serveArtifact(request(`/a/${id}/raw`, { token: reader.token }), params({ id }));
    expect(head.status).toBe(200);
    expect(await head.text()).toContain('Version two');
  });

  /*
   * `?version=<head>` renders the head WITH the banner. Save-less editing bumps
   * `version` on every accepted edit while snapshots coalesce, so the current
   * version usually has no `artifact_versions` row at all — resolving it
   * through the archive alone would 404 the one version everyone can see.
   */
  it('renders the head at its own number, with the same banner', async () => {
    const { owner, id } = await twoVersions();
    const res = await serveArtifact(request(`/a/${id}/raw?version=2`, { token: owner.token }), params({ id }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Version two');
    expect(html).toMatch(/version 2 of 2/i);
    // Never cached, and never an address that could be mistaken for the head's.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  /*
   * THE WORDS A REFUSED WRITE SHOWS, carried on the island itself. Dropping
   * `mutateUrl` already disables every control; it disables them saying "This
   * view cannot save changes", which is about the wrong thing — the reader may
   * well be able to edit this document, just not this version of it. The
   * control that draws the reason is pinned in
   * lib/story-runtime/__tests__/runtime-button.ui.test.tsx; what belongs here
   * is that the ROUTE puts it on the document.
   */
  it('tells a hydrating document why it can never write', async () => {
    const owner = await mintToken('archived-readonly');
    const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: '<Helmet><Value name="n" type="number" default={1} /></Helmet><div><p>Version one</p></div>', visibility: 'public' } }));
    expect(created.status, await created.clone().text()).toBe(201);
    const id = (await created.json()).id as string;

    const at = await serveArtifact(request(`/a/${id}/raw?version=1`, { token: owner.token }), params({ id }));
    expect(at.status).toBe(200);
    const html = await at.text();
    expect(html).toContain(archivedReadOnly(1));
    expect(archivedReadOnly(1)).toBe('Version 1 is read-only');
    expect(html).not.toMatch(/mutateUrl|\/mutate/);

    // The head of the same document carries neither.
    const head = await serveArtifact(request(`/a/${id}/raw`, { token: owner.token }), params({ id }));
    expect(await head.text()).not.toContain('read-only');
  });
});
