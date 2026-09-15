import {describe,it,expect} from 'vitest';
import {withHttpServer} from '@artifactbin/test-support/net';
import {uploadGateway} from '../src/upload-gateway';
import {uploadImage} from '../src/upload';

describe('scoped export upload transport',()=>{
 it('PUTs only the allocated object and preserves its signed query',async()=>{
  const requests:{method:string|undefined;url:string|undefined;type:string|undefined;bytes:number}[]=[];
  const server=await withHttpServer(async(req,res)=>{let bytes=0;for await(const c of req)bytes+=c.length;requests.push({method:req.method,url:req.url,type:req.headers['content-type'],bytes});res.writeHead(200);res.end();});
  try{
   await uploadImage({url:`${server.base}/exports/objects/abc.png?signature=scoped`,contentType:'image/png'},new Uint8Array([1,2,3]),{origin:server.base,prefix:'/exports/objects/'});
   expect(requests).toEqual([{method:'PUT',url:'/exports/objects/abc.png?signature=scoped',type:'image/png',bytes:3}]);
  }finally{await server.close();}
 });
 it('refuses an unrelated destination, prefix escape, or redirect',async()=>{
  let hits=0;
  const server=await withHttpServer((_q,res)=>{hits++;res.writeHead(302,{location:'/elsewhere'});res.end();});
  const options={origin:server.base,prefix:'/exports/objects/'};
  try{
   for(const url of ['https://elsewhere.example/exports/objects/a',`${server.base}/private/key`,`${server.base}/exports/objects/../secret`])
    await expect(uploadImage({url,contentType:'image/png'},new Uint8Array([1]),options)).rejects.toThrow();
   expect(hits).toBe(0);
   await expect(uploadImage({url:`${server.base}/exports/objects/a`,contentType:'image/png'},new Uint8Array([1]),options)).rejects.toThrow();
   expect(hits).toBe(1);
  }finally{await server.close();}
 });
 it('streams through the configured gateway with the original destination bound',async()=>{
  let seen='';
  const gateway=await withHttpServer(async(req,res)=>{seen=`${req.headers['x-upload-origin']} ${req.url}`;for await(const _ of req){}res.end();});
  try{
   await uploadImage({url:'https://bucket.s3.test/exports/objects/a?signature=x',contentType:'image/png'},new Uint8Array([1]),{origin:'https://bucket.s3.test',prefix:'/exports/objects/',proxyUrl:gateway.base});
   expect(seen).toBe('https://bucket.s3.test /exports/objects/a?signature=x');
  }finally{await gateway.close();}
 });
});

describe('upload gateway',()=>{
 it('streams PUTs only to its fixed destination and rejects reads, foreign origins and prefix escapes',async()=>{
  let hits=0,body='';
  const sink=await withHttpServer(async(req,res)=>{hits++;for await(const part of req)body+=part;res.end();});
  const gateway=await withHttpServer(uploadGateway({origin:sink.base,prefix:'/exports/objects/'}));
  try{
   await uploadImage({url:`${sink.base}/exports/objects/one?signature=scoped`,contentType:'image/png'},new TextEncoder().encode('pixels'),{origin:sink.base,prefix:'/exports/objects/',proxyUrl:gateway.base});
   expect(body).toBe('pixels');expect(hits).toBe(1);
   for(const [method,path,origin] of [['GET','/exports/objects/a',sink.base],['PUT','/private/a',sink.base],['PUT','/exports/objects/a','https://elsewhere.example']]){
    const r=await fetch(gateway.base+path,{method,headers:{'x-upload-origin':origin!,'content-type':'image/png'},...(method==='PUT'?{body:'bad'}:{})});
    expect(r.status).toBe(403);
   }
   expect(hits).toBe(1);
  }finally{await gateway.close();await sink.close();}
 });
});
