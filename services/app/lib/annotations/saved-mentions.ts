import {parseMarkdownLite,type MdNode,type MdInline} from './markdown-lite';
import type {Queryable} from '@artifactbin/contracts';
import type { ArtifactRow } from '@/lib/artifacts';
import type { RoleActor } from '@/lib/accounts';
import {invitePeople} from '@/lib/artifacts/membership/membership';
import {isPersonMentionHref} from '../document/person-mentions';
export async function commentMentions(tx:Queryable,row:ArtifactRow,actor:RoleActor,body:string,id:string){
 const ids:string[]=[];
 const inline=(nodes:MdInline[])=>{for(const n of nodes){if(n.kind==='link'&&isPersonMentionHref(n.href))ids.push(n.href.slice('/people/'.length));else if(n.kind==='strong'||n.kind==='em')inline(n.children);}};
 const blocks=(nodes:MdNode[])=>{for(const n of nodes){if((n.kind==='paragraph'||n.kind==='heading'))inline(n.children);else if(n.kind==='list')n.items.forEach(i=>blocks(i.children));else if(n.kind==='quote')blocks(n.children);}};
 blocks(parseMarkdownLite(body));
 if(ids.length){
  const root=(await tx.query<{id:string}>('SELECT coalesce(root_id,id) AS id FROM annotations WHERE id=$1',[id])).rows[0]?.id??id;
  await invitePeople(tx,row,actor,ids,`comment:${root}`);
 }
}
