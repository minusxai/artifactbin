import {expect,it} from 'vitest';
import {useAppHarness,mintAccountToken} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {createHash} from 'node:crypto';
import {nativeCatalogDigest as digest} from '@/lib/native-history-import';
import type {NativeIdentityPlan} from '@/lib/native-identity-import';
import type {NativeAncillaryFolderRecipe} from '../contracts';
import {prepareNativeAncillaryFolders} from '../index';
useAppHarness();
const encoded=(value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value));return {encoding:'base64' as const,data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};};
const signed=<T extends object>(value:T)=>({...value,sha256:digest(value)});
async function fixture(){
 const owner=await mintAccountToken('mxmx_test_ancillary_owner'),viewer=await mintAccountToken('mxmx_test_ancillary_viewer'),time='2020-01-02T03:04:05.123456Z';
 const rawFolders=['SourceRoot','SourceChild'].map((id,index)=>({id,format:'folder',token_id:null,user_id:'source_user',group_id:null,creator_user_id:'source_user',ancestor_ids:index?['SourceRoot']:[],title:index?'Child':'Root',description:'Exact metadata',source:null,meta:{original:'preserved'},version:7,created_at:time,updated_at:time,edit_id:'captured-edit-'+id,visibility:'private',access:'read',actor_user_id:'source_user',actor_token_id:null,link_role:'commenter',deleted_at:null,dataset_policy:null,sharing_revision:2,policy_revision:0,document:null,document_archived_at:null,forked_from:null,generation_calls:0}));
 const inventoryFolders=rawFolders.map(row=>({id:row.id,format:row.format,user_id:row.user_id,token_id:row.token_id,group_id:row.group_id,version:row.version,deleted_at:row.deleted_at,native_import:null}));
 const sourceInventory={users:[{id:'source_user'}],tokens:[],artifacts:inventoryFolders},targetInventory={users:[{id:owner.userId}],artifacts:[],reservations:[]};
 const parent=signed({sourceNamespace:'synthetic-folders',sourceInventorySha256:digest(sourceInventory),targetInventorySha256:digest(targetInventory),targets:{users:{source_user:{userId:owner.userId!,email:null}},tokens:{},actors:{}},users:[],createUsers:[],tokens:[],blockers:[],artifactIds:{}}) as NativeIdentityPlan;
 const plan=signed({...parent,artifactIds:{SourceRoot:'SourceRoot',SourceChild:'SourceChild'}});delete (plan as Partial<NativeIdentityPlan>).sha256;plan.sha256=digest(plan);
 const selectionManifest=encoded({createdAt:time,receipts:Array.from({length:393},(_,i)=>({id:`Page${i}`,path:`page-${i}`,sha256:'a'.repeat(64),bytes:1,expectedVersion:1,distinctRevisions:1,archivedRows:0}))});
 const datasets=Array.from({length:190},(_,i)=>{const row={id:`Data${i}`,format:'dataset',version:1,user_id:'source_user',group_id:null,token_id:null,ancestor_ids:i===0?['SourceRoot','SourceChild']:[]};return {id:row.id,version:1,rowSha256:digest(row),receipt:{path:`data-${i}`,sha256:'b'.repeat(64)},row};});
 const datasetCensus=encoded(signed({mode:'latest-only',selectionManifestSha256:selectionManifest.sha256,selectedHeads:393,pages:Array.from({length:393},(_,i)=>({id:`Page${i}`})),datasets}));
 const capture=encoded({snapshot:[{collected_at:time,read_only:'on'}],folders:rawFolders,shares:[{artifact_id:'SourceChild',email:viewer.email!,role:'viewer'}]});
 const folders=rawFolders.map((raw,index)=>({sourceId:raw.id,targetId:index?'SourceChild':'SourceRoot',sourceRowSha256:digest(raw),sourceInventoryRowSha256:digest(inventoryFolders[index]),requiredBy:['Data0'],row:{...Object.fromEntries(Object.entries(raw).filter(([key])=>!['forked_from','generation_calls'].includes(key))),id:index?'SourceChild':'SourceRoot',user_id:owner.userId,creator_user_id:owner.userId,actor_user_id:owner.userId,ancestor_ids:index?['SourceRoot']:[],meta:{...raw.meta,nativeAncillaryFolder:{sourceNamespace:parent.sourceNamespace,sourceId:raw.id,sourceSha256:capture.sha256,identityPlanSha256:plan.sha256}}},shares:index?[{email:viewer.email!,role:'viewer'}]:[]}));
 const approvals=folders.map(folder=>signed({identityPlanSha256:parent.sha256,sourceInventorySha256:parent.sourceInventorySha256,targetInventorySha256:parent.targetInventorySha256,approvedBy:'synthetic-operator',reason:'Referenced dataset ancestors only',sourceId:folder.sourceId,targetId:folder.targetId,sourceRowSha256:folder.sourceInventoryRowSha256,targetArtifactCollision:false as const,targetReservationCollision:false as const,importAncestor:false as const}));
 const recipe=signed({schema:'native-reviewed-ancillary-folders-v1' as const,sourceNamespace:parent.sourceNamespace,parentIdentityPlanSha256:parent.sha256,identityPlanSha256:plan.sha256,selection:{selectionSha256:selectionManifest.sha256,datasetCensusSha256:datasetCensus.sha256,pageSourceIdsSha256:digest(Array.from({length:393},(_,i)=>`Page${i}`).sort()),datasetSourceIdsSha256:digest(datasets.map(row=>row.id).sort()),pageCount:393 as const,datasetCount:190 as const},source:{capture,selectionManifest,datasetCensus,sourceInventory,targetInventory},approvals,folders}) as NativeAncillaryFolderRecipe;
 return {recipe,plan,owner,viewer};
}
it('imports only exact referenced folder heads and ACLs with real mapped humans and null creator tokens; replay is unchanged',async()=>{
 const {recipe,plan,owner}=await fixture(),db=await getDb(),stage=prepareNativeAncillaryFolders(recipe,plan);
 expect(await db.transaction(stage.apply)).toEqual({created:['SourceRoot','SourceChild'],unchanged:[]});await db.transaction(stage.verify);
 expect(await db.transaction(stage.apply)).toEqual({created:[],unchanged:['SourceRoot','SourceChild']});
 const rows=(await db.query<{id:string;token_id:string|null;user_id:string;meta:unknown}>('SELECT id,token_id,user_id,meta FROM artifacts ORDER BY id')).rows;expect(rows.map(row=>row.id)).toEqual(['SourceChild','SourceRoot']);expect(rows.every(row=>row.token_id===null&&row.user_id===owner.userId)).toBe(true);
 expect((await db.query('SELECT * FROM artifact_versions')).rows).toEqual([]);expect((await db.query('SELECT * FROM artifact_edits')).rows).toEqual([]);
 expect((await db.query<{exact:boolean}>("SELECT created_at='2020-01-02T03:04:05.123456Z'::timestamptz AS exact FROM artifacts")).rows.every(row=>row.exact)).toBe(true);
});
it('captures reviewed inputs before awaits and refuses target metadata/ACL drift instead of overwriting it',async()=>{
 const {recipe,plan}=await fixture(),db=await getDb(),stage=prepareNativeAncillaryFolders(recipe,plan);recipe.folders[0]!.row.title='mutated';
 await db.transaction(stage.apply);await db.query("UPDATE artifacts SET title='target change' WHERE id='SourceRoot'");await expect(db.transaction(stage.apply)).rejects.toThrow('native_ancillary_collision');
 expect((await db.query<{title:string}>("SELECT title FROM artifacts WHERE id='SourceRoot'")).rows[0]!.title).toBe('target change');
});
it('rolls back all folders and reservations on later collision, and refuses missing mapped principals',async()=>{
 const {recipe,plan}=await fixture(),db=await getDb(),stage=prepareNativeAncillaryFolders(recipe,plan);
 await db.query("INSERT INTO artifact_id_registry(id,owner,consumed) VALUES('SourceChild','other',true)");await expect(db.transaction(stage.apply)).rejects.toThrow('native_ancillary_collision');expect((await db.query('SELECT id FROM artifacts')).rows).toEqual([]);expect((await db.query("SELECT id FROM artifact_id_registry WHERE id='SourceRoot'")).rows).toEqual([]);
 await db.query('DELETE FROM users WHERE id=$1',[(plan.targets.users.source_user!).userId]);await expect(db.transaction(stage.apply)).rejects.toThrow('native_ancillary_principal');
});
it('rejects source/approval/mapping/selection drift and extra non-ancestor imports before database writes',async()=>{
 const {recipe,plan}=await fixture();
 for(const mutate of [(r:NativeAncillaryFolderRecipe)=>{r.folders[0]!.row.visibility='public';},(r:NativeAncillaryFolderRecipe)=>{r.approvals[0]!.reason='changed';},(r:NativeAncillaryFolderRecipe)=>{r.folders[0]!.requiredBy=['Data1'];},(r:NativeAncillaryFolderRecipe)=>{r.source.capture.data=Buffer.from('{}').toString('base64');}]){const copy=structuredClone(recipe);mutate(copy);const {sha256:_,...body}=copy;copy.sha256=digest(body);expect(()=>prepareNativeAncillaryFolders(copy,plan)).toThrow();}
});

