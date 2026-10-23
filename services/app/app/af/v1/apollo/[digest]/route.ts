import {nativeHtmlApolloResponse} from '@/lib/serving';
export const GET=async(request:Request,context:{params:Promise<{digest:string}>})=>nativeHtmlApolloResponse(request,(await context.params).digest);
export const HEAD=GET;
