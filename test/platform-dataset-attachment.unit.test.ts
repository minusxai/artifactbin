import test from "node:test";
import assert from "node:assert/strict";
import {createPlatformSession} from "../src/browser/platform-frame.ts";
const request={backendNamespace:"data",bindingName:"images",requestId:"request-0001",filename:"image.png",contentType:"image/png" as const,blob:new Blob(["abc"],{type:"image/png"})};
test("credential frame uploads binary only under its captured page and fresh authority",async()=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const session=createPlatformSession("https://service.example",{fileId:"fixture",share:"synthetic-private",sourceRevision:"1",sessionId:"viewer"},{emit(){},async fetch(url,init){calls.push({url,init});return url.endsWith("permissions")?Response.json({read:true,authorizationContext:"epoch"}):Response.json({ref:`dfile:${"a".repeat(32)}`,url:`/api/files/fixture/dataset-attachments/data/images/${"a".repeat(32)}`,name:"image.png",contentType:"image/png",size:3});}});
  const command={kind:"attachment" as const,id:"one",authorizationContext:"epoch",operation:"upload" as const,request};
  await assert.rejects(session.handle(command),/caller/);
  await session.handle({kind:"request",operation:{kind:"permissions"}});
  const value=await session.handle({...command,request:{...request,pageId:"other",url:"https://example.invalid"} as typeof request});
  assert.equal(calls[1]?.url,"https://service.example/api/files/fixture/dataset-attachments/data/images");
  assert.equal(calls[1]?.init.body,request.blob);
  assert.equal((calls[1]?.init.headers as Record<string,string>).Authorization,"Bearer synthetic-private");
  assert.equal(JSON.stringify(value).includes("synthetic-private"),false);
  await session.handle({kind:"disconnect"});await assert.rejects(session.handle({...command,id:"two"}),/caller/);session.dispose();
});
test("permission refresh aborts an in-flight binary upload and refuses a delayed receipt",async()=>{
  let finish!:(r:Response)=>void,observed:AbortSignal|null|undefined;
  const session=createPlatformSession("https://service.example",{fileId:"fixture",share:"synthetic-private",sourceRevision:"1",sessionId:"viewer"},{emit(){},async fetch(url,init){if(url.endsWith("permissions"))return Response.json({read:true,authorizationContext:"epoch"});observed=init.signal;return new Promise(r=>{finish=r;});}});
  await session.handle({kind:"request",operation:{kind:"permissions"}});
  const pending=session.handle({kind:"attachment",id:"one",authorizationContext:"epoch",operation:"upload",request}),rejected=assert.rejects(pending);
  await session.handle({kind:"request",operation:{kind:"permissions"}});assert.equal(observed?.aborted,true);
  finish(Response.json({ref:`dfile:${"a".repeat(32)}`,url:`/api/files/fixture/dataset-attachments/data/images/${"a".repeat(32)}`,name:"image.png",contentType:"image/png",size:3}));
  await rejected;session.dispose();
});
