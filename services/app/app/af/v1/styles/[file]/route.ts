import { pinnedStylesResponse } from '@/lib/document-serving';
/** A retained platform or design-system stylesheet by digest (lib/document-serving/hosted-blocks.server): immutable, public. */
export const GET=async(request:Request,context:{params:Promise<{file:string}>})=>pinnedStylesResponse(request,(await context.params).file);
export const HEAD=GET;
