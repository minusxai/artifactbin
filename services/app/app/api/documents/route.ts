import type {RichDocument} from '@artifactbin/contracts';
import {documentActor} from '@/lib/document/http';
import {json,readJson} from '@/lib/http';
import {createDocument} from '@/lib/document/store';
import {DocumentError} from '@/lib/document/model';
export async function POST(request:Request){
 const actor=await documentActor(request,true);if(actor instanceof Response)return actor;
 const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);
 try{return json(await createDocument(actor,String(body.title??'Untitled document'),body.document as RichDocument),201);}
 catch(error){if(error instanceof DocumentError)return json({error:'invalid_document',detail:error.message},400);throw error;}
}
