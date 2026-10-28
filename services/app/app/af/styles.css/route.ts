import {nativeHtmlSystemsResponse} from '@/lib/serving';
export const GET=(request:Request)=>nativeHtmlSystemsResponse(request);
export const HEAD=GET;
