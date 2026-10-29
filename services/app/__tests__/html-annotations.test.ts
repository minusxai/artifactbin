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
  const made = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { html, visibility: 'public' } }));
  expect(made.status).toBe(201);
  const { id } = await made.json() as { id: string };
  const db = await harness.db();
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
  const unverified=await post({ anchor: { ...anchor, range: { ...anchor.range, fingerprint: 'invalid' } }, body: 'Unverified capture' });
  expect(unverified.status).toBe(201);
  expect(await unverified.json()).toMatchObject({quote_found:false});
  const made = await apiComment(request(`/api/artifacts/${id}/annotations`, { method: 'POST', token, json: { anchor, body: 'API selection' } }), params);
  expect(made.status).toBe(201);
  expect(await made.json()).toMatchObject({ anchor });
  account = null;
  expect((await post({ anchor, body: 'guest' })).status).toBeGreaterThanOrEqual(400);
});
it('answers 400 naming anchor.revision when the revision is not a version number, and 409 with the current version only when stale', async () => {
  const { id, params, token } = await page();
  const api = (revision: string) => apiComment(request(`/api/artifacts/${id}/annotations`, { method: 'POST', token, json: { anchor: { ...anchor, revision }, body: 'revision check' } }), params);
  for (const bad of ['3f9a0c1d2b4e', 'ed_abc123']) {
    const refused = await api(bad);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: 'invalid_annotation_revision', field: 'anchor.revision' });
  }
  const stale = await api('0');
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: 'stale', current_revision: '1' });
});
it('preserves a native fractional area beside its stable HTML identity',async()=>{
 const {id,params,token}=await page();
 const area={v:1,kind:'area',box:{x:0.1,y:0.2,w:0.3,h:0.4}};
 const selected={...anchor,quote:'',range:undefined};
 const made=await browserComment(request(`/api/my/artifacts/${id}/annotations`,{method:'POST',json:{anchor:selected,range:area,body:'This area'}}),params);
 expect(made.status).toBe(201);
 expect(await made.json()).toMatchObject({anchor:{kind:'html-node',nodeId:'n1'},range:area});
 const api=await apiComment(request(`/api/artifacts/${id}/annotations`,{method:'POST',token,json:{anchor:selected,range:area,body:'API area'}}),params);
 expect(api.status).toBe(201);expect(await api.json()).toMatchObject({range:area});
 const contradictory=await browserComment(request(`/api/my/artifacts/${id}/annotations`,{method:'POST',json:{anchor,range:area,body:'Contradictory words'}}),params);
 expect(contradictory.status).toBe(400);
});
it('accepts bounded rendered text under a saved stable parent without claiming source verification',async()=>{
 const {id,db,params}=await page();
 await db.query("UPDATE artifacts SET source='<div data-af-id=\"n1\"></div>' WHERE id=$1",[id]);
 const rendered='Runtime job label';
 const captured={...anchor,quote:rendered,range:{start:0,end:rendered.length,length:rendered.length,fingerprint:htmlTextFingerprint(rendered)}};
 const made=await browserComment(request(`/api/my/artifacts/${id}/annotations`,{method:'POST',json:{anchor:captured,body:'Dynamic label'}}),params);
 expect(made.status).toBe(201);
 expect(await made.json()).toMatchObject({anchor:captured,orphaned:false,quote_found:false});
 const unknown=await browserComment(request(`/api/my/artifacts/${id}/annotations`,{method:'POST',json:{anchor:{...captured,nodeId:'missing'},body:'Unknown identity'}}),params);
 expect(unknown.status).toBe(400);
 const withoutParent=await browserComment(request(`/api/my/artifacts/${id}/annotations`,{method:'POST',json:{anchor:{...captured,nodeId:null,range:undefined},body:'No stable parent'}}),params);
 expect(withoutParent.status).toBe(400);
});
it('stores dynamic targets only beneath a persisted ancestor, without claiming the target exists in source',async()=>{
 const {id,db,params}=await page();
 await db.query("UPDATE artifacts SET source='<ul data-af-id=\"tasks\"></ul>' WHERE id=$1",[id]);
 const dynamic={kind:'html-node',v:1,revision:'1',nodeId:'task:123',ancestorId:'tasks',quote:'Finish review'};
 const post=(anchor:unknown)=>browserComment(request(`/api/my/artifacts/${id}/annotations`,{method:'POST',json:{anchor,body:'Dynamic task'}}),params);
 const made=await post(dynamic);expect(made.status).toBe(201);
 expect(await made.json()).toMatchObject({anchor:dynamic,orphaned:false,quote_found:false});
 expect((await post({...dynamic,ancestorId:'missing'})).status).toBe(400);
 expect((await post({...dynamic,ancestorId:undefined})).status).toBe(400);
 await db.query("UPDATE artifacts SET source='<ul data-af-id=\"other\"></ul>',version=2 WHERE id=$1",[id]);
 const listing=await listAnnotations(request(`/api/my/artifacts/${id}/annotations`),params);
 expect(await listing.json()).toMatchObject({annotations:[{anchor:dynamic,orphaned:true}]});
});
