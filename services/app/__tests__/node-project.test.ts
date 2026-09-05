/** Integrated acceptance for identity, atomic batches and relation-only comments. */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request, agentCookie } from './harness';
import { mintToken } from '@/lib/tokens';
import { getDb } from '@/lib/db';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as getRoute } from '@/app/api/artifacts/[id]/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { POST as commentRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { DELETE as deleteCommentRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
async function setup(markup:string) {
  const t=await mintToken('node-project');
  const made=await createRoute(request('/api/artifacts',{method:'POST',token:t.token,json:{markup}}));
  expect(made.status,await made.clone().text()).toBe(201);
  const doc=await made.json();
  const read=async()=> (await getRoute(request(`/api/artifacts/${doc.id}`,{token:t.token}),params(doc.id))).json();
  const edit=(body:Record<string,unknown>)=>editRoute(request(`/api/artifacts/${doc.id}/edits`,{method:'POST',token:t.token,json:body}),params(doc.id));
  return {t,doc,read,edit};
}
const bodyIds=(source:string)=>{
  const parsed=parseJsx(source); if(!parsed.ok)throw new Error(parsed.error);
  const ids:unknown[]=[];
  const walk=(nodes:JsxNode[])=>nodes.forEach(n=>{if(n.type!=='element'||n.tag==='Helmet')return;const a=n.attributes.find(a=>a.name==='id');ids.push(a?.value.static?a.value.json:null);walk(n.children);});
  walk(parsed.nodes);return ids;
};
async function history(id:string) {
  const db=await getDb();
  return {edits:(await db.query('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq',[id])).rows,versions:(await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version',[id])).rows};
}
describe('node project through real routes',()=>{
  it('create persists a unique id on every authored body element',async()=>{
    const {read}=await setup('<Helmet><title>T</title></Helmet><main><p>A</p><p>B</p></main>');
    const head=await read(); const ids=bodyIds(head.markup);
    expect(ids).toHaveLength(3);expect(ids.every(id=>typeof id==='string'&&id.length>0)).toBe(true);expect(new Set(ids).size).toBe(3);
  });
  it('batch moves with one version while preserving an unrelated stale sibling edit',async()=>{
    const s=await setup('<main id="root"><Card id="card">Hello</Card><p id="other">Old</p><section id="dest"></section></main>');
    const base=await s.read();
    expect((await s.edit({edit_id:base.edit_id,old_string:'Old',new_string:'Current'})).status).toBe(200);
    const moved=await s.edit({edit_id:base.edit_id,edits:[{old_string:'<Card id="card">Hello</Card>',new_string:''},{old_string:'<section id="dest">',new_string:'<section id="dest"><Card id="card">Hello</Card>'}]});
    expect(moved.status,await moved.clone().text()).toBe(200);
    const head=await s.read();expect(head.version).toBe(base.version+2);expect(head.markup).toContain('Current');expect(head.markup).toContain('<section id="dest"><Card id="card">Hello</Card></section>');
    const logged=(await history(s.doc.id)).edits;expect(logged).toHaveLength(3);
    expect(logged[2].changes).toHaveLength(2);
  });
  it('validates only final JSX for dependent batch steps',async()=>{
    const s=await setup('<p id="para">Hi</p>');const base=await s.read();
    const result=await s.edit({edit_id:base.edit_id,edits:[{old_string:'<p id="para">',new_string:'<section id="wrap"><p id="para">'},{old_string:'Hi',new_string:'Done'},{old_string:'</p>',new_string:'</p></section>'}]});
    expect(result.status,await result.clone().text()).toBe(200);const head=await s.read();expect(head.version).toBe(base.version+1);expect(head.markup).toBe('<section id="wrap"><p id="para">Done</p></section>');
  });
  it('failure in a later batch step leaves source, head and history untouched',async()=>{
    const s=await setup('<p id="para">Hi</p>');const base=await s.read();const before=await history(s.doc.id);
    const result=await s.edit({edit_id:base.edit_id,edits:[{old_string:'Hi',new_string:'Done'},{old_string:'missing',new_string:'x'}]});
    expect(result.status).toBe(400);expect((await result.json()).edit_index).toBe(1);
    const head=await s.read();expect(head.edit_id).toBe(base.edit_id);expect(head.markup).toBe(base.markup);expect(await history(s.doc.id)).toEqual(before);
  });
  it('creating and deleting a comment does not edit or clean identity from source',async()=>{
    const s=await setup('<p id="para">Hi</p>');const base=await s.read();const before=await history(s.doc.id);const cookie=await agentCookie([s.t.id]);
    const made=await commentRoute(request(`/api/my/artifacts/${s.doc.id}/annotations`,{method:'POST',cookie,json:{node_id:'para',body:'Check'}}),params(s.doc.id));
    expect(made.status,await made.clone().text()).toBe(201);const ann=await made.json();
    const commented=await s.read();expect(commented.edit_id).toBe(base.edit_id);expect(commented.markup).toBe(base.markup);expect(await history(s.doc.id)).toEqual(before);
    const deleted=await deleteCommentRoute(request(`/api/my/artifacts/${s.doc.id}/annotations/${ann.id}`,{method:'DELETE',cookie}),{params:Promise.resolve({id:s.doc.id,annId:ann.id})});
    expect(deleted.status).toBeLessThan(300);expect((await s.read()).markup).toBe(base.markup);expect(await history(s.doc.id)).toEqual(before);
  });
  it('rejects mixed edit forms by presence without touching history',async()=>{
    const s=await setup('<p id="para">Hi</p>');const before=await history(s.doc.id);
    for(const body of [
      {edit_id:s.doc.edit_id,old_string:'Hi',new_string:'Bye',edits:null},
      {edit_id:s.doc.edit_id,old_string:'Hi',edits:[{old_string:'Hi',new_string:'Bye'}]},
    ]) expect((await s.edit(body)).status).toBe(400);
    expect(await history(s.doc.id)).toEqual(before);
  });
  it('retires removed source ids and never assigns them to generated replacements',async()=>{
    const s=await setup('<main><p>A</p><p>B</p></main>');const base=await s.read();
    const ids=bodyIds(base.markup) as string[];const removed=ids[1];
    const changed=await s.edit({edit_id:base.edit_id,old_string:`<p id="${removed}">A</p>`,new_string:'<section>New</section>'});
    expect(changed.status,await changed.clone().text()).toBe(200);
    const head=await s.read();const nextIds=bodyIds(head.markup) as string[];
    expect(nextIds).not.toContain(removed);
    const db=await getDb();const ledger=await db.query<{source_id:string;retired_version:number|null}>('SELECT source_id,retired_version FROM artifact_source_ids WHERE artifact_id=$1',[s.doc.id]);
    expect(ledger.rows.find(row=>row.source_id===removed)?.retired_version).toBe(head.version);
  });
});
