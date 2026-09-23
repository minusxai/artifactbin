import {timingSafeEqual} from 'node:crypto';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {INTERNAL_SERVICE_SECRET} from '@/lib/config';
import {getDb} from '@/lib/db';
import {membershipInbox} from '@/lib/membership-inbox';
import {json,readJson} from '@/lib/http';
export async function POST(request:Request){
 const supplied=Buffer.from(request.headers.get(SERVICE_AUTH_HEADER)??''),expected=Buffer.from(INTERNAL_SERVICE_SECRET??'');
 if(!expected.length||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json({error:'unauthorized'},401);
 const body=await readJson(request) as {recipientId?:unknown;notificationId?:unknown}|null;
 if(typeof body?.recipientId!=='string'||typeof body.notificationId!=='string')return json({error:'invalid_request'},400);
 const db=await getDb();
 const user=(await db.query<{email:string|null;kind:string}>('SELECT email,kind FROM users WHERE id=$1',[body.recipientId])).rows[0];
 if(!user?.email||user.kind!=='account')return json({notification:null});
 const inbox=await membershipInbox({userId:body.recipientId,tokenId:null},0,body.notificationId);
 return json({notification:inbox.notifications[0]?{...inbox.notifications[0],email:user.email}:null});
}
