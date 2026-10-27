import {nativeHtmlModuleResponse} from '@/lib/serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'reader');
export const HEAD=GET;
