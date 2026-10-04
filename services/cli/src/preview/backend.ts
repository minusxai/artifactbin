/** Browser adapter: production components speak ArtifactBackend; only this module knows local routes. */
import type {ArtifactBackend,BackendFeature,EditAnswer} from '../../../app/lib/artifact-backend/types';
import {BackendRequestError} from '../../../app/lib/artifact-backend/errors';
import type {PreviewDocument} from './types';

export function createPreviewBackend(file:string,onSaved:(document:PreviewDocument)=>void):ArtifactBackend {
 const request=async(path:string,body:object,signal?:AbortSignal)=>{
  const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file,...body}),signal});
  const value=await response.json();if(!response.ok)throw new BackendRequestError(value.error??'Local preview request failed',response.status);return value;
 };
 const editor=(operation:string,args:object={},signal?:AbortSignal)=>request('/editor',{operation,...args},signal);
 const refresh=async()=>{const response=await fetch('/document?file='+encodeURIComponent(file));if(!response.ok)throw new BackendRequestError('Could not reload saved file',response.status);onSaved(await response.json());};
 const reasons:Partial<Record<BackendFeature,string>>={webAssets:'Add files with afbin, then restart preview.',mentions:'Mentions are unavailable in local preview.',commentImages:'Comment screenshots are unavailable in local preview.',remoteSessions:'Agent sessions are unavailable in local preview.',live:'Local files refresh from disk.'};
 const unavailable=(feature:BackendFeature)=>reasons[feature]??null;
 const refuse=(feature:BackendFeature):never=>{throw new BackendRequestError(unavailable(feature)??'Unavailable in local preview',503);};
 return {
  mode:'offline',unavailable,
  load:()=>editor('load'),
  commitEdit:async input=>{
   try{const result:EditAnswer=await editor('commit',input);if(result.ok)await refresh();return result;}
   catch(error){if(error instanceof BackendRequestError)return {ok:false,status:error.status,body:{error:error.message,edit_id:input.edit_id,markup:null,version:0,details:[{message:error.message}]}};throw error;}
  },
  prepare:markup=>editor('prepare',{markup}),previewCss:markup=>editor('css',{markup}),previewQueries:markup=>editor('queries',{markup}),
  queryTable:async()=>{throw new BackendRequestError('Open the local dataset file to inspect its rows.',503);},
  importImage:async()=>({ok:false,error:unavailable('webAssets')!}),versions:()=>editor('versions'),version:n=>editor('version',{version:n}),revert:async input=>{const result:EditAnswer=await editor('revert',input);if(result.ok)await refresh();return result;},
  live:()=>()=>{},liveFrame:async()=>null,
  queryTransport:()=>({run:(values,only)=>request('/query',{values,only}),page:async(values,name,page)=>(await request('/query',{values,only:[name],page:{name,...page}})).tables[name],dispose:()=>{}}),
  listAnnotations:(status,options)=>editor('annotations.list',{status},options?.signal),
  createAnnotation:(input,key)=>editor('annotations.create',{input,key}),
  actOnAnnotation:(id,input)=>editor('annotations.act',{id,input}),deleteAnnotation:id=>editor('annotations.delete',{id}),
  uploadCommentImage:async()=>refuse('commentImages'),members:async query=>query===undefined?{mentions:{}}:{people:[]},remoteSessions:async()=>({sessions:[]}),deleteRemoteSession:async()=>refuse('remoteSessions'),
 };
}
