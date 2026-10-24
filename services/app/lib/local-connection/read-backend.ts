import {readAnnotationPages} from '@/lib/annotations/pages';
import type {ArtifactBackend} from '@/lib/artifact-backend/types';
/** Closed comment-reader port: no inherited account transport, authoring methods, or credentialed live stream. */
export function createLocalReadBackend(id:string):ArtifactBackend {
 const denied=():never=>{throw Error('Downloaded files are read-only. Open original to make changes.');};
 const refuse=async():Promise<never>=>denied();
 return {
  mode:'online',unavailable:()=> 'Downloaded files are read-only. Open original to make changes.',
  listAnnotations:(status,options={})=>readAnnotationPages(`/api/my/artifacts/${encodeURIComponent(id)}/annotations${status?`?status=${status}`:''}`,{...options,credentials:'omit'}),
  canEditLocalComment:()=>false,canDeleteLocalAnnotation:()=>false,
  createAnnotation:refuse,actOnAnnotation:refuse,editAnnotation:refuse,deleteAnnotation:refuse,uploadCommentImage:refuse,
  load:refuse,documentFrame:refuse,commitEdit:refuse,prepare:refuse,previewCss:refuse,previewQueries:refuse,queryTable:refuse,
  importImage:refuse,versions:refuse,version:refuse,revert:refuse,queryTransport:denied,members:async()=>null,
  // AnnotationLayer uses index reads; the document's existing trusted bridge owns viewer/presence events.
  live:()=>()=>{},liveFrame:refuse,publishPresence:refuse,
 };
}
