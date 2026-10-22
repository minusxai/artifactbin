import {projectMigrationCommentContext} from "./comment-projection.ts";
import {preservedOrphanActor} from "./orphans.ts";
import {registerMigrationBackends} from "./backend-preparation.ts";
import {MAX_PAGE_SOURCE} from '../af-contracts.ts';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {prepareMigrationPageSources} from "./page-source-preparation.ts";
import {normalizePath} from '../path-model.ts';
import {planMigrationGroups} from './groups.ts';
import {planMigrationIdentities,isPreservedNonloginActor} from './identities.ts';
import type {ImportDestination,MigrationManifest,MigrationMaps,PlannedPage,SqlReader} from './contracts.ts';
import type {DestinationOptions,DestinationPreparation} from './postgres-contracts.ts';
import {destinationSchemas} from './destination-schema.ts';
import type {DestinationSchemas} from './destination-schema.ts';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function buildAccountMaps(manifest:MigrationManifest):MigrationMaps {
 return planMigrationIdentities(manifest).maps;
}
const segment=(value:unknown)=>String(value??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-|-$/g,'').slice(0,60)||'untitled';
export function publicationPath(page:PlannedPage):string {
 const ancestors=Array.isArray(page.original.ancestor_ids)?page.original.ancestor_ids.map(value=>'folder-'+digest(String(value)).slice(0,16)):[];
 return '/imported/'+[...ancestors,segment(page.original.title)+'-'+page.pageId+'.html'].join('/');
}
export function destinationAccess(page:PlannedPage,maps?:MigrationMaps):Record<string,unknown>{
 if(!['public','private','unlisted'].includes(page.access.visibility))throw new Error('Unsupported visibility');
 const roles=['viewer','commenter','editor'];if(!roles.includes(page.access.linkRole))throw new Error('Unsupported link role');
 const shares:Record<string,string>={};
 for(const row of page.access.shares){const resolved=row.user_id!==null&&row.user_id!==undefined;const email=resolved?maps?.users[String(row.user_id)]:String(row.email??'').trim().toLowerCase();if(!email)throw new Error('Unmapped resolved share identity');if(!roles.includes(String(row.role)))throw new Error('Unsupported named role');const role=String(row.role);if(!shares[email]||roles.indexOf(role)>roles.indexOf(shares[email]!))shares[email]=role;}
 return {visibility:page.access.visibility,linkRole:page.access.linkRole,shares,version:0};
}
export class PostgresMigrationDestination implements ImportDestination {
 private maps:MigrationMaps={users:{},tokens:{},groups:{},pages:{}};
 private namespace='';
 private readonly db:SqlReader;
 private readonly options:DestinationOptions;
 private readonly names:DestinationSchemas;
 constructor(db:SqlReader,options:DestinationOptions,maps?:MigrationMaps){this.names=destinationSchemas(options.schema);this.db=db;this.options={...options};if(maps)this.maps=maps;}
 private get schema(){return this.names.runtime}
 private get archive(){return this.names.archive}
 private async transaction<T>(operation:()=>Promise<T>):Promise<T>{
  if(!this.options.isolated)throw new Error('An explicitly isolated destination is required');
  await this.db.query('BEGIN');try{await this.db.query(`SET LOCAL search_path TO ${this.schema}`);const value=await operation();await this.db.query('COMMIT');return value;}catch(error){await this.db.query('ROLLBACK');throw error;}
 }
 async prepare(input:DestinationPreparation):Promise<void>{
  if(!this.options.isolated)throw new Error('An explicitly isolated destination is required');
  this.maps=input.maps;this.namespace=input.manifest.sourceNamespace;
  const schemaSql=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  await this.transaction(async()=>{
   await this.db.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);await this.db.query(`SET LOCAL search_path TO ${this.schema}`);
   await this.db.query(schemaSql);
   await this.db.query(await readFile(new URL('../backend/af-schema.sql',import.meta.url),'utf8'));
   await this.db.query(await readFile(new URL('../datasets/schema.sql',import.meta.url),'utf8'));
   await this.db.query(`CREATE SCHEMA IF NOT EXISTS ${this.archive}`);
   await this.db.query(`CREATE TABLE IF NOT EXISTS ${this.archive}.archives(namespace text PRIMARY KEY,digest text NOT NULL,manifest jsonb NOT NULL,maps jsonb NOT NULL)`);
   await this.db.query(`CREATE TABLE IF NOT EXISTS ${this.archive}.receipts(key text PRIMARY KEY,digest text NOT NULL,page_id text NOT NULL,imported_at timestamptz NOT NULL DEFAULT now())`);
   const text=JSON.stringify(input.manifest);const old=(await this.db.query(`SELECT digest FROM ${this.archive}.archives WHERE namespace=$1 FOR UPDATE`,[this.namespace])).rows[0];
   if(old&&old.digest!==digest(text))throw new Error('Source archive changed; use a new migration namespace');
   if(!old)await this.db.query(`INSERT INTO ${this.archive}.archives VALUES($1,$2,$3::jsonb,$4::jsonb)`,[this.namespace,digest(text),text,JSON.stringify(input.maps)]);
   for(const actor of new Set([...Object.values(input.maps.users),...Object.values(input.maps.tokens),...Object.values(input.maps.orphans??{})]))await this.db.query('INSERT INTO accounts(actor) VALUES($1) ON CONFLICT(actor) DO NOTHING',[actor]);
   for (const actor of Object.values(input.maps.orphans ?? {})) {
    const account = (await this.db.query('SELECT principal_kind,salt,password,handle FROM accounts WHERE actor=$1', [actor])).rows[0];
    if (!/^legacy-orphan:[a-f0-9]{64}$/.test(actor) || !account || account.principal_kind !== 'user' || account.salt !== null || account.password !== null || account.handle !== null)
     throw new Error('Orphan principal conflicts with existing account');
   }
   for(const user of input.manifest.tables.users??[]){
    const actor=input.maps.users[String(user.id)];if(!actor)continue;
    if(typeof user.name==='string')await this.db.query('UPDATE accounts SET name=COALESCE(name,$2) WHERE actor=$1',[actor,user.name]);
    if(isPreservedNonloginActor(actor))continue;
    const handle=typeof user.username==='string'?user.username.toLowerCase():null;
    if(handle&&/^[a-z0-9]+(-[a-z0-9]+)*$/.test(handle)&&handle.length>=3&&handle.length<=32)await this.db.query('UPDATE accounts SET handle=$2 WHERE actor=$1 AND handle IS NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE handle=$2)',[actor,handle]);
   }

   for(const group of planMigrationGroups(input.manifest,input.maps.users).groups){
    if(input.maps.groups[group.legacyId]!==group.actor)throw new Error('Group mapping mismatch');
    const existingAccount=(await this.db.query('SELECT principal_kind,salt,password,handle FROM accounts WHERE actor=$1',[group.actor])).rows[0];if(existingAccount&&(existingAccount.principal_kind!=='group'||existingAccount.salt!==null||existingAccount.password!==null||existingAccount.handle!==null))throw new Error('Group principal conflicts with existing account');
    const existingGroup=(await this.db.query('SELECT active FROM groups WHERE owner=$1',[group.actor])).rows[0];if(existingGroup&&existingGroup.active!==group.active)throw new Error('Group activation conflicts with existing authority');
    const existingMembers=(await this.db.query('SELECT actor,role FROM group_memberships WHERE owner=$1',[group.actor])).rows;if((existingGroup&&existingMembers.length!==group.members.length)||existingMembers.some(member=>!group.members.some(m=>m.actor===member.actor&&m.role===member.role)))throw new Error('Group membership conflicts with existing authority');
    await this.db.query("INSERT INTO accounts(actor,principal_kind,name) VALUES($1,'group',$2) ON CONFLICT(actor) DO NOTHING",[group.actor,group.name]);
    await this.db.query('INSERT INTO groups(owner,active) VALUES($1,$2) ON CONFLICT(owner) DO NOTHING',[group.actor,group.active]);
    for(const member of group.members)await this.db.query('INSERT INTO group_memberships(owner,actor,role) VALUES($1,$2,$3) ON CONFLICT(owner,actor) DO NOTHING',[group.actor,member.actor,member.role]);
   }
   for(const folder of input.manifest.artifacts.filter(a=>a.format==='folder'&&!a.deleted_at)){
    const actor=folder.user_id?input.maps.users[folder.user_id]:undefined;if(!actor||folder.group_id)continue;
    const path='/imported/'+[...(Array.isArray(folder.ancestor_ids)?folder.ancestor_ids:[]),folder.id].map(value=>'folder-'+digest(String(value)).slice(0,16)).join('/');
    await this.db.query('INSERT INTO folders(owner,path) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor,path]);
   }
  });
 }
 supportsExactAccess(page:PlannedPage):boolean {
  if(page.owner?.kind==='orphan'&&(page.original.user_id!==null||page.original.group_id!==null||(page.original.token_id!==null&&page.original.token_id!=='')||this.maps.orphans?.[page.legacyId]!==page.owner.id||(this.namespace&&preservedOrphanActor(this.namespace,page.original)!==page.owner.id)))return false;
  try{destinationAccess(page,this.maps);normalizePath(publicationPath(page));}catch{return false;}
  if(page.owner?.kind!=='user'&&page.owner?.kind!=='token'&&page.owner?.kind!=='group'&&page.owner?.kind!=='orphan')return false;
  if(page.original.deleted_at)return false;
  if(!this.options.editorManageRestricted&&(page.access.linkRole==='editor'||page.access.shares.some(s=>s.role==='editor')))return false;
  return true;
 }
 async importPage(key:string,checksum:string,page:PlannedPage):Promise<'created'|'unchanged'>{
  if(!this.namespace||key!==this.namespace+':'+page.legacyId)throw new Error('Destination preparation/key mismatch');
  if(page.disposition!=='ready'||!this.supportsExactAccess(page)||!page.owner)throw new Error('Page cannot preserve source access/content');
  return this.transaction(async()=>{
   await this.db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
   const old=(await this.db.query(`SELECT digest,page_id FROM ${this.archive}.receipts WHERE key=$1`,[key])).rows[0];
   if(old){if(old.digest!==checksum||old.page_id!==page.pageId)throw new Error('Migration receipt conflicts with changed content');return 'unchanged';}
   const owner=page.owner!.id;const head=String(page.original.version);const current=page.revisions.find(r=>String(r.version)===head);
   if(!current?.conversion.html)throw new Error('Missing converted head');
   // IDs are reserved with ordinary INSERT: existing destination identities can never be overwritten.
   await this.db.query('INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES($1,$2,\'page\',true,$3)',[page.pageId,owner,Number(new Date(String(page.original.created_at??0)))||0]);
   const path=publicationPath(page);
   const normalized=prepareMigrationPageSources(page,this.options.origin);
   if(normalized.some(r=>Buffer.byteLength(r.prepared.source)>MAX_PAGE_SOURCE))throw new Error('Normalized HTML exceeds destination source limit');
   const preparedHead=normalized.find(r=>String(r.version)===head)!.prepared;
   const nextNodeId=Number(preparedHead.meta.nextNodeId??1);
   await this.db.query('INSERT INTO files(id,owner,share_hash,generation,head,sequence,path,access,next_node_id,source_digest) VALUES($1,$2,$3,1,$4,0,$5,$6::jsonb,$7,$8)',[page.pageId,owner,digest(randomBytes(32).toString('hex')),head,path,JSON.stringify(destinationAccess(page,this.maps)),nextNodeId,digest(preparedHead.source)]);
   await this.db.query('UPDATE files SET seed=$2::jsonb WHERE id=$1',[page.pageId,JSON.stringify(preparedHead.state)]);
   for(const r of normalized)await this.db.query('INSERT INTO sources(file_id,revision,content,node_ids,digest) VALUES($1,$2,$3,$4::jsonb,$5)',[page.pageId,String(r.version),r.prepared.source,JSON.stringify(r.prepared.nodeIds),digest(r.prepared.source)]);
   for(const asset of page.assets??[])await this.db.query('INSERT INTO page_assets(page_id,revision,variant,sha256,content_type,filename,byte_length,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7,$4)',[page.pageId,asset.revision,asset.variant,asset.sha256,asset.contentType,asset.filename,asset.bytes]);
   if(page.backends?.length)await registerMigrationBackends(this.db,page.backends);
   const parts=path.split('/').slice(1,-1);for(let i=1;i<=parts.length;i++)await this.db.query('INSERT INTO folders(owner,path) VALUES($1,$2) ON CONFLICT DO NOTHING',[owner,'/'+parts.slice(0,i).join('/')]);
   const comments=page.comments.filter(c=>!c.deleted_at);let sequence=0;
   for(const c of comments){
    const author=this.maps.users[String(c.author_user_id)]??this.maps.tokens[String(c.author_token_id)];if(!author)throw new Error('Unmapped comment author');
    const root=c.root_id?comments.find(r=>r.id===c.root_id):c;if(!root)throw new Error('Comment references missing root');
    const {sourceRevision:revision,nodeId:mapped,contextStatus}=projectMigrationCommentContext({root,revisions:page.revisions});
    const snapshot=revision===null||c.view_state===null||c.view_state===undefined?null:'legacy-'+String(c.id);
    if(snapshot)await this.db.query('INSERT INTO snapshots(file_id,id,source_revision,schema_version,state,view,rendered) VALUES($1,$2,$3,1,$4::jsonb,$5::jsonb,NULL)',[page.pageId,snapshot,revision,'{}',JSON.stringify(c.view_state)]);
    await this.db.query('INSERT INTO comments(file_id,id,node_id,quote,body,source_revision,parent_id,app_state_id,published_by,created_at,revision,resolved,fingerprint,sequence,context_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)',[page.pageId,String(c.id),mapped,String(c.quote??c.snippet??''),String(c.body??''),revision,c.root_id??null,snapshot,author,String(c.created_at),Number(c.revision??1),root.status==='resolved',digest(JSON.stringify(c)),++sequence,contextStatus?JSON.stringify(contextStatus):null]);
   }
   await this.db.query('UPDATE files SET sequence=$2 WHERE id=$1',[page.pageId,sequence]);
   await this.db.query(`INSERT INTO ${this.archive}.receipts(key,digest,page_id) VALUES($1,$2,$3)`,[key,checksum,page.pageId]);return 'created';
  });
 }
}
