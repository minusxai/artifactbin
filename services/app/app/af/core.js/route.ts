import { nativeHtmlCoreResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlCoreResponse(request);
export const HEAD=GET;
