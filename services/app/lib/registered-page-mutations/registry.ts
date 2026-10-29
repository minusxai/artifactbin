import {buildSchema} from 'graphql';
import {createHash} from 'node:crypto';
import type {HtmlBackendLink,HtmlPageVersion,Queryable} from '@artifactbin/contracts';
import type {HtmlBackendVersionRecord} from '@/lib/html-backends';
import type {RegisteredMutationPlan as QueryPlan,MutationProgram} from './contracts';
import {validateMutationProgram} from './model';
import {registeredMutationSchema} from './namespace';
import type {RegisteredRepair,RepairableHead} from '../registered-page-queries';
export type RegisteredMutationProgram=MutationProgram;
interface Envelope {kind:'registered-page-mutations-v1';pageId:string;pageVersion:number;sourceSha256:string;provenance:{compilerSha256:string;sourceSha256:string};program:RegisteredMutationProgram;digest:string}
const PREFIX='!registered-page-mutations-v1\n';
const pageSourceDigest=(html:string)=>createHash('sha256').update(html).digest('hex');
const digest=(value:unknown)=>pageSourceDigest(JSON.stringify(value));
function contentVersion(source:string,typeDefs:string,compiled:string){return digest([source,typeDefs,compiled,[]]);}
/** Trusted host preparation only: this object is never accepted by the public backend compiler.
 * Its compiled envelope begins with invalid JavaScript. The ordinary compiler always emits its own JS wrapper. */
export function prepareRegisteredMutationBackend(name:string,backendId:string,page:Pick<HtmlPageVersion,'pageId'|'version'|'html'>,program:RegisteredMutationProgram,provenance:Envelope['provenance']){
 if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||! /^[A-Za-z0-9_-]{1,128}$/.test(backendId)||!Number.isSafeInteger(page.version)||page.version<1||![provenance.compilerSha256,provenance.sourceSha256].every(v=>/^[a-f0-9]{64}$/.test(v)))throw Error('invalid_mutation_registration');
 const snapshot=structuredClone(program);validateMutationProgram(snapshot);
 const body={kind:'registered-page-mutations-v1' as const,pageId:page.pageId,pageVersion:page.version,sourceSha256:pageSourceDigest(page.html),provenance:structuredClone(provenance),program:snapshot};
 const envelope:Envelope={...body,digest:digest(body)};
 const source=JSON.stringify(envelope),compiled=PREFIX+source,typeDefs=registeredMutationSchema(snapshot);
 buildSchema(typeDefs);
 const version=contentVersion(source,typeDefs,compiled);
 return {link:{kind:'backend' as const,name,backendId,version},backend:{name,source,compiled,typeDefs},envelope};
}
type BoundPage=Pick<HtmlPageVersion,'pageId'|'version'|'html'>;
/** Verifies the persisted immutable bytes, the link and the retained provenance of a registered mutation
 * program on this page, without its page-version binding. Null when the backend is not a registered mutation. */
