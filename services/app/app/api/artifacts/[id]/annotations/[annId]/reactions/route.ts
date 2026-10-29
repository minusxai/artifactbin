import { ownerUsername } from '@/lib/accounts';
import { withTokenAuth } from '@/lib/authentication';
import { readJson } from '@/lib/http';
import { annotationAuthorForRequest, respondToCommentReaction } from '@/lib/annotations';
/** PUT {kind:'thumbs_up',active:boolean}; retries set the same state rather than toggling it twice. Attributed as the reply door attributes. */
export const PUT=withTokenAuth(async(request:Request,{actor,params,clientHarness})=>respondToCommentReaction(await readJson(request),actor,params.id,params.annId,
 actor.credential!=='bearer'?{kind:'human',label:await ownerUsername(actor.userId)}:annotationAuthorForRequest(request,clientHarness)));
