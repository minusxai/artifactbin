import {inspectHostedOffer} from '@/lib/offline/hosted-connect.server';
import {json} from '@/lib/http';
import {readConnectBody} from '@/lib/offline/connect-body';
export async function POST(request:Request){
 const body=await readConnectBody(request);if(body instanceof Response)return body;
 try{return await inspectHostedOffer(request,body);}catch(error){return json({error:error instanceof Error?error.message:'Invalid artifact file.'},400);}
}
