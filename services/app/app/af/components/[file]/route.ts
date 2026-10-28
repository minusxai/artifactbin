import {componentModuleResponse} from '@/lib/serving/components.server';
/** A hosted HTML component module or shared chunk (lib/serving/components.server). */
export const GET=async(request:Request,context:{params:Promise<{file:string}>})=>componentModuleResponse(request,(await context.params).file);
export const HEAD=GET;
