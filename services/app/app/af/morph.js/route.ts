import { nativeHtmlModuleResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'morph');
export const HEAD=GET;
