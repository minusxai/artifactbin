import type {HtmlPageLink,HtmlPageVersion} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import {readableArtifact} from '@/lib/artifacts';
import { getDb } from '../platform';
import type {HtmlIdentityLedger} from '../html-page';
/** Original artifact ACL and immutable artifact_versions remain the read authority. */
export async function readHtmlPage(actor:AccessActor,pageId:string,revision?:string):Promise<HtmlPageVersion>{
 const access=await readableArtifact(actor,pageId);
 if(!access||access.row.format!=='html')throw new Error('Page not found');
 const head=access.row;
 let row:{source:string|null;version:number;meta:Record<string,unknown>;format:string}=head;
 if(revision!==undefined&&revision!==String(head.version)){
  if(!/^[1-9]\d*$/.test(revision)||!Number.isSafeInteger(Number(revision)))throw new Error('Page revision not found');
  const archived=(await (await getDb()).query<typeof row>(`SELECT v.source,v.version,v.meta,v.format FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id AND a.deleted_at IS NULL WHERE v.artifact_id=$1 AND v.version=$2`,[pageId,Number(revision)])).rows[0];
  if(!archived||archived.format!=='html')throw new Error('Page revision not found');row=archived;
 }
 return {pageId,version:row.version,revision:String(row.version),html:row.source??'',nextNodeId:(row.meta.htmlIdentity as HtmlIdentityLedger|undefined)?.nextNodeId??1,links:(row.meta.htmlLinks??[]) as HtmlPageLink[]};
}

export {planHtmlClone} from './clone';
