import {it,expect,vi} from 'vitest';
import {pageBackendCapability} from '../backend';
import {fetchPageBackendResource} from '../public-fetch';
import type {RunStart} from '@artifactbin/contracts';
const record={backendId:'backend1',pageId:'page1',version:'v1',source:'',compiled:'immutable',typeDefs:'type Query{x:Int}',ownerId:'owner1'};
const request:RunStart={requestId:'r',userId:'owner1',artifactId:'backend1',artifactVersion:'v1',program:{source:'immutable',language:'javascript'},input:{kind:'invoke',principal:{tenant:'page1',subject:null}}};
it('rejects metadata, private, credentialed and plain HTTP destinations even under dev settings',async()=>{
 for(const url of ['https://169.254.169.254/latest','https://127.0.0.1/','https://10.0.0.1/','https://[::1]/','https://user:secret@example.com/','http://example.com/'])await expect(fetchPageBackendResource(url,new AbortController().signal)).rejects.toThrow();
});
it('requires an immutable admitted backend before fetching and forwards only URL',async()=>{
 const fetcher=vi.fn(async()=>({status:200,url:'https://example.com/',contentType:'application/json',body:'{}'}));
 const store={get:async()=>({value:null,version:0}),set:async()=>({ok:true,version:1})};
 await expect(pageBackendCapability(store,{...request,userId:'forged'},'artifactbin.pageBackend.fetch',{url:'https://example.com/'},async()=>record,fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 expect(await pageBackendCapability(store,request,'artifactbin.pageBackend.fetch',{url:'https://example.com/',headers:{Authorization:'never-forward'}},async()=>record,fetcher)).toMatchObject({status:200});expect(fetcher).toHaveBeenCalledWith('https://example.com/');
});
