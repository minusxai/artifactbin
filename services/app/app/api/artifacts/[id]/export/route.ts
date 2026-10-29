import { withTokenAuth } from '@/lib/authentication';
import {runOperation} from '@/lib/operations/http';
/** Explicit rendering operation; this is not a side-effect-free content read. */
export const GET=withTokenAuth((request,{ actor,params })=>runOperation('export_artifact',request,actor,{...Object.fromEntries(new URL(request.url).searchParams),id:params.id}));
