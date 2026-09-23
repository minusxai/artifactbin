import type { DatasetGrantContext, DatasetGrantPolicy, Queryable } from '@artifactbin/contracts';
import { datasetGrantAllows, parseDatasetGrants } from '@artifactbin/utils';
import type { ArtifactRow, RoleActor } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { hasDocumentEditorAccess } from '@/lib/document-policy';
import { DatasetError } from '../errors';

export function grantsOf(row: Pick<ArtifactRow,'dataset_policy'>): DatasetGrantPolicy | null {
  const value=row.dataset_policy;
  return value&&typeof value==='object'&&'version' in value&&value.version===2?parseDatasetGrants(value):null;
}
export const principalOf=(row:Pick<ArtifactRow,'user_id'|'token_id'>)=>({userId:row.user_id,tokenId:row.token_id});
export interface GrantDocument {id:string;editId:string}
function owns(row:Pick<ArtifactRow,'user_id'|'token_id'>,actor:RoleActor){return row.user_id?!!actor.userId&&row.user_id===actor.userId:!!actor.tokenId&&row.token_id===actor.tokenId;}
/** Called inside an optional existing transaction; never enqueues work on the outer database. */
export async function readThrough(tx:Queryable,row:ArtifactRow,actor:RoleActor):Promise<boolean>{
 if(owns(row,actor)||row.visibility!=='private'||(row.format==='markup'&&hasDocumentEditorAccess(actor)))return true;
 if(!actor.userId)return false;
 return !!(await tx.query(`SELECT 1 FROM artifact_shares s WHERE s.artifact_id=$1 AND (s.user_id=$2 OR(s.user_id IS NULL AND s.email=(SELECT email FROM users WHERE id=$2)))`,[row.id,actor.userId])).rows.length;
}
/** A saved, readable document plus accepted membership supplies artifact context for writes. */
export async function grantContext(dataset:ArtifactRow,actor:RoleActor,document?:GrantDocument,tx?:Queryable):Promise<DatasetGrantContext>{
 const db=tx??await getDb();
 const context:DatasetGrantContext={caller:actor,owner:principalOf(dataset)};
 const identity=actor.userId?(await db.query<{kind:string}>("SELECT kind FROM users WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())",[actor.userId])).rows[0]:null;
 if(actor.userId&&(!identity||identity.kind==='guest'))throw new DatasetError('Sign in to change data',403);
 if(identity?.kind==='testuser'&&!(await db.query("SELECT 1 FROM users WHERE id=$1 AND kind='testuser'",[dataset.user_id])).rows.length)throw new DatasetError('Test users may only act inside their sandbox',403);
 if(!document){if(!identity&&!owns(dataset,actor))throw new DatasetError('Sign in to change data',403);return context;}
 const doc=(await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[document.id])).rows[0];
 if(!doc||doc.format!=='markup'||doc.edit_id!==document.editId||!(await readThrough(db,doc,actor)))throw new DatasetError('Document access or action changed',403);
 const tokenCreator=!doc.user_id&&owns(doc,actor);
 if(!tokenCreator){
  if(!identity||identity.kind==='guest')throw new DatasetError('Sign in and join this artifact to use its actions',403);
  if(identity.kind==='testuser'&&!(await db.query("SELECT 1 FROM users WHERE id=$1 AND kind='testuser'",[doc.user_id])).rows.length)throw new DatasetError('Test users may only act inside their sandbox',403);
  if(!(await db.query("SELECT 1 FROM artifact_members WHERE artifact_id=$1 AND user_id=$2 AND status='accepted'",[doc.id,actor.userId])).rows.length)throw new DatasetError('Join this artifact before using its actions',403);
 }
 context.artifact={id:doc.id,owner:principalOf(doc)};
 return context;
}
export async function grantsPermitWrite(dataset:ArtifactRow,actor:RoleActor,document?:GrantDocument,tx?:Queryable):Promise<boolean>{
 const policy=grantsOf(dataset);if(!policy)return false;
 try {const context=await grantContext(dataset,actor,document,tx);return (['insert','update','delete'] as const).some(op=>datasetGrantAllows(policy,op,context));}catch{return false;}
}
/** Lock the document with the dataset so membership/access revocation cannot race the commit. */
export async function assertGrantCommit(tx:Queryable,dataset:ArtifactRow,actor:RoleActor,document?:GrantDocument):Promise<void>{
 await tx.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[...new Set([dataset.id,...(document?[document.id]:[])])]]);
 const current=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[dataset.id])).rows[0];
 if(!current||(current.policy_revision??0)!==(dataset.policy_revision??0)||!(await grantsPermitWrite(current,actor,document,tx)))throw new DatasetError('Mutation permission changed',403);
}

/** Read grants use the actual caller and saved artifact; membership only gates mutations. */
export async function grantsPermitRead(dataset:ArtifactRow,actor:RoleActor,document?:ArtifactRow,tx?:Queryable):Promise<boolean>{
 const policy=grantsOf(dataset);if(!policy)return false;
 const db=tx??await getDb();
 // Making a dataset private remains an audience ceiling, even with a public read grant.
 if(dataset.visibility==='private'&&!(await readThrough(db,dataset,actor)))return false;
 if(document&&!(await readThrough(db,document,actor)))return false;
 return datasetGrantAllows(policy,'read',{caller:actor,owner:principalOf(dataset),...(document?{artifact:{id:document.id,owner:principalOf(document)}}:{})});
}
