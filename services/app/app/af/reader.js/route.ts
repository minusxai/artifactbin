import { nativeHtmlModuleResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'reader');
export const HEAD=GET;
