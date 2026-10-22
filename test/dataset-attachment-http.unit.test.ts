import test from "node:test";
import assert from "node:assert/strict";
import { createAttachmentHTTP } from "../src/browser/dataset-attachment-http.ts";
test("binary HTTP fixes its captured page path and sends raw body with credential headers only there", async () => {
  let body: unknown, url = "", init: RequestInit | undefined;
  const blob = new Blob(["abc"], {type:"image/png"}), ref = `dfile:${"a".repeat(32)}`;
  const port = createAttachmentHTTP({origin:"https://platform.invalid",pageId:()=>"fixture",authority:()=>"epoch",headers:()=>({Authorization:"Bearer fixture"}),async fetch(u,i){url=u;init=i;body=i.body;return Response.json({ref,url:`/api/files/fixture/dataset-attachments/data/images/${ref.slice(6)}`,name:"image.png",contentType:"image/png",size:3});}});
  const result = await port.upload({backendNamespace:"data",bindingName:"images",requestId:"request-0001",filename:"image.png",contentType:"image/png",blob});
  assert.equal(body,blob);assert.equal(url,"https://platform.invalid/api/files/fixture/dataset-attachments/data/images");
  assert.equal(init?.redirect,"error");assert.equal(init?.credentials,"omit");assert.equal(result.ref,ref);
});
test("binary HTTP rejects changed authority and oversized streamed reads", async () => {
  let context: string|null="epoch";
  const port=createAttachmentHTTP({origin:"https://platform.invalid",pageId:()=>"fixture",authority:()=>context,headers:()=>({}),async fetch(){context=null;return Response.json({canAttempt:true});}});
  await assert.rejects(port.availability({backendNamespace:"data",bindingName:"images"}),/caller/i);
  context="epoch";
  const read=createAttachmentHTTP({origin:"https://platform.invalid",pageId:()=>"fixture",authority:()=>context,headers:()=>({}),async fetch(){return new Response(new Blob([new Uint8Array(50_000_001)]),{headers:{"Content-Type":"image/png"}});}});
  await assert.rejects(read.read({backendNamespace:"data",bindingName:"images",ref:`dfile:${"a".repeat(32)}`}),/large/i);
});
