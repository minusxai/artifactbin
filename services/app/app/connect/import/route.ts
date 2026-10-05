import {applyHostedOffer} from '@/lib/offline/hosted-connect.server';
import {json} from '@/lib/http';
import {readConnectBody} from '@/lib/offline/connect-body';
export async function POST(request:Request){
 const body=await readConnectBody(request);if(body instanceof Response)return body;
 try{return await applyHostedOffer(request,body);}catch(error){return json({error:error instanceof Error?error.message:'Could not apply this file. Your offered file remains available.'},409);}
}
