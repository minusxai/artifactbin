/**
 * THE EDITOR'S DOOR (`?part=editor`, lib/serving/artifact-page): what only writing needs, at a price in step with
 * the document. It once answered the source, the stored graph (twenty fields per node: 23 times the source), the
 * compiled sheet (a flat 135 KB) and the author sheet, none of which the editor read but the graph and the source.
 * Real handlers on the harness's isolated database.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppHarness, request, setSession, mintAccountToken as mintToken } from '@/__tests__/harness';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { measureQueries } from '@/lib/platform';
import { graphSource } from '@/lib/document/document-graph';
import { unpackDocumentGraph, type PackedDocumentGraph } from '@/lib/document/document-graph-wire';

const sessionUser = { id: '', email: '' };
const harness = useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const readPage = async (id: string, search = '') => artifactPage(request(`/api/page/artifact/${id}${search}`), params(id));

const report = (sections: number) => `<h1 id="title">Report</h1>\n${Array.from({ length: sections }, (_, i) =>
  `<section id="s${i}"><h2 id="h${i}">Section ${i}</h2><p id="p${i}">Lorem ipsum dolor sit amet ${i} <strong id="b${i}">bold</strong></p><ul id="u${i}"><li id="a${i}"><p id="ap${i}">One</p></li><li id="b${i}x"><p id="bp${i}">Two</p></li></ul></section>`).join('\n')}`;

async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_editorpart@example.com' }));
  const token = await mintToken('editorpart', owner.id); await claimToken(owner.id, token.token);
  const make = async (markup: string) => {
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: { title: null, markup, visibility: 'public' } }));
    if (made.status !== 201) throw new Error(await made.text());
    return (await made.json() as { id: string }).id;
  };
  return { owner, small: await make(report(3)), large: await make(report(120)) };
}
const asWriter = (owner: { id: string; email: string }) => { sessionUser.id = owner.id; sessionUser.email = owner.email; };

describe('the editor door', () => {
  const shared = harness.shared(world);
  beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; });

  it('answers the source and the graph and nothing the editor does not read', async () => {
    const { owner, small } = shared();
    asWriter(owner);
    const body = await (await readPage(small, '?part=editor')).json();
    expect(Object.keys(body).sort()).toEqual(['editId', 'graph', 'source', 'version']);
    for (const dead of ['compiledCss', 'authorCss', 'document']) expect(body).not.toHaveProperty(dead);
  });

  it('costs a small multiple of the source, however large the document', async () => {
    const { owner, small, large } = shared();
    asWriter(owner);
    for (const id of [small, large]) {
      const text = await (await readPage(id, '?part=editor')).text();
      const { source } = JSON.parse(text);
      // The source, the node keys (36 characters each, the one thing only the server knows) and a fixed envelope.
      expect(text.length).toBeLessThan(source.length * 4 + 1000);
    }
  });

  it('inflates, from the answer alone, to exactly the graph the server stores', async () => {
    const { owner, large } = shared();
    asWriter(owner);
    const body = await (await readPage(large, '?part=editor')).json() as { source: string; graph: PackedDocumentGraph };
    const stored = (await getArtifactById(large))!.document!;
    const graph = unpackDocumentGraph(body.graph, body.source);
    expect(graph).toEqual(stored);
    expect(graphSource(graph)).toBe(body.source);
  });

  it('answers the stored graph whole when asked (?graph=full), the escape for a wire form that does not hold', async () => {
    const { owner, small } = shared();
    asWriter(owner);
    const body = await (await readPage(small, '?part=editor&graph=full')).json();
    expect(body.document).toEqual((await getArtifactById(small))!.document);
    expect(body).not.toHaveProperty('graph');
  });

  it('is a writer\'s alone', async () => {
    const { small } = shared();
    expect((await readPage(small, '?part=editor')).status).toBe(404);
  });

  it('reads no prepared page and no more statements for a large document than a small one', async () => {
    const { owner, small, large } = shared();
    asWriter(owner);
    const cost = async (id: string) => (await measureQueries(() => readPage(id, '?part=editor'))).stats.count;
    const [first, second] = [await cost(small), await cost(large)];
    expect(second).toBe(first);
    const db = await harness.db();
    await db.query('DELETE FROM prepared_pages');
    expect((await readPage(small, '?part=editor')).status).toBe(200);
    expect((await db.query('SELECT 1 FROM prepared_pages')).rows).toHaveLength(0);
  });

  it('tells a writer, and only a writer, how large the document is, so the page prefetches the cheap ones only', async () => {
    const { owner, small, large } = shared();
    expect((await (await readPage(small)).json()).surface).not.toHaveProperty('sourceLength');
    asWriter(owner);
    const [lengthSmall, lengthLarge] = await Promise.all([small, large].map(async (id) => (await (await readPage(id)).json()).surface.sourceLength as number));
    expect(lengthSmall).toBe((await (await readPage(small, '?part=editor')).json()).source.length);
    expect(lengthLarge).toBeGreaterThan(lengthSmall * 10);
  });
});
