/**
 * DATASET GRANTS (policy version 2): who may read and write a governed dataset, directly or through a saved document,
 * decided inside the caller's transaction when it has one. The rows a decision consults are read here by their
 * access columns alone: no document, no content.
 */
import {verifySavedHtmlUpload,type SavedHtmlUploadDocument} from './saved-html-upload';
import {verifyRegisteredHtmlMutation} from './registered-html-mutation';
import {liveAccessFacts,type AccessFacts} from './access-facts';
import {ownsArtifact} from './access';
import { JOIN_RELATIONS } from '@/lib/social';
import type { DatasetGrantContext, DatasetGrantPolicy, Queryable } from '@artifactbin/contracts';
import { datasetGrantAllows, parseDatasetGrants } from '@artifactbin/utils';
import type { ArtifactRow } from './scopes';
import type { AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { DatasetError } from '@/lib/datasets';

export function grantsOf(row: Pick<ArtifactRow,'dataset_policy'>): DatasetGrantPolicy | null {
  const value=row.dataset_policy;
  return value&&typeof value==='object'&&'version' in value&&value.version===2?parseDatasetGrants(value):null;
}
const principalOf=(row:Pick<ArtifactRow,'user_id'|'token_id'> & Partial<Pick<ArtifactRow,'group_id'>>)=>({userId:row.group_id?null:row.user_id,tokenId:row.group_id?null:row.token_id,groupId:row.group_id??null});
export interface GrantDocument {id:string;editId:string;registeredHtml?:object}
/** The dataset columns a grant decision reads. */
export type GrantDataset = Pick<ArtifactRow,'id'|'user_id'|'token_id'|'visibility'|'format'|'dataset_policy'|'policy_revision'> & Partial<Pick<ArtifactRow,'group_id'>>;
const ACCESS_COLUMNS='id,user_id,token_id,group_id,visibility,format,edit_id,dataset_policy,policy_revision';
/** The row fields a read decision consults. */
export type ReadRow = Pick<ArtifactRow,'id'|'user_id'|'token_id'|'visibility'|'format'> & Partial<Pick<ArtifactRow,'group_id'|'dataset_policy'>>;
/** Called inside an optional existing transaction; never enqueues work on the outer database. `facts` defaults to `tx`'s. */
export async function readThrough(tx:Queryable,row:ReadRow,actor:AccessActor,facts:AccessFacts=liveAccessFacts(actor,tx)):Promise<boolean>{
 if(row.group_id&&await facts.groupRole(row.group_id))return true;
 if(ownsArtifact(row,actor)||row.visibility!=='private')return true;
 if(!actor.userId)return false;
 return facts.sharedWith(row.id);
}
/** A saved, readable document plus accepted membership supplies artifact context for writes. */
export async function grantContext(dataset:GrantDataset,actor:AccessActor,document?:GrantDocument,tx?:Queryable):Promise<DatasetGrantContext>{
 return savedGrantContext(dataset,actor,document,tx,document?db=>verifyRegisteredHtmlMutation(document,db):undefined);
}
/** File uploads use their own saved-link proof; it never authorizes SQL actions. */
export async function uploadGrantContext(dataset:GrantDataset,actor:AccessActor,document:SavedHtmlUploadDocument,tx?:Queryable):Promise<DatasetGrantContext>{
 return savedGrantContext(dataset,actor,document,tx,db=>verifySavedHtmlUpload(document,dataset.id,db));
}
async function savedGrantContext(dataset:GrantDataset,actor:AccessActor,document?:{id:string;editId:string},tx?:Queryable,verifyHtml?:(db:Queryable)=>Promise<boolean>):Promise<DatasetGrantContext>{
 const db=tx??await getDb();
 const editorGroups=actor.userId?(await db.query<{group_id:string}>("SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id=gm.group_id WHERE gm.user_id=$1 AND gm.role='editor' AND g.deleted_at IS NULL FOR SHARE OF gm,g",[actor.userId])).rows.map(r=>r.group_id):[];
 const context:DatasetGrantContext={caller:actor,owner:principalOf(dataset),callerEditorGroupIds:editorGroups};
 const identity=actor.userId?(await db.query<{kind:string}>("SELECT kind FROM users WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())",[actor.userId])).rows[0]:null;
 if(actor.userId&&(!identity||identity.kind==='guest'))throw new DatasetError('Sign in to change data',403);
 if(identity?.kind==='testuser'&&!(await db.query("SELECT 1 FROM users WHERE id=$1 AND kind='testuser'",[dataset.user_id])).rows.length)throw new DatasetError('Test users may only act inside their sandbox',403);
 if(!document){if(!identity&&!ownsArtifact(dataset,actor))throw new DatasetError('Sign in to change data',403);return context;}
 const doc=(await db.query<GrantDataset&{edit_id:string}>(`SELECT ${ACCESS_COLUMNS} FROM artifacts WHERE id=$1 AND deleted_at IS NULL`,[document.id])).rows[0];
 if(!doc||(doc.format!=='markup'&&!(doc.format==='html'&&await verifyHtml?.(db)))||doc.edit_id!==document.editId||!(await readThrough(db,doc,actor)))throw new DatasetError('Document access or action changed',403);
 const tokenCreator=!doc.group_id&&!doc.user_id&&ownsArtifact(doc,actor);
 if(!tokenCreator){
  if(!identity||identity.kind==='guest')throw new DatasetError('Sign in and join this artifact to use its actions',403);
  if(identity.kind==='testuser'&&!(await db.query("SELECT 1 FROM users WHERE id=$1 AND kind='testuser'",[doc.user_id])).rows.length)throw new DatasetError('Test users may only act inside their sandbox',403);
  if(!(await db.query(`SELECT 1 FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND user_id=$2 AND status='accepted'`,[doc.id,actor.userId])).rows.length)throw new DatasetError('Join this artifact before using its actions',403);
 }
 context.artifact={id:doc.id,owner:principalOf(doc)};
 return context;
}
export async function grantsPermitWrite(dataset:GrantDataset,actor:AccessActor,document?:GrantDocument,tx?:Queryable):Promise<boolean>{
 const policy=grantsOf(dataset);if(!policy)return false;
 try {const context=await grantContext(dataset,actor,document,tx);return (['insert','update','delete'] as const).some(op=>datasetGrantAllows(policy,op,context));}catch{return false;}
}
/** Lock the document with the dataset so membership/access revocation cannot race the commit. */
export async function assertGrantCommit(tx:Queryable,dataset:GrantDataset,actor:AccessActor,document?:GrantDocument):Promise<void>{
 await tx.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[...new Set([dataset.id,...(document?[document.id]:[])])]]);
 const current=(await tx.query<GrantDataset>(`SELECT ${ACCESS_COLUMNS} FROM artifacts WHERE id=$1 AND deleted_at IS NULL`,[dataset.id])).rows[0];
 if(!current||(current.policy_revision??0)!==(dataset.policy_revision??0)||!(await grantsPermitWrite(current,actor,document,tx)))throw new DatasetError('Mutation permission changed',403);
}

/** Read grants use the actual caller and saved artifact; membership only gates mutations. */
export async function grantsPermitRead(dataset:ReadRow,actor:AccessActor,document?:ReadRow,tx?:Queryable,given?:AccessFacts):Promise<boolean>{
 const policy=grantsOf(dataset);if(!policy)return false;
 const db=tx??await getDb(),facts=given??liveAccessFacts(actor,db);
 // Making a dataset private remains an audience ceiling, even with a public read grant.
 if(dataset.visibility==='private'&&!(await readThrough(db,dataset,actor,facts)))return false;
 if(document&&!(await readThrough(db,document,actor,facts)))return false;
 return datasetGrantAllows(policy,'read',{caller:actor,owner:principalOf(dataset),callerEditorGroupIds:await facts.editorGroupIds(),...(document?{artifact:{id:document.id,owner:principalOf(document)}}:{})});
}
