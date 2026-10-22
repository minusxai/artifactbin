import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readVerifiedSupplementalAssets, profileAssetId } from "../src/migration/assets/supplemental.ts";
const bytes = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const sha = createHash("sha256").update(bytes).digest("hex");
async function fixture(run: (root:string, manifest:string) => Promise<void>) {
 const root=await mkdtemp(join(tmpdir(),"supplemental-proof-"));
 try {await writeFile(join(root,sha),bytes);const manifest=join(root,"receipts.json");await writeFile(manifest,JSON.stringify([{objectKey:`avatar/synthetic/${sha.slice(0,32)}`,status:"copied",sha256:sha,bytes:bytes.length,path:"/untrusted/ignored",width:999,height:999}]));await run(root,manifest);}finally{await rm(root,{recursive:true,force:true});}
}
test("private verifier rehashes actual flat bytes and derives dimensions rather than trusting receipt claims",()=>fixture(async(root,manifest)=>{
 const rows=await readVerifiedSupplementalAssets(manifest,root);assert.deepEqual(rows,[{objectKey:`avatar/synthetic/${sha.slice(0,32)}`,kind:"avatar",sha256:sha,byteLength:bytes.length,width:1,height:1,contentType:"image/webp",storageKey:sha}]);
 assert.notEqual(profileAssetId("source","one",sha),profileAssetId("source","two",sha));assert.equal(profileAssetId("source","one",sha),profileAssetId("source","one",sha));
}));
test("corrupt, missing and symlinked bytes cannot become descriptors",()=>fixture(async(root,manifest)=>{
 await writeFile(join(root,sha),Buffer.alloc(bytes.length));await assert.rejects(readVerifiedSupplementalAssets(manifest,root));await rm(join(root,sha));await assert.rejects(readVerifiedSupplementalAssets(manifest,root));await symlink(manifest,join(root,sha));await assert.rejects(readVerifiedSupplementalAssets(manifest,root));
}));
test("receipt path traversal, arbitrary URLs, duplicate keys and failed copies are refused",()=>fixture(async(root,manifest)=>{
 for(const objectKey of ["../escape","https://example.invalid/a","avatar/synthetic/"+"0".repeat(32),"comment-images/../original.webp"]){await writeFile(manifest,JSON.stringify([{objectKey,status:"copied",sha256:sha,bytes:bytes.length}]));await assert.rejects(readVerifiedSupplementalAssets(manifest,root));}
 const row={objectKey:"comment-images/synthetic/original.webp",status:"copied",sha256:sha,bytes:bytes.length};await writeFile(manifest,JSON.stringify([row,row]));await assert.rejects(readVerifiedSupplementalAssets(manifest,root));await writeFile(manifest,JSON.stringify([{...row,status:"failed"}]));await assert.rejects(readVerifiedSupplementalAssets(manifest,root));
}));
