import {nativeHtmlReaderResponse} from '@/lib/serving';
export const GET=async(request:Request,context:{params:Promise<{digest:string}>})=>nativeHtmlReaderResponse(request,(await context.params).digest);
export const HEAD=GET;
