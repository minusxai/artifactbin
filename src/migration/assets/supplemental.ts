import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { VerifiedSupplementalObject } from "./supplemental-contracts.ts";
const SHA = /^[a-f0-9]{64}$/;
const MAX_BYTES = 32 * 1024 * 1024;
function fail(): never { throw Error("Invalid supplemental asset proof"); }
async function regularBytes(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) fail();
    // One sentinel byte catches growth without allowing a changing file to grow the allocation.
    const bytes=Buffer.alloc(stat.size+1);let length=0;
    while(length<bytes.length){const read=await file.read(bytes,length,bytes.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead;}
    if(length!==stat.size)fail();
    return bytes.subarray(0,length);
  } finally { await file.close(); }
}
/** Derive the static raster dimensions from stored bytes, never from captured viewport metadata. */
function webpDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 20 || bytes.toString("ascii",0,4) !== "RIFF" || bytes.toString("ascii",8,12) !== "WEBP" || bytes.readUInt32LE(4)+8 !== bytes.length) fail();
  let canvas: {width:number;height:number}|undefined, image: {width:number;height:number}|undefined;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset+8 > bytes.length) fail();
    const kind=bytes.toString("ascii",offset,offset+4), size=bytes.readUInt32LE(offset+4), start=offset+8, end=start+size;
    if (end > bytes.length || end+(size%2) > bytes.length) fail();
    if (kind === "VP8X") {
      if (canvas || size !== 10 || (bytes[start]! & 2)) fail();
      canvas={width:bytes.readUIntLE(start+4,3)+1,height:bytes.readUIntLE(start+7,3)+1};
    } else if (kind === "VP8 ") {
      if (image || size < 10 || (bytes[start]! & 1) || bytes.toString("hex",start+3,start+6) !== "9d012a") fail();
      image={width:bytes.readUInt16LE(start+6)&0x3fff,height:bytes.readUInt16LE(start+8)&0x3fff};
    } else if (kind === "VP8L") {
      if (image || size < 5 || bytes[start] !== 0x2f) fail();
      const bits=bytes.readUInt32LE(start+1);if(bits>>>29) fail();
      image={width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};
    } else if (kind === "ANIM" || kind === "ANMF") fail();
    offset=end+(size%2);
  }
  if (!image || !image.width || !image.height || (canvas && (canvas.width!==image.width || canvas.height!==image.height))) fail();
  return image;
}
export function profileAssetId(namespace: string, legacyUserId: string, sha256: string): string {
  for (const value of [namespace,legacyUserId]) if (typeof value!=="string" || !value || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || Buffer.byteLength(value)>16384) fail();
  if (!SHA.test(sha256)) fail();
  return createHash("sha256").update(JSON.stringify([namespace,legacyUserId,sha256])).digest("hex");
}
/** Reads private migration receipts and verifies flat object bytes again before import projection. */
export async function readVerifiedSupplementalAssets(manifestPath: string, objectsDirectory: string): Promise<readonly VerifiedSupplementalObject[]> {
  const directory=await lstat(objectsDirectory);if(!directory.isDirectory() || directory.isSymbolicLink()) fail();
  const receipts: unknown=JSON.parse((await regularBytes(manifestPath,16*1024*1024)).toString("utf8"));if(!Array.isArray(receipts)) fail();
  const seen=new Set<string>(), output: VerifiedSupplementalObject[]=[];
  for (const receipt of receipts) {
    if (!receipt || typeof receipt!=="object" || receipt.status!=="copied" || typeof receipt.objectKey!=="string" || typeof receipt.sha256!=="string" || !SHA.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes<1 || receipt.bytes>MAX_BYTES || seen.has(receipt.objectKey)) fail();
    seen.add(receipt.objectKey);
    const avatar=/^avatar\/[A-Za-z0-9_-]{1,128}\/([a-f0-9]{32})$/.exec(receipt.objectKey);
    const comment=/^comment-images\/[A-Za-z0-9_-]{1,128}\/(original|preview|thumbnail)\.webp$/.test(receipt.objectKey);
    if (!avatar && !comment) fail();
    if (avatar && !receipt.sha256.startsWith(avatar[1]!)) fail();
    const bytes=await regularBytes(join(objectsDirectory,receipt.sha256),MAX_BYTES);
    if (bytes.length!==receipt.bytes || createHash("sha256").update(bytes).digest("hex")!==receipt.sha256) fail();
    const dimensions=webpDimensions(bytes);
    output.push(Object.freeze({objectKey:receipt.objectKey,kind:avatar?"avatar":"comment-image",sha256:receipt.sha256,byteLength:bytes.length,...dimensions,contentType:"image/webp",storageKey:receipt.sha256}));
  }
  return Object.freeze(output);
}
