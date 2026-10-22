import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {build} from "esbuild";
import {chromium} from "playwright";
test("binary attachment bytes round-trip through a separate credential frame without JSON encoding",async(t)=>{
  const frame=await build({entryPoints:["src/browser/platform-frame.ts"],bundle:true,write:false,format:"iife",platform:"browser"});
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]),ref=`dfile:${"a".repeat(32)}`;
  let received=Buffer.alloc(0),authorization="",wrongPath=false;
  const service=createServer(async(req,res)=>{
    if(req.url==="/platform-frame"){res.setHeader("Content-Type","text/html");res.end('<script src="/frame.js"></script>');return;}
    if(req.url==="/frame.js"){res.setHeader("Content-Type","text/javascript");res.end(frame.outputFiles[0]!.text);return;}
    res.setHeader("Content-Type","application/json");
    if(req.url?.endsWith("/permissions")){res.end(JSON.stringify({read:true,authorizationContext:"epoch"}));return;}
    const path="/api/files/fixture/dataset-attachments/data/images";
    if(req.url===path&&req.method==="GET"){res.end('{"canAttempt":true}');return;}
    if(req.url===path&&req.method==="POST"){
      authorization=String(req.headers.authorization);const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));received=Buffer.concat(chunks);
      res.end(JSON.stringify({ref,url:path+"/"+ref.slice(6),name:"image.png",contentType:"image/png",size:bytes.length}));return;
    }
    if(req.url===path+"/"+ref.slice(6)){res.setHeader("Content-Type","image/png");res.end(bytes);return;}
    wrongPath=true;res.statusCode=404;res.end('{}');
  });
  t.after(()=>new Promise<void>(r=>service.close(()=>r())));
  await new Promise<void>(r=>service.listen(0,"127.0.0.1",r));const serviceOrigin=`http://127.0.0.1:${(service.address() as import("node:net").AddressInfo).port}`;
  const appBundle=await build({stdin:{contents:`import {createPlatformClient} from './src/browser/platform-client.ts';window.run=async()=>{const client=createPlatformClient({origin:${JSON.stringify(serviceOrigin)},fileId:'fixture',share:'fixture-page-grant',sourceRevision:'1',sessionId:'viewer'});try{await client.ready;await client.request({kind:'permissions'});const port=client.attachments('epoch');const allowed=await port.availability({backendNamespace:'data',bindingName:'images'});const receipt=await port.upload({backendNamespace:'data',bindingName:'images',requestId:'request-0001',filename:'image.png',contentType:'image/png',blob:new Blob([new Uint8Array(${JSON.stringify([...bytes])})],{type:'image/png'})});const image=await port.read({backendNamespace:'data',bindingName:'images',ref:receipt.ref});return {allowed,receipt,bytes:[...new Uint8Array(await image.arrayBuffer())]};}finally{client.dispose();}};`,resolveDir:process.cwd()},bundle:true,write:false,format:"iife",platform:"browser"});
  const app=createServer((_req,res)=>{res.setHeader("Content-Type","text/html");res.end('<!doctype html><script>'+appBundle.outputFiles[0]!.text+'</script>');});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await new Promise<void>(r=>app.listen(0,"127.0.0.1",r));const appOrigin=`http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
    browser=await chromium.launch();const page=await browser.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(appOrigin);const result=await page.evaluate(()=> (window as unknown as {run():Promise<any>}).run());
    assert.deepEqual(result.bytes,[...bytes]);assert.deepEqual(result.allowed,{canAttempt:true});assert.deepEqual(received,bytes);assert.equal(authorization,"Bearer fixture-page-grant");assert.equal(wrongPath,false);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await Promise.all([new Promise<void>(r=>app.close(()=>r())),new Promise<void>(r=>service.close(()=>r()))]);}
});
