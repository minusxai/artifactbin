import {parseMarkdownLite,type MdNode,type MdInline} from './markdown-lite';
import type {Queryable} from '@artifactbin/contracts';
import type { ArtifactRow } from '@/lib/artifacts';
import type { AccessActor } from '@/lib/accounts';
import {invitePeople} from '@/lib/artifacts';
import {isPersonMentionHref} from '../document';

/** The people a comment body mentions (`/people/<id>` links), in order. */
function mentionIds(body:string):string[]{
 const ids:string[]=[];
 const inline=(nodes:MdInline[])=>{for(const n of nodes){if(n.kind==='link'&&isPersonMentionHref(n.href))ids.push(n.href.slice('/people/'.length));else if(n.kind==='strong'||n.kind==='em')inline(n.children);}};
 const blocks=(nodes:MdNode[])=>{for(const n of nodes){if((n.kind==='paragraph'||n.kind==='heading'))inline(n.children);else if(n.kind==='list')n.items.forEach(i=>blocks(i.children));else if(n.kind==='quote')blocks(n.children);}};
 blocks(parseMarkdownLite(body));
 return ids;
}

/**
 * Invite (and so notify) the people a saved comment mentions. `previous` is the text an EDIT replaced:
 * only the people the edit newly names are invited, so rewriting a comment never repeats a mention.
 */
export async function commentMentions(tx:Queryable,row:ArtifactRow,actor:AccessActor,body:string,id:string,previous?:string){
 const before=new Set(previous===undefined?[]:mentionIds(previous));
 const ids=mentionIds(body).filter(person=>!before.has(person));
 if(ids.length){
  const root=(await tx.query<{id:string}>('SELECT coalesce(root_id,id) AS id FROM annotations WHERE id=$1',[id])).rows[0]?.id??id;
  await invitePeople(tx,row,actor,ids,`comment:${root}`);
 }
}
