import {authoringCapabilities} from '@/lib/document';
/** Explicit discovery/update only; ordinary CLI commands use bundled names. */
export async function GET(_request:Request):Promise<Response>{
 return Response.json(authoringCapabilities,{headers:{'Cache-Control':'public, max-age=300'}});
}
