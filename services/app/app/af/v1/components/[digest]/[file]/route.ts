import { pinnedComponentResponse } from '@/lib/document-serving';
/** One file of a retained component bundle (lib/document-serving/hosted-blocks.server): immutable, public. */
export const GET=async(request:Request,context:{params:Promise<{digest:string;file:string}>})=>{const {digest,file}=await context.params;return pinnedComponentResponse(request,digest,file);};
export const HEAD=GET;
