/** Canonical post-read page access, edit, revision and link fence shared by the SQL door and the revision schema. */
import type {AccessActor} from '@/lib/accounts';
import {getArtifactHeaderById,readableArtifactHeader,accessMoved} from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {requestOrSessionActor} from '@/lib/authentication';
type ArtifactHeader=NonNullable<Awaited<ReturnType<typeof getArtifactHeaderById>>>;
/**
 * After a read: the reader is still who they were, may still read the page, and its head (access, edit, version,
 * links) did not move since `admitted`; otherwise the answer is withheld (`page_unavailable`).
 */
export function pageVerifier(request:Request,pageId:string,actor:AccessActor,reader:AccessActor|undefined,admitted:ArtifactHeader){
 return async(revision:string)=>{
  const currentActor:AccessActor=reader??await requestOrSessionActor(request,{revalidate:true});
  if(JSON.stringify(currentActor)!==JSON.stringify(actor))throw Error('page_unavailable');
  // One header read decides both: the head did not move, and this reader may still read it.
  const readable=await readableArtifactHeader(currentActor,pageId),current=readable?.row;
  if(!current||current.format!=='html'||accessMoved(admitted,current)||current.edit_id!==admitted.edit_id||current.version!==admitted.version||JSON.stringify(current.meta.htmlLinks)!==JSON.stringify(admitted.meta.htmlLinks))throw Error('page_unavailable');
  // An archived revision is immutable; its own row is checked only when it is not the head just read.
  if(revision!==String(current.version))await readHtmlPage(currentActor,pageId,revision);
 };
}
