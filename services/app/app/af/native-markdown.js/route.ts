import { nativeHtmlModuleResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'nativeMarkdown');
export const HEAD=GET;
