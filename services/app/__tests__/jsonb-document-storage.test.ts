import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {getDb} from '@/lib/db';
import {getArtifactById,applyEditScoped,getVersionFor,revertArtifactFor,forkArtifact} from '@/lib/artifacts';
import {POST as createRoute} from '@/app/api/artifacts/route';
useAppHarness();
async function create(){const token=await mintToken('mxmx_test_jsonb');const response=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));expect(response.status).toBe(201);const {id}=await response.json();return {token,id,actor:{tokenId:token.id,userId:null},row:(await getArtifactById(id))!};}
const stored=async(id:string)=>(await (await getDb()).query('SELECT * FROM artifacts WHERE id=$1',[id])).rows[0];
it('writes new markup as JSONB, while reads and edit logs retain exact JSX',async()=>{
 const {id,row}=await create();const raw=await stored(id);expect(raw.source).toBeNull();expect(raw.document).toMatchObject({schema:1,kind:'jsx'});
 expect(row.source).toContain('Alpha');const log=(await(await getDb()).query('SELECT inserted FROM artifact_edits WHERE artifact_id=$1',[id])).rows[0];expect(log.inserted).toBe(row.source);
});
it('migrates old markup once without changing its version, identity, metadata, timestamps or history',async()=>{
 const {id,row}=await create(),db=await getDb();await db.query('UPDATE artifacts SET document=NULL,source=$2 WHERE id=$1',[id,row.source]);
 const before=await stored(id);const a=await getArtifactById(id),b=await getArtifactById(id);expect(a?.source).toBe(row.source);expect(b?.source).toBe(row.source);
 const after=await stored(id);expect(after.source).toBeNull();expect(after.document).not.toBeNull();for(const key of ['edit_id','version','created_at','updated_at','meta','actor_user_id','actor_token_id'])expect(after[key]).toEqual(before[key]);
 expect((await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1',[id])).rows).toHaveLength(0);expect((await db.query('SELECT * FROM artifact_edits WHERE artifact_id=$1',[id])).rows).toHaveLength(1);
});
it('a first-load conversion cannot overwrite a winning edit',async()=>{
 const {id,row,actor}=await create(),db=await getDb();await db.query('UPDATE artifacts SET document=NULL,source=$2 WHERE id=$1',[id,row.source]);
 const query=db.query.bind(db);let raced=false;
 const spy=vi.spyOn(db,'query').mockImplementation(async(sql,params)=>{
  if(!raced&&sql.includes('document IS NULL')&&sql.includes('UPDATE artifacts')){raced=true;const result=await applyEditScoped(actor,id,{baseEditId:row.edit_id,change:{oldString:'Alpha',newString:'Winner'}});expect(result&&!(result instanceof Response)&&result.applied).toBe(true);}
  return query(sql,params);
 });
 try{expect((await getArtifactById(id))?.source).toContain('Winner');expect(raced).toBe(true);}finally{spy.mockRestore();}
 expect((await stored(id)).source).toBeNull();expect((await getArtifactById(id))?.version).toBe(2);
});
it('edits archive JSONB, old archives migrate on read, and restore stays JSONB',async()=>{
 const {id,row,actor}=await create(),db=await getDb();const result=await applyEditScoped(actor,id,{baseEditId:row.edit_id,change:{oldString:'Alpha',newString:'Edited'}});expect(result&&!(result instanceof Response)&&result.applied).toBe(true);
 let archive=(await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1',[id])).rows[0];expect(archive.source).toBeNull();expect(archive.document).not.toBeNull();
 await db.query('UPDATE artifact_versions SET document=NULL,source=$2 WHERE artifact_id=$1',[id,row.source]);expect((await getVersionFor(actor,id,1))?.source).toBe(row.source);archive=(await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1',[id])).rows[0];expect(archive.source).toBeNull();expect(archive.document).not.toBeNull();
 const restored=await revertArtifactFor(actor,id,1,{expectedVersion:2});expect(restored&&'source'in restored&&restored.source).toBe(row.source);expect((await stored(id)).document).not.toBeNull();
});
it('concurrent first loads converge without adding authored edits',async()=>{
 const {id,row}=await create(),db=await getDb();await db.query('UPDATE artifacts SET source=$2,document=NULL WHERE id=$1',[id,row.source]);
 const reads=await Promise.all(Array.from({length:8},()=>getArtifactById(id)));expect(reads.every(r=>r?.source===row.source&&r?.version===1)).toBe(true);
 expect((await db.query('SELECT count(*)::int n FROM artifact_edits WHERE artifact_id=$1',[id])).rows[0].n).toBe(1);
 expect((await stored(id)).source).toBeNull();
});
it('a reader without history access cannot trigger conversion of an archived document',async()=>{
 const {id,row,actor}=await create(),db=await getDb();await applyEditScoped(actor,id,{baseEditId:row.edit_id,change:{oldString:'Alpha',newString:'Edited'}});
 await db.query('UPDATE artifact_versions SET document=NULL,source=$2 WHERE artifact_id=$1',[id,row.source]);
 const foreign=await mintToken('mxmx_test_jsonb_foreign');expect(await getVersionFor({tokenId:foreign.id,userId:null},id,1)).toBeNull();
 expect((await db.query('SELECT document,source FROM artifact_versions WHERE artifact_id=$1',[id])).rows[0]).toEqual({document:null,source:row.source});
});
it('forking a JSONB document creates another JSONB head with its own history',async()=>{
 const {id,row,actor}=await create();const result=await forkArtifact(actor,row);expect(result).not.toBeInstanceOf(Response);if(result instanceof Response)throw new Error(await result.text());
 expect(result.artifact.id).not.toBe(id);expect(result.artifact.source).toContain('Alpha');expect(result.artifact.version).toBe(1);expect((await stored(result.artifact.id)).source).toBeNull();expect((await stored(result.artifact.id)).document).not.toBeNull();
 expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
it('invalid publications leave JSONB and the existing edit protocol untouched',async()=>{
 const {id,row,actor}=await create(),before=await stored(id);const bad=await applyEditScoped(actor,id,{baseEditId:row.edit_id,change:{oldString:'Alpha',newString:'<script>run()</script>'}});expect(bad).toBeInstanceOf(Response);
 expect(await stored(id)).toEqual(before);expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
