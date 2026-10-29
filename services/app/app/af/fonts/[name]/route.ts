import {platformFontResponse} from '@/lib/html-systems/server';
export const GET=async(request:Request,context:{params:Promise<{name:string}>})=>platformFontResponse(request,(await context.params).name);
export const HEAD=GET;
