import { hostedBlocksManifestResponse } from '@/lib/document-serving';
/** The pinned addresses a host page loads (lib/document-serving/hosted-blocks.server). Public. */
export const GET=(request:Request)=>hostedBlocksManifestResponse(request);
export const HEAD=GET;
