/** Viewer overlays belonged to the retired JSX compiler. Native clients use page GraphQL. */
import {json} from '@/lib/http';
export const GET=(_request?:Request,_context?:unknown)=>json({error:'not_found'},404);
