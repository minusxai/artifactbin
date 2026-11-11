import * as Y from 'yjs';
import {createRegionState,editableRegions,openRegionDoc,regionText,regionHtml} from '@/lib/live-regions';
import {expect,it} from 'vitest';
import {createArtifact,migrateLegacyPage} from '@/lib/artifacts';
import {createRegionSessions} from '@/lib/region-sessions';
import {identityForUser,createUser} from '@/lib/accounts';
import {useAppHarness} from './harness';
const harness=useAppHarness();
it('defaults to dry run, retains exact old head and repeats without publication',async()=>{
 const user=await createUser({email:'mxmx_test_migration@example.com'});
 const row=await createArtifact(null,user.id,{format:'html',source:'<article data-af-editable="rich"><p>Hello</p></article>',meta:{},visibility:'private'});
 const db=await harness.db();
 await db.query(`INSERT INTO annotations(id,artifact_id,body,author_kind,quote,anchor_version,html_anchor) VALUES('ann_migration',$1,'Retain comment','human','Hello',$2,$3::jsonb)`,[row.id,row.version,JSON.stringify({nodeId:editableRegions(row.source!)[0]!.id})]);
 const comments=(await db.query('SELECT to_jsonb(a) AS value FROM annotations a WHERE artifact_id=$1',[row.id])).rows;
 const before=(await db.query('SELECT to_jsonb(a) AS value FROM artifacts a WHERE id=$1',[row.id])).rows;
 expect(await migrateLegacyPage(row.id)).toBe('eligible');
 expect((await db.query('SELECT to_jsonb(a) AS value FROM artifacts a WHERE id=$1',[row.id])).rows).toEqual(before);
 expect(await migrateLegacyPage(row.id,{apply:true})).toBe('migrated');
 expect(await migrateLegacyPage(row.id,{apply:true})).toBe('already_migrated');
 const backup=(await db.query<{backup:{head:unknown}}>('SELECT backup FROM legacy_page_migrations WHERE artifact_id=$1',[row.id])).rows[0]!;
 expect(backup.backup.head).toEqual(before[0]!.value);
 expect((await db.query('SELECT to_jsonb(a) AS value FROM annotations a WHERE artifact_id=$1',[row.id])).rows).toEqual(comments);
});

it('refuses an unrepresentable empty mark without changing any rows',async()=>{
 const user=await createUser({email:'mxmx_test_migration_refuse@example.com'});
 const row=await createArtifact(null,user.id,{format:'html',source:'<article data-af-editable="rich"><p>Hello<strong data-af-id="af-98"></strong></p></article>',meta:{},visibility:'private'});
 const db=await harness.db();
 const before=(await db.query('SELECT to_jsonb(a) AS value FROM artifacts a WHERE id=$1',[row.id])).rows;
 await expect(migrateLegacyPage(row.id,{apply:true})).rejects.toThrow();
 expect((await db.query('SELECT to_jsonb(a) AS value FROM artifacts a WHERE id=$1',[row.id])).rows).toEqual(before);
 expect((await db.query('SELECT * FROM legacy_page_migrations WHERE artifact_id=$1',[row.id])).rows).toHaveLength(0);
});

it('preserves trash timestamp',async()=>{
 const user=await createUser({email:'mxmx_test_migration_trash@example.com'});
 const row=await createArtifact(null,user.id,{format:'html',source:'<article data-af-editable="rich"><p>Trashed</p></article>',meta:{},visibility:'private'});
 const db=await harness.db();
 await db.query("UPDATE artifacts SET deleted_at='2025-01-01T00:00:00Z' WHERE id=$1",[row.id]);
 const before=(await db.query('SELECT deleted_at FROM artifacts WHERE id=$1',[row.id])).rows;
 expect(await migrateLegacyPage(row.id,{apply:true})).toBe('migrated');
 expect((await db.query('SELECT deleted_at FROM artifacts WHERE id=$1',[row.id])).rows).toEqual(before);
});

it.each(['true','false'])('folds checklist %s state and pending log bytes and retains exact attributed backup bytes',async checked=>{
 const user=await createUser({email:'mxmx_test_migration_dirty@example.com'});
 const row=await createArtifact(null,user.id,{format:'html',source:`<article data-af-editable="rich"><p>Hello</p><ul><li role="checkbox" aria-checked="${checked}" aria-disabled="true"><p>Task</p></li></ul></article>`,meta:{},visibility:'private'});
 const db=await harness.db();
 const region=editableRegions(row.source!)[0]!;
 const initial=createRegionState('rich',region.inner);
 const doc=openRegionDoc(initial.state);
 regionText(doc).insert(0,'folded ');
 const folded=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);
 regionText(doc).insert(0,'pending ');
 const update=Y.encodeStateAsUpdate(doc,vector);
 await db.query("INSERT INTO region_states(artifact_id,region_id,kind,state,state_seq,last_seq,saved_version,dirty_since) VALUES($1,$2,'rich',$3,1,2,$4,now())",[row.id,region.id,Buffer.from(folded),row.version]);
 await db.query('INSERT INTO region_updates(artifact_id,region_id,seq,client_id,"update",actor_user_id) VALUES($1,$2,2,$3,$4,$5)',[row.id,region.id,doc.clientID,Buffer.from(update),user.id]);
 const old=(await db.query('SELECT to_jsonb(s) AS value FROM region_states s WHERE artifact_id=$1',[row.id])).rows[0]!.value;
 expect(await migrateLegacyPage(row.id,{apply:true})).toBe('migrated');
 const current=(await db.query<{state:Uint8Array}>('SELECT state FROM region_states WHERE artifact_id=$1',[row.id])).rows[0]!;
 expect(regionHtml('rich-native-v1',current.state)).toContain('pending folded Hello');
 expect(regionHtml('rich-native-v1',current.state)).toContain(`role="checkbox" aria-checked="${checked}" aria-disabled="true"`);
 const backup=(await db.query<{backup:{region_states:unknown[];region_updates:{update:string}[]}}>('SELECT backup FROM legacy_page_migrations WHERE artifact_id=$1',[row.id])).rows[0]!.backup;
 expect(backup.region_states).toEqual([old]);
 expect(backup.region_updates[0]!.update).toBe('\\x'+Buffer.from(update).toString('hex'));
 expect((await db.query('SELECT * FROM region_updates WHERE artifact_id=$1',[row.id])).rows).toHaveLength(0);
});

