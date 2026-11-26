import type {Queryable} from '@artifactbin/contracts/db';
import type { ArtifactRow } from '@/lib/artifacts';
import type { AccessActor } from '@/lib/accounts';
import {invitePeople} from '@/lib/artifacts';
import { mentionIds } from './mention-ids';

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
