import {withTokenAuth} from '@/lib/auth';
import {runOperation} from '@/lib/operations/http';
/** Explicit rendering operation; this is not a side-effect-free content read. */
export const GET=withTokenAuth((request,{tokenId,userId,params})=>runOperation('export_artifact',request,{tokenId,userId},{...Object.fromEntries(new URL(request.url).searchParams),id:params.id}));
