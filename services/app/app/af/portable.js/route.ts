import {nativeHtmlModuleResponse} from '@/lib/serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'portableEngine');
export const HEAD=GET;
