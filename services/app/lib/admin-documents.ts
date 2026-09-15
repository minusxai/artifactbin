/**
 * Explicit source inspection/repair, separate from reader and dataset permissions.
 * Only the proxy's verified identity authorizes this surface. Compiling resolves
 * references within the document owner's existing access, never global admin access.
 */
import {randomUUID} from 'node:crypto';
import {actorOf} from '@artifactbin/utils';
import {ADMIN_DOCUMENT_HEADER, BROWSER_SESSION_HEADER, ARTIFACT_ID_PATTERN, type Actor} from '@artifactbin/contracts';
import {adminEmails} from './config';
import {getDb, type Queryable} from './db';
import {baseUrl, json, readJson} from './http';
import {commitNormalizedMarkup, publishMarkupForArtifact, type ArtifactRow} from './artifacts';

type Administrator = Actor & {userId:string; email:string};
const reply = (value:unknown, status=200) => json(value,status,{'Cache-Control':'no-store'});

/** Eligibility is checked afresh, not inferred from an app profile or a bearer’s user ID. */
export function documentAdministrator(request:Request): Administrator | null {
  if(request.headers.has(BROWSER_SESSION_HEADER))return null;
  const actor=actorOf(request);
  if(!actor?.userId || !actor.email || actor.emailVerified!==true || actor.credential!=='session')return null;
  return adminEmails().has(actor.email.trim().toLowerCase()) ? actor as Administrator : null;
}

async function audit(tx:Queryable, actor:Administrator, action:'list'|'read'|'repair', row?:ArtifactRow, reason?:string, afterVersion?:number) {
  await tx.query(`INSERT INTO admin_document_audit(id,actor_user_id,actor_token_id,action,artifact_id,reason,before_version,after_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),actor.userId,actor.tokenId??null,action,row?.id??null,reason??null,row?.version??null,afterVersion??null]);
}
const wire=(row:ArtifactRow)=>({id:row.id,title:row.title,source:row.source,version:row.version,edit_id:row.edit_id});

export async function adminDocuments(request:Request,id?:string):Promise<Response> {
  const actor=documentAdministrator(request);
  if(!actor || request.headers.get(ADMIN_DOCUMENT_HEADER)!=='1')return reply({error:'not_found'},404);
  // Cookie authority requires an explicitly same-origin browser fetch, including reads.
  if(actor.credential==='session'){
    const origin=request.headers.get('origin');
    if((origin && origin!==baseUrl(request)) || request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'cross_site_request'},403);
  }
  if(id && !ARTIFACT_ID_PATTERN.test(id))return reply({error:'not_found'},404);
  const db=await getDb();
  if(!id){
    const url=new URL(request.url),query=url.searchParams.get('q')??'',after=url.searchParams.get('after')??'';
    if(request.method!=='GET'||query.length>200||after && !ARTIFACT_ID_PATTERN.test(after))return reply({error:'invalid_admin_request'},400);
    const rows=await db.transaction(async tx=>{
      const found=await tx.query<ArtifactRow>(`SELECT id,title,version,updated_at FROM artifacts
        WHERE deleted_at IS NULL AND format='markup' AND id>$1
        AND ($2='' OR strpos(lower(coalesce(title,'') || ' ' || coalesce(source,'')),lower($2))>0)
        ORDER BY id LIMIT 51`,[after,query]);
      await audit(tx,actor,'list');return found.rows;
    });
    return reply({documents:rows.slice(0,50),next:rows.length>50?rows[49]!.id:null});
  }
  const current=(await db.query<ArtifactRow>("SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL AND format='markup'",[id])).rows[0];
  if(!current)return reply({error:'not_found'},404);
  if(request.method==='GET'){
    await audit(db,actor,'read',current);return reply(wire(current));
  }
  if(request.method!=='PUT')return reply({error:'method_not_allowed'},405);
  const body=await readJson(request);
  if(!body || Object.keys(body).some(key=>!['source','edit_id','reason'].includes(key)) || typeof body.source!=='string' || Buffer.byteLength(body.source)>2_000_000 || typeof body.edit_id!=='string' || typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>500)return reply({error:'invalid_admin_repair'},400);
  if(body.edit_id!==current.edit_id)return reply({error:'version_conflict'},409);
  const prepared=await publishMarkupForArtifact(current,body.source);
  if(prepared instanceof Response){prepared.headers.set('Cache-Control','no-store');return prepared;}
  return db.transaction(async tx=>{
    if(!documentAdministrator(request))return reply({error:'not_found'},404);
    const locked=(await tx.query<ArtifactRow>("SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL AND format='markup' FOR UPDATE",[id])).rows[0];
    if(!locked || locked.edit_id!==current.edit_id)return reply({error:'version_conflict'},409);
    const updated=await commitNormalizedMarkup(tx,{userId:actor.userId,tokenId:actor.tokenId??''},locked,prepared);
    await audit(tx,actor,'repair',locked,body.reason as string,updated.version);
    return reply(wire(updated));
  });
}
