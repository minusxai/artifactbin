import { nativeHtmlModuleResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'portableEngine');
export const HEAD=GET;