it('refuses ACL and reservation drift on replay while preserving existing target values',async()=>{
 const {recipe,plan}=await fixture(),db=await getDb(),stage=prepareNativeAncillaryFolders(recipe,plan);await db.transaction(stage.apply);
 await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id='SourceChild'");await expect(db.transaction(stage.verify)).rejects.toThrow('native_ancillary_collision');expect((await db.query<{role:string}>("SELECT role FROM artifact_shares WHERE artifact_id='SourceChild'")).rows[0]!.role).toBe('editor');
 await db.query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id='SourceChild'");await db.query("UPDATE artifact_id_registry SET consumed=false WHERE id='SourceRoot'");await expect(db.transaction(stage.apply)).rejects.toThrow('native_ancillary_collision');expect((await db.query<{consumed:boolean}>("SELECT consumed FROM artifact_id_registry WHERE id='SourceRoot'")).rows[0]!.consumed).toBe(false);
});
it('rejects extra folders, unmapped identities and owner-changing source ancestry even with re-signed outer receipts',async()=>{
 const {recipe,plan}=await fixture();
 for(const mutate of [(r:NativeAncillaryFolderRecipe)=>{r.folders=[...r.folders,{...r.folders[0]!,sourceId:'ExtraFolder',targetId:'ExtraFolder'}];},(r:NativeAncillaryFolderRecipe)=>{r.folders[0]!.row.token_id='unmapped-token';},(r:NativeAncillaryFolderRecipe)=>{const census=JSON.parse(Buffer.from(r.source.datasetCensus.data,'base64').toString());census.datasets[0].row.user_id='different-owner';census.datasets[0].rowSha256=digest(census.datasets[0].row);const {sha256:_,...body}=census;r.source.datasetCensus=encoded(signed(body));r.selection.datasetCensusSha256=r.source.datasetCensus.sha256;}]){const copy=structuredClone(recipe);mutate(copy);const {sha256:_,...body}=copy;copy.sha256=digest(body);expect(()=>prepareNativeAncillaryFolders(copy,plan)).toThrow();}
});
