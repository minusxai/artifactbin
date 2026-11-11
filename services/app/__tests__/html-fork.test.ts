import {expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import { identityForUser } from '@/lib/accounts';
import {getArtifactById} from '@/lib/artifacts';
import {forkArtifact} from '@/lib/publish';
const harness=useAppHarness();
it('does not grant a fork owner access to a private linked dataset or commit a partial copy',async()=>{
 const owner=await mintAccountToken('dataset-source');const viewer=await mintAccountToken('dataset-forker');
 const dataset=await (await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{value:1}],visibility:'private'}}))).json();
 const created=await (await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:`<html><head><link rel="af-dataset" data-af-name="data" href="ref:${dataset.id}"></head><body>Data</body></html>`}}))).json();
 const actor={...identityForUser(viewer.userId,viewer.id),tokenId:viewer.id};
 const db=await harness.db();const before=(await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]!.n;
 const denied=await forkArtifact(actor,(await getArtifactById(created.id))!);expect(denied).toBeInstanceOf(Response);if(!(denied instanceof Response))throw Error('expected refusal');expect(denied.status).toBe(400);
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]!.n).toBe(before);
});
