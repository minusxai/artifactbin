import { pinnedHostResponse } from '@/lib/document-serving';
/** A retained document host module by digest (lib/document-serving/hosted-blocks.server): immutable, public. */
export const GET=async(request:Request,context:{params:Promise<{file:string}>})=>pinnedHostResponse(request,(await context.params).file);
export const HEAD=GET;
