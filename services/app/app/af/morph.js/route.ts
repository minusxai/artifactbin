import {nativeHtmlModuleResponse} from '@/lib/serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'morph');
export const HEAD=GET;
