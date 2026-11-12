/**
 * PROGRAM TRUST: the saved-document context an upload through a page carries (lib/dataset-permissions asks it
 * for `backend_only` rules), and the plain read-through check of a row. Decided inside the caller's transaction
 * when it has one. The rows a decision consults are read here by their access columns alone: no document, no content.
 */
import {verifySavedHtmlUpload,type SavedHtmlUploadDocument} from './saved-html-upload';
import {transactionAccessFacts,type AccessFacts} from './access-facts';
import {ownsArtifact} from './access';
import { JOIN_RELATIONS } from '@/lib/social';
import type { DatasetGrantContext, Queryable } from '@artifactbin/contracts';
import type { ArtifactRow } from './scopes';
import type { AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { DatasetError } from '@/lib/datasets';

const principalOf=(row:Pick<ArtifactRow,'user_id'|'token_id'> & Partial<Pick<ArtifactRow,'group_id'>>)=>({userId:row.group_id?null:row.user_id,tokenId:row.group_id?null:row.token_id,groupId:row.group_id??null});
/** The dataset columns a grant decision reads. */
export type GrantDataset = Pick<ArtifactRow,'id'|'user_id'|'token_id'|'visibility'|'format'|'dataset_policy'|'policy_revision'> & Partial<Pick<ArtifactRow,'group_id'>>;
const ACCESS_COLUMNS='id,user_id,token_id,group_id,visibility,format,edit_id,dataset_policy,policy_revision';
/** The row fields a read decision consults. */
export type ReadRow = Pick<ArtifactRow,'id'|'user_id'|'token_id'|'visibility'|'format'> & Partial<Pick<ArtifactRow,'group_id'|'dataset_policy'>>;
/** Called inside an optional existing transaction; never enqueues work on the outer database. `facts` defaults to `tx`'s. */
export async function readThrough(tx:Queryable,row:ReadRow,actor:AccessActor,facts:AccessFacts=transactionAccessFacts(actor,tx)):Promise<boolean>{
 if(row.group_id&&(await facts.groupRole(row.group_id)||await facts.groupAudience(row.group_id)))return true;
 if(ownsArtifact(row,actor)||row.visibility!=='private')return true;
 if(!actor.userId)return false;
 return await facts.sharedWith(row.id)||await facts.groupShareRole(row.id)!=='none';
}
/** A saved, readable page plus accepted membership supplies artifact context for an upload, through its own
 * saved-link proof; it never authorizes SQL actions. */
export async function uploadGrantContext(dataset:GrantDataset,actor:AccessActor,document:SavedHtmlUploadDocument,tx?:Queryable):Promise<DatasetGrantContext>{
 return savedGrantContext(dataset,actor,document,tx,db=>verifySavedHtmlUpload(document,dataset.id,db));
}
async function savedGrantContext(dataset:GrantDataset,actor:AccessActor,document:{id:string;editId:string},tx:Queryable|undefined,verifyHtml:(db:Queryable)=>Promise<boolean>):Promise<DatasetGrantContext>{
 const db=tx??await getDb();
 const editorGroups=actor.userId?(await db.query<{group_id:string}>("SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id=gm.group_id WHERE gm.user_id=$1 AND gm.role IN ('editor','admin') AND g.deleted_at IS NULL",[actor.userId])).rows.map(r=>r.group_id):[];
 const context:DatasetGrantContext={caller:actor,owner:principalOf(dataset),callerEditorGroupIds:editorGroups};
 const identity=actor.userId?(await db.query<{kind:string}>("SELECT kind FROM users WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())",[actor.userId])).rows[0]:null;
 if(actor.userId&&(!identity||identity.kind==='guest'))throw new DatasetError('Sign in to change data',403);
 if(identity?.kind==='testuser'&&!(await db.query("SELECT 1 FROM users WHERE id=$1 AND kind='testuser'",[dataset.user_id])).rows.length)throw new DatasetError('Test users may only act inside their sandbox',403);
 const doc=(await db.query<GrantDataset&{edit_id:string}>(`SELECT ${ACCESS_COLUMNS} FROM artifacts WHERE id=$1 AND deleted_at IS NULL`,[document.id])).rows[0];
 if(!doc||!(doc.format==='html'&&await verifyHtml(db))||doc.edit_id!==document.editId||!(await readThrough(db,doc,actor)))throw new DatasetError('Document access or action changed',403);
 const tokenCreator=!doc.group_id&&!doc.user_id&&ownsArtifact(doc,actor);
 if(!tokenCreator){
  if(!identity||identity.kind==='guest')throw new DatasetError('Sign in and join this artifact to use its actions',403);
  if(identity.kind==='testuser'&&!(await db.query("SELECT 1 FROM users WHERE id=$1 AND kind='testuser'",[doc.user_id])).rows.length)throw new DatasetError('Test users may only act inside their sandbox',403);
  if(!(await db.query(`SELECT 1 FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND user_id=$2 AND status='accepted'`,[doc.id,actor.userId])).rows.length)throw new DatasetError('Join this artifact before using its actions',403);
 }
 context.artifact={id:doc.id,owner:principalOf(doc)};
 return context;
}

