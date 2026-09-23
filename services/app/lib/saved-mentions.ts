import {parseMarkdownLite,type MdNode,type MdInline} from './markdown-lite';
import type {Queryable} from '@artifactbin/contracts';
import type {ArtifactRow,RoleActor} from './artifacts';
import {invitePeople} from './membership';
import {isPersonMentionHref} from './person-mentions';
import {nodeIndex} from './story/node-ids';
export async function commentMentions(tx:Queryable,row:ArtifactRow,actor:RoleActor,body:string,id:string){
 const ids:string[]=[];
 const inline=(nodes:MdInline[])=>{for(const n of nodes){if(n.kind==='link'&&isPersonMentionHref(n.href))ids.push(n.href.slice('/people/'.length));else if(n.kind==='strong'||n.kind==='em')inline(n.children);}};
 const blocks=(nodes:MdNode[])=>{for(const n of nodes){if(n.kind==='paragraph')inline(n.children);else if(n.kind==='list')n.items.forEach(i=>blocks(i.children));else if(n.kind==='quote')blocks(n.children);}};
 blocks(parseMarkdownLite(body));
 if(ids.length){
  const root=(await tx.query<{id:string}>('SELECT coalesce(root_id,id) AS id FROM annotations WHERE id=$1',[id])).rows[0]?.id??id;
  await invitePeople(tx,row,actor,ids,`comment:${root}`);
 }
}
/** Static authored links only; query results, User chips, imports and forks never notify. */
export async function documentMentions(tx:Queryable,row:ArtifactRow,actor:RoleActor,previous=''){
 if(row.format!=='markup'||!row.source?.includes('/people/'))return;
 const prior=nodeIndex(previous);
 const targetIds=[...nodeIndex(row.source).values()].flatMap(({node})=>{const href=node.attributes.find(a=>a.name==='href')?.value;return node.tag==='a'&&href?.static&&typeof href.json==='string'&&isPersonMentionHref(href.json)?[href.json.slice('/people/'.length)]:[];});
 if(targetIds.length)await tx.query('SELECT id FROM users WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[...new Set([actor.userId,...targetIds])]]);
 for(const [id,entry] of nodeIndex(row.source)){
  const node=entry.node;if(node.tag!=='a')continue;
  const href=node.attributes.find(a=>a.name==='href')?.value;
  if(!href?.static||typeof href.json!=='string'||!isPersonMentionHref(href.json))continue;
  const old=prior.get(id)?.node.attributes.find(a=>a.name==='href')?.value;
  if(old?.static&&old.json===href.json)continue;
  await invitePeople(tx,row,actor,[href.json.slice('/people/'.length)],`node:${id}`);
 }
}
