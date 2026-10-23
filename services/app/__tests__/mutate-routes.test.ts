import {observedRequest} from '@/__tests__/conditional-request';
/**
 * The WRITE endpoints:
 *  - POST /a/<id>/mutate { mutation, values? } — the DOCUMENT's door. Anyone
 *    who may read the document may run a mutation it DECLARES, with scalar
 *    values only: the SQL is the stored one, the target is resolved by the
 *    document's OWNER (never the link-readable fallback), `access` is
 *    re-checked on every call, and the answer carries the dataset's new
 *    version. Same viewer as the page (session, then the agent cookie; an
 *    opaque-origin document sends nothing and is anonymous by construction).
 *  - POST /api/artifacts/<id>/mutate { sql, values? } — the OWNER's door: the
 *    same engine run against an owned readwrite dataset, no document needed.
 * Every accepted write is a new version with a fresh edit_id, a new
 * content-addressed blob, and a NOTIFY on the dataset's own channel.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as mutateDocRoute } from '@/app/a/[id]/mutate/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as mutateDatasetRoute } from '@/app/api/artifacts/[id]/mutate/route';
import { GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { GET as listVersionsRoute } from '@/app/api/artifacts/[id]/versions/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { setDatasetRowCap } from '@/lib/document-data/dataset-mutate';


import { loadDatasetRows } from '@/lib/datasets/dataset-store';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser } from '@/lib/accounts';
import { useAppHarness, request, type RequestOptions } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', ...body } }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; version: number; edit_id: string };
};
const ROWS = [{ choice: 'ramen', who: 'seed' }, { choice: 'tacos', who: 'seed' }];
const POLL = (ds:string)=>`<!doctype html><html><head><link rel="af-dataset" data-af-name="data" href="ref:${ds}"></head><body>Votes</body></html>`;
const credentials = new Map<string,string>();
const mutate = (doc: string, body: unknown, init: RequestOptions = {}) =>
  mutateDocRoute(request(`/a/${doc}/mutate`, { method: 'POST', token:credentials.get(doc), json: body, ...init }), params({ id: doc }));

async function poll(access = 'readwrite', visibility?: string) {
  const t = await mintToken('t');
  const ds = (await create(t.token, { dataset: ROWS, access })).id;
  const doc = (await create(t.token, { html: POLL(ds), ...(visibility ? { visibility } : {}) })).id;
  credentials.set(doc,t.token);
  return { t, ds, doc };
}

beforeEach(async () => {
  setDatasetRowCap(null);
});

describe('retained SQL writes and native page boundary',()=>{
 it('recovers an idempotent SQL reply without repeating the write and rejects a changed payload',async()=>{
  const {ds,t}=await poll();
  const send=(choice:string)=>mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`,{method:'POST',token:t.token,headers:{'Idempotency-Key':'native-owner-write-0001'},json:{sql:'insert into public.rows(choice,who) values($choice,$who)',values:{choice,who:'agent'}}}),params({id:ds}));
  const first=await send('ramen');expect(first.status).toBe(200);const saved=await first.json();expect(await (await send('ramen')).json()).toEqual(saved);expect((await send('tacos')).status).toBe(409);expect((await getArtifactById(ds))!.version).toBe(2);
 });
 it('archives committed INSERT and DELETE statements with fresh content identities',async()=>{
  const {ds,t}=await poll(),before=(await getArtifactById(ds))!;
  const send=(sql:string)=>mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`,{method:'POST',token:t.token,json:{sql}}),params({id:ds}));
  expect((await send("insert into public.rows(choice,who) values('ramen','jun')")).status).toBe(200);
  const after=(await getArtifactById(ds))!;expect(after.edit_id).not.toBe(before.edit_id);expect(after.meta.objectKey).not.toBe(before.meta.objectKey);
  expect((await send("delete from public.rows where who='seed'")).status).toBe(200);expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{choice:'ramen',who:'jun'}]);
  const versions=await listVersionsRoute(request(`/api/artifacts/${ds}/versions`,{token:t.token}),params({id:ds}));expect((await versions.json()).versions.length).toBeGreaterThanOrEqual(1);
 });
 it('enforces row caps without changing the committed head on refusal',async()=>{
  const {ds,t}=await poll();setDatasetRowCap(3);
  const send=()=>mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`,{method:'POST',token:t.token,json:{sql:"insert into public.rows(choice,who) values('a','agent')"}}),params({id:ds}));
  expect((await send()).status).toBe(200);const full=await send();expect(full.status).toBe(409);expect(await full.json()).toMatchObject({error:'dataset_full'});expect((await getArtifactById(ds))!.version).toBe(2);
 });
 it('retains safe concurrent SQL rebasing for the owner API',async()=>{
  const {ds,t}=await poll();const results=await Promise.all(Array.from({length:6},(_,i)=>mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`,{method:'POST',token:t.token,json:{sql:'insert into public.rows(choice,who) values($choice,$who)',values:{choice:'ramen',who:`w${i}`}}}),params({id:ds}))));
  expect(results.map(r=>r.status)).toEqual([200,200,200,200,200,200]);expect((await getArtifactById(ds))!.version).toBe(7);expect(await loadDatasetRows((await getArtifactById(ds))!)).toHaveLength(8);
 });
 it('never treats a native page link as a declared SQL mutation, even for its owner',async()=>{
  const {ds,doc}=await poll(),before=await getArtifactById(ds);
  for(const body of [{mutation:'vote',args:{choice:'ramen'}},{mutation:'clear',args:{who:'seed'}},{values:{}}])expect((await mutate(doc,body)).status).toBe(400);
  expect(await getArtifactById(ds)).toEqual(before);
 });
 it('preserves private-page ACLs and CSRF before refusing retired declarations',async()=>{
  const user=await createUser({email:'owner@example.test'}),t=await mintToken('t',user.id);await claimToken(user.id,t.token);
  const ds=(await create(t.token,{dataset:ROWS,access:'readwrite'})).id,doc=(await create(t.token,{html:POLL(ds),visibility:'private'})).id;
  expect((await mutate(doc,{mutation:'vote',args:{}})).status).toBe(404);
  const actor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true};
  expect((await mutate(doc,{mutation:'vote',args:{}},{actor,origin:BASE})).status).toBe(400);
  expect((await mutate(doc,{mutation:'vote',args:{}},{actor,origin:'https://evil.example'})).status).toBe(403);expect((await getArtifactById(ds))!.version).toBe(1);
 });
 it('keeps native author code isolated and does not inject obsolete mutation URLs',async()=>{
  const {doc,t}=await poll();const {OPTIONS}=await import('@/app/a/[id]/mutate/route');
  expect((await OPTIONS(request(`/a/${doc}/mutate`,{method:'OPTIONS'}),params({id:doc}))).status).toBe(204);
  const raw=await rawRoute(request(`/a/${doc}/raw`,{token:t.token}),params({id:doc}));expect(raw.status).toBe(200);expect(raw.headers.get('content-security-policy')).toContain('sandbox allow-scripts');expect(await raw.text()).not.toContain('"mutateUrl"');
 });
});

describe('POST /api/artifacts/<id>/mutate — the owner\'s door', () => {
  it('runs the owner\'s own DML against a readwrite dataset; foreign is 404, read-only is 403', async () => {
    const { ds, t } = await poll();
    const res = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `update public.rows set who = $w`, values: { w: 'agent' } } }), params({ id: ds }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()) as object).toMatchObject({ id: ds, version: 2, affected: 2, rowCount: 2 });
    expect((await loadDatasetRows((await getArtifactById(ds))!)).every((r) => r.who === 'agent')).toBe(true);
    const wire = (await (await getArtifactRoute(request(`/api/artifacts/${ds}`, { token: t.token }), params({ id: ds }))).json()) as { rows: unknown[]; version: number };
    expect(wire.version).toBe(2);
    expect(wire.rows).toHaveLength(2);

    const other = await mintToken('o');
    const foreign = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: other.token, json: { sql: `delete from public.rows` } }), params({ id: ds }));
    expect(foreign.status).toBe(404);

    await putArtifactRoute(await observedRequest(`/api/artifacts/${ds}`, { method: 'PUT', token: t.token, json: { dataset: ROWS, access: 'read' } }), params({ id: ds }));
    const ro = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `delete from public.rows` } }), params({ id: ds }));
    expect(ro.status).toBe(403);
    expect(await ro.json()).toMatchObject({error:'dataset_read_only',details:[expect.stringContaining('read-only')]});
  });

  it('a bad statement is invalid_sql with the engine\'s message; a document id is not a dataset', async () => {
    const { ds, doc, t } = await poll();
    const bad = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `select * from public.rows` } }), params({ id: ds }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string; details: string[] })).toMatchObject({ error: 'invalid_sql' });
    const notData = await mutateDatasetRoute(request(`/api/artifacts/${doc}/mutate`, { method: 'POST', token: t.token, json: { sql: 'delete from x' } }), params({ id: doc }));
    expect(notData.status).toBe(400);
  });
});
