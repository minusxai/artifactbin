import { pinnedRuntimeResponse } from '@/lib/document-serving';
/** This build's runtime module by its content address (lib/document-serving/hosted-blocks.server): immutable, public. */
export const GET=async(request:Request,context:{params:Promise<{digest:string;file:string}>})=>{const {digest,file}=await context.params;return pinnedRuntimeResponse(request,digest,file);};
export const HEAD=GET;
