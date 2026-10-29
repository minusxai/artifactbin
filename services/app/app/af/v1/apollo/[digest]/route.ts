import { nativeHtmlApolloResponse } from '@/lib/document-serving';
export const GET=async(request:Request,context:{params:Promise<{digest:string}>})=>nativeHtmlApolloResponse(request,(await context.params).digest);
export const HEAD=GET;
