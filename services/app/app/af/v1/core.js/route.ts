import {nativeHtmlCoreResponse} from '@/lib/serving';
export const GET=(request:Request)=>nativeHtmlCoreResponse(request);
export const HEAD=(request:Request)=>nativeHtmlCoreResponse(request);