function verifiedEnvelope(pageId:string,link:HtmlBackendLink,backend:HtmlBackendVersionRecord):Envelope|null {
 if(!backend.compiled.startsWith(PREFIX))return null;
 if(backend.backendId!==link.backendId||backend.version!==link.version||backend.pageId!==pageId||backend.name!==link.name||backend.secretBindings?.length)throw Error('mutation_registration_changed');
 let envelope:Envelope;try{envelope=JSON.parse(backend.source);}catch{throw Error('invalid_mutation_registration');}
 const {digest:claimed,...body}=envelope;
 if(envelope.kind!=='registered-page-mutations-v1'||claimed!==digest(body)||envelope.pageId!==pageId||![envelope.provenance?.compilerSha256,envelope.provenance?.sourceSha256].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||backend.compiled!==PREFIX+backend.source||backend.typeDefs!==registeredMutationSchema(envelope.program)||backend.version!==contentVersion(backend.source,backend.typeDefs,backend.compiled))throw Error('mutation_registration_changed');
 return envelope;
}
/** Verifies all persisted immutable bytes, actual page source, link and retained provenance. */
export function registeredMutationPlan(page:BoundPage&Pick<HtmlPageVersion,'links'>,link:HtmlBackendLink,backend:HtmlBackendVersionRecord):QueryPlan|null {
 if(!backend.compiled.startsWith(PREFIX))return null;
 if(!page.links.some(value=>value.kind==='backend'&&value.name===link.name&&value.backendId===link.backendId&&value.version===link.version))throw Error('mutation_registration_changed');
 const envelope=verifiedEnvelope(page.pageId,link,backend)!;
 if(envelope.pageVersion!==page.version||envelope.sourceSha256!==pageSourceDigest(page.html))throw Error('mutation_registration_changed');
 return {...structuredClone(envelope.program),registration:{pageId:page.pageId,pageVersion:page.version,sourceSha256:envelope.sourceSha256,backendId:link.backendId,backendVersion:link.version}};
}
/** Call INSIDE the page publication transaction AFTER writing its immutable version/link.
 * No reader can see the page until both page and program commit. No updates to saved versions. */
