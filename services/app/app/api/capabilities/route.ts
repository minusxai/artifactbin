import {authoringCapabilities} from '@/lib/document';
/** Public native HTML, GraphQL, dataset and author-skill discovery. */
export async function GET(_request:Request):Promise<Response>{
 return Response.json(authoringCapabilities,{headers:{'Cache-Control':'public, max-age=300'}});
}
