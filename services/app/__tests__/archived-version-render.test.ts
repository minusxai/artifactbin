import {POST as pageMutation} from '@/app/api/artifacts/[id]/graphql/route';
/**
 * AN OLDER VERSION, IN THE BROWSER. `?version=N` on the served document renders that archived
 * version read-only for whoever may read the version history (the owner and editors), so a
 * live session can drive it and an image export can photograph it. Nobody else learns it exists.
 *
 * The line that says WHICH version this is ("Version 1 of 2 · read-only") is the app bar's
 * (solid/document/DocumentChrome, pinned in solid/__tests__/document-chrome.test.tsx), drawn
 * around the document's frame from the page answer's `archived`; the served document itself
 * carries no chrome. So the numbers are asserted on the page answer and the bytes on `/raw`.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as replaceRoute } from '@/app/api/artifacts/[id]/route';
import {nativeHtml} from './native-html-fixture';
import {observedRequest} from './conditional-request';
import { updateSharingFor } from '@/lib/artifacts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { claimToken } from '@/lib/authentication';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** What the page answer tells the app bar about the version it is showing (null for the head). */
async function archivedOf(id: string, token: string, query = '') {
  const data = await pageData(request(`/api/page/artifact/${id}${query}`, { token }), params({ id }));
  expect(data.status, await data.clone().text()).toBe(200);
  return ((await data.json()) as { archived?: { version: number; head: number } | null }).archived ?? null;
}

async function twoVersions() {
  const owner = await mintToken('archived-render');
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { html: nativeHtml('<p>Version one</p>'), visibility: 'public' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const replaced = await replaceRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: {html:nativeHtml('<p>Version two</p>')} }), params({ id }));
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
    expect(html).not.toMatch(/mutateUrl|\/mutate/);
    expect(await archivedOf(id, owner.token, '?version=1')).toEqual({ version: 1, head: 2 });
    const head = await serveArtifact(request(`/a/${id}/raw`, { token: owner.token }), params({ id }));
    expect(await head.text()).toContain('Version two');
    expect(await archivedOf(id, owner.token)).toBeNull();
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
    // The version's tree is the nodes door's, asked for with the same address.
    const tree = await pageData(request(`/api/page/artifact/${id}?version=1&part=nodes`, { token: owner.token }), params({ id }));
    expect(tree.status).toBe(200);
    const text = JSON.stringify(await tree.json());
    expect(JSON.parse(text)).toMatchObject({version:1,nodes:[]});
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
    const user = await createUser({ email });
    const token = await mintToken(email, user.id);
    await claimToken(user.id, token.token);
    return token;
  };

  it('admits an editor share and refuses a viewer share', async () => {
    const { owner, id } = await twoVersions();
    const editor = await account('editor@x.com');
    const reader = await account('reader@x.com');
    const shared = await updateSharingFor(identityForUser(owner.userId, owner.id), id, {
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
    expect(await archivedOf(id, owner.token, '?version=2')).toEqual({ version: 2, head: 2 });
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
  it('refuses an HTTP mutation from an archived revision without changing the head', async () => {
    const {owner,id}=await twoVersions();
    const response=await pageMutation(request(`/api/artifacts/${id}/graphql`,{
      method:'POST',token:owner.token,json:{revision:'1',query:'mutation { tasks { add(title:"forbidden") { id } } }'},
    }),params({id}));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({error:'archived_page_readonly'});
    const head=await serveArtifact(request(`/a/${id}/raw`,{token:owner.token}),params({id}));
    expect(head.status).toBe(200);expect(await head.text()).toContain('Version two');
  });
});
