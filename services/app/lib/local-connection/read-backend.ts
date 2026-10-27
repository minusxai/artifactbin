import {createReaderHttpBackend} from '@/lib/artifact-backend/reader-http';
import type {ArtifactBackend} from '@/lib/artifact-backend/types';
/** Closed comment-reader port: anonymous read/live/presence transport only; no account or authoring methods. */
export function createLocalReadBackend(id:string):ArtifactBackend {
 const denied=():never=>{throw Error('Downloaded files are read-only. Open original to make changes.');};
 const refuse=async():Promise<never>=>denied();
 return {
  ...createReaderHttpBackend(id,{anonymous:true}),
  mode:'online',unavailable:feature=>feature==='live'?null:'Downloaded files are read-only. Open original to make changes.',
  canEditLocalComment:()=>false,canDeleteLocalAnnotation:()=>false,
  setCommentReaction:refuse,createAnnotation:refuse,actOnAnnotation:refuse,editAnnotation:refuse,deleteAnnotation:refuse,uploadCommentImage:refuse,
  documentFrame:refuse,commitEdit:refuse,prepare:refuse,previewCss:refuse,previewQueries:refuse,queryTable:refuse,
  importImage:refuse,versions:refuse,version:refuse,revert:refuse,queryTransport:denied,members:async()=>null,
 };
}