it('rejects old sessions in warm and cold processes after conversion',async()=>{
 const user=await createUser({email:'mxmx_test_migration_stale@example.com'});
 const actor=identityForUser(user.id);
 const row=await createArtifact(null,user.id,{format:'html',source:'<article data-af-editable="rich"><p>Hello</p></article>',meta:{},visibility:'private'});
 const region=editableRegions(row.source!)[0]!;
 const make=()=>createRegionSessions({db:()=>harness.db(),keepaliveFrame:()=>'',subscribe:async(channel,handler,onLost)=>(await harness.db()).listen(channel,handler,onLost)});
 const warm=make(),cold=make();
 try{
  const opened=await warm.open(actor,row.id,region.id);
  expect(opened.status).toBe(200);
  if(opened.status!==200)throw new Error('open failed');
  await migrateLegacyPage(row.id,{apply:true});
  for(const store of [warm,cold]){
   const result=await store.update(actor,row.id,region.id,{clientId:opened.body.clientId,update:new Uint8Array([0,0])});
   expect(result.status).toBe(422);
  }
 }finally{warm.dispose();cold.dispose();}
});

it.each(['true','false'])('migrates legacy checkbox %s through the real operator with exact backup and comments',async checked=>{
 const user=await createUser({email:`mxmx_test_checkbox_${checked}@example.com`});
 const source=`<article data-af-id="af-1" data-af-editable="rich"><p data-af-id="af-2">Tasks</p><ul data-af-id="af-3"><li data-af-id="af-4" role="checkbox" aria-checked="${checked}" aria-disabled="true"><p data-af-id="af-5">Example task</p></li></ul></article>`;
 const row=await createArtifact(null,user.id,{format:'html',source,meta:{},visibility:'private'});
 const db=await harness.db();
 await db.query(`INSERT INTO annotations(id,artifact_id,body,author_kind,quote,anchor_version,html_anchor) VALUES($1,$2,'Keep','human','Example task',$3,$4::jsonb)`,[`ann_checkbox_${checked}`,row.id,row.version,JSON.stringify({nodeId:'af-5'})]);
 const before=(await db.query('SELECT to_jsonb(a) AS value FROM artifacts a WHERE id=$1',[row.id])).rows;
 const comments=(await db.query('SELECT to_jsonb(a) AS value FROM annotations a WHERE artifact_id=$1',[row.id])).rows;
 expect(await migrateLegacyPage(row.id)).toBe('eligible');
 expect((await db.query('SELECT to_jsonb(a) AS value FROM artifacts a WHERE id=$1',[row.id])).rows).toEqual(before);
 expect(await migrateLegacyPage(row.id,{apply:true})).toBe('migrated');
 const state=(await db.query<{state:Uint8Array}>('SELECT state FROM region_states WHERE artifact_id=$1',[row.id])).rows[0]!.state;
 expect(regionHtml('rich-native-v1',state)).toBe(editableRegions(row.source!)[0]!.inner);
 expect((await db.query<{backup:{head:unknown}}>('SELECT backup FROM legacy_page_migrations WHERE artifact_id=$1',[row.id])).rows[0]!.backup.head).toEqual(before[0]!.value);
 expect((await db.query('SELECT to_jsonb(a) AS value FROM annotations a WHERE artifact_id=$1',[row.id])).rows).toEqual(comments);
});
it.each(['aria-checked="mixed"','aria-checked="true" aria-disabled="yes"','aria-checked="true" aria-label="unmodelled"','aria-checked="true" data-checked="true"'])('refuses invalid checkbox attributes atomically: %s',async attrs=>{
 const user=await createUser({email:'mxmx_test_checkbox_invalid@example.com'});
 const row=await createArtifact(null,user.id,{format:'html',source:`<article data-af-editable="rich"><ul><li role="checkbox" ${attrs}><p>Invalid</p></li></ul></article>`,meta:{},visibility:'private'});
 const db=await harness.db();
 const before=(await db.query('SELECT to_jsonb(a) AS value FROM artifacts a WHERE id=$1',[row.id])).rows;
 await expect(migrateLegacyPage(row.id,{apply:true})).rejects.toThrow();
 expect((await db.query('SELECT to_jsonb(a) AS value FROM artifacts a WHERE id=$1',[row.id])).rows).toEqual(before);
 expect((await db.query('SELECT * FROM legacy_page_migrations WHERE artifact_id=$1',[row.id])).rows).toHaveLength(0);
});