export async function commitRegisteredMutationBackend(tx:Queryable,page:BoundPage,ownerId:string,prepared:ReturnType<typeof prepareRegisteredMutationBackend>):Promise<void>{
 type Saved={source:string;meta:{htmlLinks?:HtmlBackendLink[]}};
 const head=(await tx.query<Saved&{user_id:string|null;version:number}>('SELECT user_id,version,source,meta FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[page.pageId])).rows[0];
 // An ordinary save archives the PREVIOUS version, so the version it just wrote is the locked head row.
 const saved=(await tx.query<Saved>('SELECT source,meta FROM artifact_versions WHERE artifact_id=$1 AND version=$2',[page.pageId,page.version])).rows[0]??(head?.version===page.version?head:undefined);
 if(!head||head.user_id!==ownerId||head.version!==page.version||!saved||saved.source!==page.html||!saved.meta.htmlLinks?.some(link=>link.kind==='backend'&&link.name===prepared.link.name&&link.backendId===prepared.link.backendId&&link.version===prepared.link.version))throw Error('mutation_registration_changed');
 const record={...prepared.backend,...prepared.link,pageId:page.pageId,ownerId,secretBindings:[]};registeredMutationPlan({...page,links:saved.meta.htmlLinks},prepared.link,record);
 await tx.query("SELECT pg_advisory_xact_lock(hashtext('registered-backend:' || $1))",[prepared.link.backendId]);
 const prior=(await tx.query<{page_id:string;owner_id:string}>('SELECT page_id,owner_id FROM html_backend_versions WHERE backend_id=$1 LIMIT 1',[prepared.link.backendId])).rows[0];
 if(prior&&(prior.page_id!==page.pageId||prior.owner_id!==ownerId))throw Error('mutation_registration_changed');
 await tx.query('INSERT INTO html_backend_versions(backend_id,version,page_id,name,source,type_defs,compiled,owner_id,secret_bindings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING',[prepared.link.backendId,prepared.link.version,page.pageId,prepared.link.name,prepared.backend.source,prepared.backend.typeDefs,prepared.backend.compiled,ownerId,'[]']);
}

/**
 * RE-BINDING ON SAVE, exactly as for registered queries (registered-page-queries/registry): a registered mutation
 * program is bound to one page version and its source digest, but it is compiled from the migration's ORIGINAL
 * source (`provenance.sourceSha256`), not from the page HTML, which only declares the namespace and calls it. So a
 * save (owner or editor, replace or revert) that still declares the name and supplies no backend source for it
 * carries the same program and provenance to the new version, under the same backend ID and the page owner.
 * When a carried program cannot be re-bound (its stored bytes fail verification, it is bound to another page or a
 * later version, the program no longer validates, or the page owner no longer owns it) this throws
 * `RegisteredMutationRebindError` BEFORE anything is written, and the save is refused with
 * `registered_mutations_rebind_failed`.
 */
export class RegisteredMutationRebindError extends Error {
 constructor(readonly namespace:string,readonly reason:string){super(`registered mutations '${namespace}' cannot be re-bound: ${reason}`);}
}
export interface RegisteredMutationRebind {ownerId:string;prepared:ReturnType<typeof prepareRegisteredMutationBackend>}
const backendRecord=async(tx:Queryable,link:HtmlBackendLink)=>(await tx.query<HtmlBackendVersionRecord>('SELECT backend_id AS "backendId",version,page_id AS "pageId",name,source,type_defs AS "typeDefs",compiled,owner_id AS "ownerId",secret_bindings AS "secretBindings" FROM html_backend_versions WHERE backend_id=$1 AND version=$2',[link.backendId,link.version])).rows[0];
/** Call under the page's write lock, BEFORE writing `next`. Returns the links to save
 * (registered mutation programs re-bound to `next`, every other link unchanged) and the programs to commit. */
export async function planRegisteredMutationRebinds(tx:Queryable,next:BoundPage,carried:readonly HtmlBackendLink[],pageOwnerId:string|null):Promise<{links:HtmlBackendLink[];rebinds:RegisteredMutationRebind[]}>{
 const links:HtmlBackendLink[]=[],rebinds:RegisteredMutationRebind[]=[];
 for(const link of carried){
  const backend=await backendRecord(tx,link);
  if(!backend?.compiled.startsWith(PREFIX)){links.push(link);continue;}
  let prepared:RegisteredMutationRebind['prepared'];
  try{
   const envelope=verifiedEnvelope(next.pageId,link,backend)!;
   if(envelope.pageVersion>=next.version)throw Error('mutation_registration_changed');
   if(backend.ownerId!==pageOwnerId)throw Error('mutation_registration_owner_changed');
   prepared=prepareRegisteredMutationBackend(link.name,link.backendId,next,envelope.program,envelope.provenance);
  }catch(error){throw new RegisteredMutationRebindError(link.name,error instanceof Error?error.message:'invalid_mutation_registration');}
  links.push(prepared.link);rebinds.push({ownerId:backend.ownerId,prepared});
 }
 return {links,rebinds};
}
/** Call INSIDE the same transaction AFTER writing `page` with the planned links. */
export async function commitRegisteredMutationRebinds(tx:Queryable,page:BoundPage,rebinds:readonly RegisteredMutationRebind[]):Promise<void>{
 for(const {ownerId,prepared} of rebinds)await commitRegisteredMutationBackend(tx,page,ownerId,prepared);
}
/**
 * One-off repair for a head saved before mutation re-binding existed: its registered mutation links still name a
 * program bound to an earlier version. Plans re-binding them to the CURRENT head in place through the same plan/commit
 * path; the caller (lib/artifacts registered-repair) writes the links. Null for an already valid or unregistered page.
 */
export async function planRegisteredMutationRepair(tx:Queryable,head:RepairableHead):Promise<RegisteredRepair|null>{
 const pageId=head.id,page={pageId,version:head.version,html:head.source},all=head.meta.htmlLinks??[],stale:HtmlBackendLink[]=[];
 for(const link of all){
  if(link.kind!=='backend')continue;
  const backend=await backendRecord(tx,link);if(!backend)continue;
  const envelope=verifiedEnvelope(pageId,link,backend);
  if(envelope&&envelope.pageVersion!==head.version)stale.push(link);
 }
 if(!stale.length)return null;
 const planned=await planRegisteredMutationRebinds(tx,page,stale,head.user_id);
 const links=all.map(link=>(link.kind==='backend'&&planned.links.find(next=>next.name===link.name))||link);
 return {links,async commit(){
  await commitRegisteredMutationRebinds(tx,page,planned.rebinds);
  for(const link of planned.links)registeredMutationPlan({...page,links:links.filter((value):value is HtmlBackendLink=>value.kind==='backend')},link,(await backendRecord(tx,link))!);
  return stale.map(link=>link.name);
 }};
}
