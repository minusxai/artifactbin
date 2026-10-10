import type {Queryable} from '@artifactbin/contracts';
import type { RoleActor } from '@/lib/accounts';
import type { ArtifactRow } from '../table';
import {invitePeople} from './membership';
import {isPersonMentionHref, nodeIndex} from '@/lib/document';
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
