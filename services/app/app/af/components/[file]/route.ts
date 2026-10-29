import { componentModuleResponse } from '@/lib/document-serving';
/** A hosted HTML component module or shared chunk (lib/document-serving/components.server). */
export const GET=async(request:Request,context:{params:Promise<{file:string}>})=>componentModuleResponse(request,(await context.params).file);
export const HEAD=GET;
