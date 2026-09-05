import { describe, expect, it } from 'vitest';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as mutateDoc } from '@/app/a/[id]/mutate/route';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from './harness';
useAppHarness();
const create = async (token:string, body:Record<string,unknown>) => {
  const res=await createArtifact(request('/api/artifacts',{method:'POST',token,json:body}));
  expect(res.status,await res.clone().text()).toBe(201);
  return await res.json() as {id:string};
};
const markup=(ds:string)=>`<Helmet><Query name="tasks">{\`select * from ref_${ds}\`}</Query><Mutation name="set_status" expectedAffected={1}>{\`update ref_${ds} set status=$_value where id=$_row.id and status is not distinct from $_row.status\`}</Mutation></Helmet><DataTable data="$tasks" rowKey="id"><Column col="id"/><Column col="status"><Select value="$_row.status" options={["backlog","active","done"]} run="$set_status"/></Column></DataTable>`;
describe('editable DataTable feature',()=>{
  it('publishes, updates one cell, and rejects a stale edit without bumping dataset version',async()=>{
    const t=await mintToken('editable');
    const ds=await create(t.token,{dataset:[{id:1,status:'backlog'},{id:2,status:'backlog'}],access:'readwrite'});
    const doc=await create(t.token,{markup:markup(ds.id)});
    const update=(value:string)=>mutateDoc(request(`/a/${doc.id}/mutate`,{method:'POST',json:{mutation:'set_status',values:{_value:value},row:{id:1,status:'backlog'}}}),{params:Promise.resolve({id:doc.id})});
    const first=await update('active'); expect(first.status,await first.clone().text()).toBe(200);
    const before=(await getArtifactById(ds.id))!;
    expect(await loadDatasetRows(before)).toEqual([{id:1,status:'active'},{id:2,status:'backlog'}]);
    const stale=await update('done'); expect(stale.status,await stale.clone().text()).toBe(409);
    expect(await stale.json()).toMatchObject({error:'row_changed'});
    expect((await getArtifactById(ds.id))!.version).toBe(before.version);
  });
  it('does not persist an update that matches duplicate target keys',async()=>{
    const t=await mintToken('duplicate');
    const ds=await create(t.token,{dataset:[{id:1,status:'backlog'},{id:1,status:'backlog'}],access:'readwrite'});
    const doc=await create(t.token,{markup:markup(ds.id)});
    const before=(await getArtifactById(ds.id))!;
    const res=await mutateDoc(request(`/a/${doc.id}/mutate`,{method:'POST',json:{mutation:'set_status',values:{_value:'active'},row:{id:1,status:'backlog'}}}),{params:Promise.resolve({id:doc.id})});
    expect(res.status,await res.clone().text()).toBe(409);
    expect(await res.json()).toMatchObject({error:'row_not_unique'});
    expect((await getArtifactById(ds.id))!.version).toBe(before.version);
  });
});
