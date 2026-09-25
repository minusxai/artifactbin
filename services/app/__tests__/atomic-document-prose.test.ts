import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {getDb} from '@/lib/db';
import {getArtifactById,applyEditScoped} from '@/lib/artifacts';
import {proseOperation} from '@/lib/story/document-prose';
import {POST as createRoute} from '@/app/api/artifacts/route';
useAppHarness();
async function setup(){const token=await mintToken('mxmx_test_atomic_jsonb');const response=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));expect(response.status).toBe(201);const {id}=await response.json();return {id,actor:{tokenId:token.id,userId:null},row:(await getArtifactById(id))!};}
it('two stale independent variable-length Unicode edits each use one atomic statement',async()=>{
 const {id,actor,row}=await setup(),db=await getDb();const a=proseOperation(row.source!,row.source!.replace('Alpha','First 👩🏽‍💻')),b=proseOperation(row.source!,row.source!.replace('Beta','Second &amp; β'));expect(a).not.toBeNull();expect(b).not.toBeNull();
 const spy=vi.spyOn(db,'query');
 const first=await applyEditScoped(actor,id,{baseEditId:row.edit_id,text:a!});const second=await applyEditScoped(actor,id,{baseEditId:row.edit_id,text:b!});
 expect(first&&!(first instanceof Response)&&first.applied).toBe(true);expect(second&&!(second instanceof Response)&&second.applied).toBe(true);
 expect(spy.mock.calls.filter(([sql])=>sql.includes('artifacts'))).toHaveLength(2);spy.mockRestore();
 const head=(await getArtifactById(id))!;expect(head.source).toContain('First 👩🏽‍💻');expect(head.source).toContain('Second &amp; β');expect(head.version).toBe(3);
});
it('refuses an overlapping stale edit without mutating the row or logs',async()=>{
 const {id,actor,row}=await setup(),db=await getDb();const text=proseOperation(row.source!,row.source!.replace('Alpha','Changed'))!;
 await applyEditScoped(actor,id,{baseEditId:row.edit_id,text});const before=(await db.query('SELECT * FROM artifacts WHERE id=$1',[id])).rows;
 const result=await applyEditScoped(actor,id,{baseEditId:row.edit_id,text:{...text,newText:'Overwrite'}});expect(result&&!(result instanceof Response)&&!result.applied).toBe(true);
 expect((await db.query('SELECT * FROM artifacts WHERE id=$1',[id])).rows).toEqual(before);
 expect((await db.query('SELECT count(*)::int n FROM artifact_edits WHERE artifact_id=$1',[id])).rows[0].n).toBe(2);
});
it('never treats client-provided paths or active syntax as a certificate',async()=>{
 const {id,actor,row}=await setup();
 for(const text of [{path:['roots','0','tag'],oldText:'section',newText:'script'},{path:['roots','0','children','0','children','0','value'],oldText:'Alpha',newText:'className="evil"'}]){
 const result=await applyEditScoped(actor,id,{baseEditId:row.edit_id,text});expect(result&&!(result instanceof Response)&&!result.applied||result instanceof Response).toBe(true);
 }
 expect((await getArtifactById(id))?.version).toBe(1);
});
it('accepts an independent edit 23 versions behind and rejects same-leaf ABA',async()=>{
 const {id,actor,row}=await setup();let head=row;
 for(let i=0;i<23;i++){
  const before=i?`Value ${i-1}`:'Alpha',after=`Value ${i}`;
  const result=await applyEditScoped(actor,id,{baseEditId:head.edit_id,text:proseOperation(head.source!,head.source!.replace(before,after))!});
  expect(result&&!(result instanceof Response)&&result.applied).toBe(true);if(result&&!(result instanceof Response)&&result.applied)head=result.row;
 }
 const independent=await applyEditScoped(actor,id,{baseEditId:row.edit_id,text:proseOperation(row.source!,row.source!.replace('Beta','Lagged β'))!});expect(independent&&!(independent instanceof Response)&&independent.applied).toBe(true);
 const restore=await applyEditScoped(actor,id,{baseEditId:head.edit_id,change:{oldString:'Value 22',newString:'Alpha'}});expect(restore&&!(restore instanceof Response)&&restore.applied).toBe(true);
 const stale=await applyEditScoped(actor,id,{baseEditId:row.edit_id,text:proseOperation(row.source!,row.source!.replace('Alpha','Stale overwrite'))!});expect(stale&&!(stale instanceof Response)&&!stale.applied).toBe(true);
});
it('preserves validation and source-log compatibility across structural and legacy operations',async()=>{
 const {id,actor,row}=await setup(),db=await getDb();await db.query('UPDATE artifacts SET document=NULL,source=$2 WHERE id=$1',[id,row.source]);
 const direct=await applyEditScoped(actor,id,{baseEditId:row.edit_id,text:proseOperation(row.source!,row.source!.replace('Alpha','Migrated'))!});expect(direct&&!(direct instanceof Response)&&direct.applied).toBe(true);
 const head=(await getArtifactById(id))!;
 const structure=await applyEditScoped(actor,id,{baseEditId:head.edit_id,change:{oldString:'</section>',newString:'<p>Added</p></section>'}});expect(structure&&!(structure instanceof Response)&&structure.applied).toBe(true);
 const final=(await getArtifactById(id))!;expect(final.source).toContain('Added');
 let replay='';for(const e of (await db.query<{splice_start:number;removed:string;inserted:string}>('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq',[id])).rows){expect(replay.slice(e.splice_start,e.splice_start+e.removed.length)).toBe(e.removed);replay=replay.slice(0,e.splice_start)+e.inserted+replay.slice(e.splice_start+e.removed.length);}
 expect(replay).toBe(final.source);
});
it('does not let a stale child edit bypass a parent mutation',async()=>{
 const {id,actor,row}=await setup();const changed=await applyEditScoped(actor,id,{baseEditId:row.edit_id,change:{oldString:'<section ',newString:'<section className="p-4" '}});expect(changed&&!(changed instanceof Response)&&changed.applied).toBe(true);
 const result=await applyEditScoped(actor,id,{baseEditId:row.edit_id,text:proseOperation(row.source!,row.source!.replace('Alpha','Stale'))!});expect(result&&!(result instanceof Response)&&!result.applied).toBe(true);
});
it('read migrations do not manufacture validation certificates',async()=>{
 const {id,row}=await setup(),db=await getDb();await db.query('UPDATE artifacts SET document=NULL,source=$2 WHERE id=$1',[id,row.source]);await getArtifactById(id);
 expect((await db.query<{document:{prose?:unknown}}>('SELECT document FROM artifacts WHERE id=$1',[id])).rows[0]!.document.prose).toBeUndefined();
});
