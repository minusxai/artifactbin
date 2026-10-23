import { beforeEach, expect, it } from 'vitest';
import { useAppHarness, request, setSession, mintAccountToken } from '@/__tests__/harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { GET as listAnnotations, POST as browserComment } from '@/app/api/my/artifacts/[id]/annotations/route';
import { POST as apiComment } from '@/app/api/artifacts/[id]/annotations/route';
import { createUser, claimToken, ensureUsername } from '@/lib/accounts';
import { htmlTextFingerprint } from '@artifactbin/contracts';
const harness = useAppHarness();
let account: { id: string; email: string } | null = null;
beforeEach(() => setSession(() => account ? { user: account } : null));
const html = '<!doctype html><html><body><p data-af-id="n1">same words</p><p data-af-id="n2">same words</p></body></html>';
async function page() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_html_comments@example.com' }));
  account = { id: owner.id, email: owner.email! };
  const token = await mintAccountToken('html-comments', owner.id); await claimToken(owner.id, token.token);
  const made = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { markup: '<p id="body">seed</p>', visibility: 'public' } }));
  expect(made.status).toBe(201);
  const { id } = await made.json() as { id: string };
  const db = await harness.db();
  await db.query("UPDATE artifacts SET format='html', document=NULL,source=$2 WHERE id=$1", [id, html]);
  return { id, db, token: token.token, params: { params: Promise.resolve({ id }) } };
}
const anchor = { kind: 'html-node', v: 1, revision: '1', nodeId: 'n1', quote: 'same words', range: { start: 0, end: 10, length: 10, fingerprint: htmlTextFingerprint('same words') } };
it('persists the explicit HTML discriminator and original selection, and never retargets a removed node', async () => {
  const { id, db, params } = await page();
  const made = await browserComment(request(`/api/my/artifacts/${id}/annotations`, { method: 'POST', json: { anchor, body: 'Check this selection' } }), params);
  expect(made.status).toBe(201);
  expect(await made.json()).toMatchObject({ anchor, orphaned: false, quote_found: true });
  const saved = await db.query('SELECT html_anchor,anchor_key FROM annotations WHERE artifact_id=$1', [id]);
  expect(saved.rows[0]).toMatchObject({ html_anchor: anchor, anchor_key: 'n1' });
  await db.query('UPDATE artifacts SET source=$2,version=2 WHERE id=$1', [id, '<p data-af-id="n2">same words</p>']);
  const listing = await listAnnotations(request(`/api/my/artifacts/${id}/annotations`), params);
  expect(await listing.json()).toMatchObject({ annotations: [{ anchor, orphaned: true, quote_found: false, quote: 'same words', anchor_version: 1 }] });
});
it('rejects stale revisions and conflicting compiler coordinates; API comments use the same anchor contract', async () => {
  const { id, params, token } = await page();
  const post = (body: unknown) => browserComment(request(`/api/my/artifacts/${id}/annotations`, { method: 'POST', json: body }), params);
  expect((await post({ anchor: { ...anchor, revision: '0' }, body: 'stale' })).status).toBe(409);
  expect((await post({ anchor, node_id: 'n1', body: 'ambiguous protocol' })).status).toBe(400);
  expect((await post({ anchor: { ...anchor, range: { ...anchor.range, fingerprint: 'invalid' } }, body: 'invalid capture' })).status).toBe(400);
  const made = await apiComment(request(`/api/artifacts/${id}/annotations`, { method: 'POST', token, json: { anchor, body: 'API selection' } }), params);
  expect(made.status).toBe(201);
  expect(await made.json()).toMatchObject({ anchor });
  account = null;
  expect((await post({ anchor, body: 'guest' })).status).toBeGreaterThanOrEqual(400);
});
