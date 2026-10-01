import {authoringCapabilities} from '@/lib/story/document/authoring-capabilities';
/** Explicit discovery/update only; ordinary CLI commands use bundled names. */
export async function GET(_request:Request):Promise<Response>{
 return Response.json(authoringCapabilities,{headers:{'Cache-Control':'public, max-age=300'}});
}
