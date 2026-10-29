import type {Queryable,Row} from '@artifactbin/contracts';
import { JOIN_RELATIONS } from '@/lib/social';
/** Same accepted-member projection/order as source dataflow; the extra row detects bounded-input overflow. */
export async function readRegisteredQueryMembers(db:Queryable,pageId:string,limit:number):Promise<Row[]>{
 return (await db.query<Row>(`SELECT user_id,joined_at::text FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND status='accepted' ORDER BY joined_at,user_id LIMIT $2`,[pageId,limit])).rows;
}
