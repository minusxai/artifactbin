import {nativeHtmlModuleResponse} from '@/lib/serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'apollo');
export const HEAD=GET;
