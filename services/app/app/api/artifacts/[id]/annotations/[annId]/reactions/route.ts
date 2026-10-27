import { withTokenAuth } from '@/lib/accounts';
import { readJson } from '@/lib/http';
import { respondToCommentReaction } from '@/lib/annotations';
/** PUT {kind:'thumbs_up',active:boolean}; retries set the same state rather than toggling it twice. */
export const PUT=withTokenAuth(async(request:Request,{actor,params})=>respondToCommentReaction(await readJson(request),actor,params.id,params.annId));
