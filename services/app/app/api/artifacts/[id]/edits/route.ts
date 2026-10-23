/** The client-compiled JSX authoring surface is retired. Native HTML saves use the artifact API. */
import {json} from '@/lib/http';
export const POST=(_request?:Request,_context?:unknown)=>json({error:'not_found'},404);
