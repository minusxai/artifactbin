import type {DocumentEdit} from '@artifactbin/contracts';
import {documentActor} from '@/lib/document/http';
import {json,readJson} from '@/lib/http';
import {getArtifactById,canReadArtifact} from '@/lib/artifacts';
import {requestOrSessionActor,roleFor} from '@/lib/viewer';
import {canEdit} from '@/lib/share-roles';
import {editDocument} from '@/lib/document/store';
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){
 const {id}=await ctx.params;const row=await getArtifactById(id);const actor=await requestOrSessionActor(request);
 if(!row?.document||!await canReadArtifact(row,actor.viewer))return json({error:'not_found'},404);
 return json({id:row.id,title:row.title,version:row.version,document:row.document,editable:canEdit(await roleFor(row,actor))},200,{'Cache-Control':'no-store'});
}
export async function PATCH(request:Request,ctx:{params:Promise<{id:string}>}){
 const actor=await documentActor(request);if(actor instanceof Response)return actor;
 const {id}=await ctx.params;
 const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);
 const result=await editDocument(actor,id,body as unknown as DocumentEdit);
 const status=result.updated||result.reason==='duplicate'?200:result.reason==='not_found'?404:result.reason==='invalid'?400:409;
 return json(result,status);
}
