import {json} from '@/lib/http';
/** Retired markup stylesheets have no success path. */
export async function GET(_request:Request,_ctx:{params:Promise<{id:string}>}){return json({error:'not_found'},404,{'Cache-Control':'no-store'});}
