import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb,type Queryable} from '@/lib/platform';
import {commitHtmlBackends,getHtmlBackendStore,getHtmlBackendVersion,htmlSharedRevisions,mayCommitHtmlBackends,setHtmlBackendStore,type PreparedHtmlBackend} from '..';
useAppHarness();
const counter:PreparedHtmlBackend={name:'counter',source:'export const add=1',typeDefs:'type Query{n:Int}',compiled:'compiled-1'};
const commit=async(pageId:string,ownerId:string,prepared:readonly PreparedHtmlBackend[],previous:Parameters<typeof commitHtmlBackends>[4]=[])=>(await getDb()).transaction(tx=>commitHtmlBackends(tx,pageId,ownerId,prepared,previous));
const page=async(id:string,userId:string|null,links:unknown[])=>(await getDb()).query("INSERT INTO artifacts(id,user_id,format,meta) VALUES($1,$2,'html',$3::jsonb)",[id,userId,JSON.stringify({htmlLinks:links})]);

it('commits immutable content-addressed versions under one stable identity per page name',async()=>{
 const [link]=await commit('Page1','u1',[counter]);
 expect(link).toEqual({kind:'backend',name:'counter',backendId:expect.any(String),version:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect(await getHtmlBackendVersion(link!.backendId,link!.version)).toEqual({...counter,backendId:link!.backendId,pageId:'Page1',version:link!.version,ownerId:'u1',secretBindings:[]});
 expect(await getHtmlBackendStore(link!.backendId)).toEqual({value:null,version:0});
 // Republishing identical code is the same version; changed code is a new version of the same backend.
 expect(await commit('Page1','u1',[counter],[link!])).toEqual([link]);
 const [changed]=await commit('Page1','u1',[{...counter,compiled:'compiled-2',secretBindings:['KEY']}],[link!]);
 expect(changed).toMatchObject({backendId:link!.backendId});expect(changed!.version).not.toBe(link!.version);
 expect((await getHtmlBackendVersion(changed!.backendId,changed!.version))?.secretBindings).toEqual(['KEY']);
 expect(await getHtmlBackendVersion(link!.backendId,'0'.repeat(64))).toBeNull();
 expect(await getHtmlBackendVersion('missing',link!.version)).toBeNull();
});
it('recovers a removed name’s identity from history and mints a fresh one, copying only state, for a new owner',async()=>{
 const [link]=await commit('Page2','u1',[counter]);
 expect((await setHtmlBackendStore(link!.backendId,{n:5},0)).ok).toBe(true);
 const db=await getDb();
 await db.query("INSERT INTO artifact_versions(artifact_id,version,meta) VALUES('Page2',1,$1::jsonb)",[JSON.stringify({htmlLinks:[link]})]);
 const [recovered]=await commit('Page2','u1',[counter]);
 expect(recovered!.backendId).toBe(link!.backendId);
 const [transferred]=await commit('Page2','u2',[counter],[link!]);
 expect(transferred!.backendId).not.toBe(link!.backendId);
 expect(await getHtmlBackendStore(transferred!.backendId)).toEqual({value:{n:5},version:1});
 expect((await getHtmlBackendVersion(transferred!.backendId,transferred!.version))?.ownerId).toBe('u2');
});
it('writes the store only at the expected version, and fails unknown backends',async()=>{
 const [link]=await commit('Page3','u1',[counter]);
 expect(await setHtmlBackendStore(link!.backendId,{n:1},0)).toEqual({ok:true,version:1});
 expect(await setHtmlBackendStore(link!.backendId,{n:2},0)).toEqual({ok:false,version:1});
 expect(await getHtmlBackendStore(link!.backendId)).toEqual({value:{n:1},version:1});
 await expect(setHtmlBackendStore('missing',{},0)).rejects.toThrow('Backend not found');
 await expect(getHtmlBackendStore('missing')).rejects.toThrow('Backend not found');
});
it('fences a scoped write to the page’s current owner and admitted backend version',async()=>{
 const [link]=await commit('Page4','u1',[counter]);
 await page('Page4','u1',[link]);
 const scope={pageId:'Page4',version:link!.version,ownerId:'u1'};
 expect(await setHtmlBackendStore(link!.backendId,{n:1},0,scope)).toEqual({ok:true,version:1});
 for(const stale of [{...scope,ownerId:'u2'},{...scope,version:'0'.repeat(64)},{...scope,pageId:'Missing'}])await expect(setHtmlBackendStore(link!.backendId,{n:2},1,stale)).rejects.toThrow('backend_binding_changed');
 await (await getDb()).query("UPDATE artifacts SET deleted_at=now() WHERE id='Page4'");
 await expect(setHtmlBackendStore(link!.backendId,{n:2},1,scope)).rejects.toThrow('backend_binding_changed');
 expect(await getHtmlBackendStore(link!.backendId)).toEqual({value:{n:1},version:1});
 // An ownerless (guest) page admits the scope's owner.
 const [guest]=await commit('Page5','u3',[counter]);await page('Page5',null,[guest]);
 expect((await setHtmlBackendStore(guest!.backendId,{},0,{pageId:'Page5',version:guest!.version,ownerId:'u3'})).ok).toBe(true);
});
it('lets only the personal owner publish code that declares or ever held credentials',async()=>{
 const db=await getDb(),may=(personal:boolean,prepared:PreparedHtmlBackend[])=>db.transaction(tx=>mayCommitHtmlBackends(tx,'Page6',personal,prepared));
 expect(await may(false,[counter])).toBe(true);
 expect(await may(false,[{...counter,secretBindings:['KEY']}])).toBe(false);
 expect(await may(true,[{...counter,secretBindings:['KEY']}])).toBe(true);
 const [link]=await commit('Page6','u1',[counter]);
 await db.query("INSERT INTO html_backend_secrets(owner_id,backend_id,name,ciphertext) VALUES('u1',$1,'KEY','x')",[link!.backendId]);
 expect(await may(false,[counter])).toBe(false);
 expect(await may(false,[{...counter,name:'other'}])).toBe(true);
 await commit('Page7','u1',[{...counter,secretBindings:['KEY']}]);
 expect(await db.transaction(tx=>mayCommitHtmlBackends(tx,'Page7',false,[counter]))).toBe(false);
});
it('reports each shared name’s committed revision, hiding datasets the reader may not read',async()=>{
 const [link]=await commit('Page8','u1',[counter]);
 const db=await getDb();
 await db.query("INSERT INTO artifacts(id,format,version,edit_id) VALUES('Data1','dataset',4,'e4'),('Data2','dataset',1,'e1'),('Gone','dataset',2,'e2')");
 await db.query("UPDATE artifacts SET deleted_at=now() WHERE id='Gone'");
 const links=[link!,{kind:'backend',name:'lost',backendId:'nope',version:'v'},{kind:'dataset',name:'rows',datasetId:'Data1',mode:'live'},{kind:'dataset',name:'secret',datasetId:'Data2',mode:'live'},{kind:'dataset',name:'gone',datasetId:'Gone',mode:'live'},{kind:'dataset',name:'old',datasetId:'Data1',mode:'pinned',revision:'1'}] as never;
 expect(await htmlSharedRevisions(db,links,{mayReadDataset:async id=>id!=='Data2'})).toEqual([
  {name:'counter',revision:`backend:${link!.backendId}:0`},{name:'lost',revision:'missing'},{name:'rows',revision:'dataset:Data1:4:e4:true'},{name:'secret',revision:'unavailable'},{name:'gone',revision:'unavailable'},
 ]);
 const counting={queries:0,query:async()=>{counting.queries++;return {rows:[]};}} as unknown as Queryable&{queries:number};
 expect(await htmlSharedRevisions(counting,[],{mayReadDataset:async()=>true})).toEqual([]);expect(counting.queries).toBe(0);
});
