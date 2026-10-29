import {fetchWebResource} from '@/lib/web-ingest';
import type {PageBackendFetchResult} from './backend';
/** Minimal outbound connector: public HTTPS GET, no caller headers or ambient credentials. */
export async function fetchPageBackendResource(url:string,signal?:AbortSignal):Promise<PageBackendFetchResult>{
 const resource=await fetchWebResource(url,{maxBytes:262144,timeoutMs:3000,policy:{allowHttp:false,allowPrivate:false},signal,accept:'application/json,text/plain;q=0.9,*/*;q=0.1',userAgent:'page-backend/1'});
 return {status:200,url:resource.finalUrl,contentType:resource.contentType,body:new TextDecoder('utf-8',{fatal:true}).decode(resource.bytes)};
}
