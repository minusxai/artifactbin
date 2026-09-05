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
  it('rejects hostile row fields and missing snapshots before any dataset write', async () => {
    const t=await mintToken('hostile');
    const ds=await create(t.token,{dataset:[{id:1,status:'backlog'}],access:'readwrite'});
    const doc=await create(t.token,{markup:markup(ds.id)});
    for (const row of [undefined, {id:1,status:'backlog',admin:true}, {id:'1',status:'backlog'}]) {
      const res=await mutateDoc(request(`/a/${doc.id}/mutate`,{method:'POST',json:{mutation:'set_status',values:{_value:'active'},row}}),{params:Promise.resolve({id:doc.id})});
      expect(res.status,await res.clone().text()).toBe(400);
      expect(await res.json()).toMatchObject({error:'invalid_row'});
    }
    expect(await loadDatasetRows((await getArtifactById(ds.id))!)).toEqual([{id:1,status:'backlog'}]);
  });
  it('rejects row references outside a Column, unknown fields, and missing rowKey at publish', async () => {
    const t=await mintToken('scope');
    const ds=await create(t.token,{dataset:[{id:1,status:'backlog'}],access:'readwrite'});
    for (const source of [markup(ds.id).replace('rowKey="id"',''), markup(ds.id).replace('value="$_row.status"','value="$_row.typo"'), markup(ds.id)+'<span>{$_row.id}</span>']) {
      const res=await createArtifact(request('/api/artifacts',{method:'POST',token:t.token,json:{markup:source}}));
      expect(res.status,await res.clone().text()).toBe(400);
    }
  });
  it('preserves concurrent different-column edits and rejects one same-cell writer on CAS retry', async () => {
    const t=await mintToken('concurrent');
    const ds=await create(t.token,{dataset:[{id:1,status:'backlog',owner:'TBD'}],access:'readwrite'});
    const source=markup(ds.id).replace('</Helmet>',`<Mutation name="set_owner" expectedAffected={1}>{\`update ref_${ds.id} set owner=$_value where id=$_row.id and owner is not distinct from $_row.owner\`}</Mutation></Helmet>`).replace('</DataTable>','<Column col="owner"><Select value="$_row.owner" options={["TBD","alice"]} run="$set_owner"/></Column></DataTable>');
    const doc=await create(t.token,{markup:source});
    const update=(mutation:string,value:string,row:Record<string,unknown>)=>mutateDoc(request(`/a/${doc.id}/mutate`,{method:'POST',json:{mutation,values:{_value:value},row}}),{params:Promise.resolve({id:doc.id})});
    const original={id:1,status:'backlog',owner:'TBD'};
    const first=await Promise.all([update('set_status','active',original),update('set_owner','alice',original)]);
    expect(first.map(r=>r.status)).toEqual([200,200]);
    const current={id:1,status:'active',owner:'alice'};
    expect(await loadDatasetRows((await getArtifactById(ds.id))!)).toEqual([current]);
    const same=await Promise.all([update('set_status','backlog',current),update('set_status','done',current)]);
    expect(same.map(r=>r.status).sort()).toEqual([200,409]);
  });
  it('rejects unsupported editors and a generic mutation wired as a cell editor',async()=>{
    const t=await mintToken('editors');const ds=await create(t.token,{dataset:[{id:1,status:'backlog'}],access:'readwrite'});
    const source=markup(ds.id);
    for(const bad of [source.replace('<Select value=','<Slider value='),source.replace('<Select value=','<Button value='),source.replace('<Select value=','<input type="checkbox" value='),source.replace('status=$_value where id=$_row.id and status is not distinct from $_row.status',"status='done'")]) {
      const res=await createArtifact(request('/api/artifacts',{method:'POST',token:t.token,json:{markup:bad}}));
      expect(res.status,await res.clone().text()).toBe(400);
    }
  });
});
