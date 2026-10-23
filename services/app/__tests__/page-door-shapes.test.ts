import { describe, expect, it } from 'vitest';
import { useAppHarness, request, mintAccountToken } from './harness';
import { createUser } from '@/lib/accounts';
import { POST as publish } from '@/app/api/artifacts/route';
import { POST as createBrowserArtifact } from '@/app/api/my/artifacts/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { artifactStarter } from '@/lib/workspace/artifact-starters';

useAppHarness();

/**
 * THE JSON DOOR'S SHAPE, per kind of artifact. The door trims a FRAMED DOCUMENT's runtime to what the app reads
 * (__tests__/page-payload-budget); everything else it answers keeps its shape exactly. These key lists were
 * recorded from the answer before that trim and are asserted deep-equal after it: a folder, a dataset, a program and
 * the starter placeholder's read view must not move.
 */
const OWNER = 'mxmx_test_door_shapes@example.com';

/** The structure of a value: sorted keys, and the type of each leaf (an array by its first element). Ids make map keys volatile, so `views` is a single entry. */
const shape = (value: unknown): unknown => Array.isArray(value) ? [value.length ? shape(value[0]) : 'empty']
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, k === 'views' && v && typeof v === 'object' && !Array.isArray(v) ? 'byId' : shape(v)]))
  : value === null ? 'null' : typeof value;

async function world() {
  const owner = await createUser({ email: OWNER });
  const token = await mintAccountToken('shapes', owner.id);
  const actor = { credential: 'session' as const, userId: owner.id, email: owner.email!, emailVerified: true };
  const make = async (json: Record<string, unknown>) => (await (await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'private', destination: { type: 'personal' }, ...json } }))).json() as { id: string }).id;
  const answer = async (id: string) => {
    const res = await pageRoute(request(`/api/page/artifact/${id}`, { actor }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    return await res.json() as Record<string, any>;
  };
  return { owner, actor, make, answer };
}

const BASE_SURFACE = ['accountSession', 'anonSession', 'author', 'captureKey', 'colorMode', 'columns', 'dataPreview', 'editId', 'format', 'group_id', 'hasInvitedUsers', 'id', 'membershipAvailable', 'openAnnotations', 'pwaEnabled', 'refs', 'template', 'theme', 'title', 'version', 'visibility'];
const DOC_TOP = ['canonical', 'description', 'follow', 'kind', 'like', 'role'];

describe('the JSON door keeps the shape of everything that is not a framed document', () => {
  it('a folder is a listing with no surface', async () => {
    const w = await world();
    const folder = await w.make({ format: 'folder', title: 'Shelf' });
    await w.make({ title: 'Filed', html: '<p>filed</p>', parent_id: folder });
    const body = await w.answer(folder);
    expect(shape({ ...body, workspace: undefined })).toEqual({
      canonical: 'string', kind: 'string', ownerUsername: 'string', role: 'string', workspace: 'undefined',
      folder: {
        count: { documents: 'number', folders: 'number' }, id: 'string', title: 'string', trail: ['empty'],
        rows: [{ ancestor_ids: ['string'], format: 'string', id: 'string', parent_id: 'string', title: 'string', updated_at: 'string', url: 'string', version: 'number', views: 'number', visibility: 'string' }],
      },
    });
    // The owner's workspace summary rides beside it. Which artifact leads its list is not fixed, so only its row keys are.
    expect(Object.keys(body.workspace).sort()).toEqual(['artifacts', 'followers', 'forks', 'likes', 'likesOverTime', 'shared', 'stats', 'views', 'viewsOverTime']);
    expect(Object.keys(body.workspace.artifacts[0]).sort()).toEqual(['ancestor_ids', 'format', 'id', 'title', 'updated_at', 'url', 'version', 'views', 'visibility']);
    expect(shape(body.workspace.stats)).toEqual({ artifacts: 'number', assets: 'number', views: 'number' });
  });

  it('a dataset answers its source, sheet, columns and catalog, with no runtime', async () => {
    const w = await world();
    const body = await w.answer(await w.make({ dataset: [{ n: 1 }, { n: 2 }] }));
    expect(Object.keys(body).sort()).toEqual(DOC_TOP.concat('surface').sort());
    expect(Object.keys(body.surface).sort()).toEqual([...BASE_SURFACE, 'catalog', 'compiledCss', 'source'].sort());
    expect(shape(body.surface.catalog)).toEqual({ defaultSchema: 'string', kind: 'string', refreshSeconds: 'number', tables: [{ columns: [{ name: 'string', type: 'string' }], name: 'string', schema: 'string' }] });
  });

  it('rejects creation of a retired program without exposing a page surface', async () => {
    const w=await world();
    const token=await mintAccountToken('retired-program',w.owner.id);
    const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{program:{version:1,command:['node','-e','1']}}}));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({error:'unsupported_format'});
  });

  it('a native starter carries only the minimal framed runtime', async () => {
    const w = await world();
    const created = await createBrowserArtifact(request('/api/my/artifacts', { method: 'POST', actor: w.actor, json: artifactStarter('deck') }));
    const body = await w.answer((await created.json() as { id: string }).id);
    expect(Object.keys(body).sort()).toEqual([...DOC_TOP, 'surface'].sort());
    expect(Object.keys(body.surface).sort()).toEqual([...BASE_SURFACE, 'heading', 'runtime', 'starter'].sort());
    expect(body.surface.starter).toBe(false);
    expect(shape(body.surface.runtime)).toEqual({data:{},title:'string'});
  });

  it('a framed document answers the title and declared dataflow only', async () => {
    const w = await world();
    const body = await w.answer(await w.make({ html: '<h1 id="t">Hello</h1><p id="p">World</p>' }));
    expect(Object.keys(body.surface).sort()).toEqual([...BASE_SURFACE, 'heading', 'runtime', 'starter'].sort());
    expect(body.surface.starter).toBe(false);
    expect(shape(body.surface.runtime)).toEqual({ data: {}, title: 'string' });
  });
});
