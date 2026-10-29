import { nativeHtmlModuleResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'chrome');
export const HEAD=GET;
