import {nativeHtmlModuleResponse} from '@/lib/serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'chrome');
export const HEAD=GET;
