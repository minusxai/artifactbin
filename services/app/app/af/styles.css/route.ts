import { nativeHtmlSystemsResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlSystemsResponse(request);
export const HEAD=GET;
