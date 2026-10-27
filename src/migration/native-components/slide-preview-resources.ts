import{createHash}from'node:crypto';
import type{NativeSlidePreviewResourceInput,NativeSlidePreviewImageResource}from'./slide-preview-resource-contracts.ts';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function rasterMime(b:Uint8Array):NativeSlidePreviewImageResource['mime']|undefined {
 const a=Buffer.from(b);
 if(a.length>=33&&a.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&a.toString('ascii',12,16)==='IHDR'&&a.readUInt32BE(8)===13&&a.readUInt32BE(16)>0&&a.readUInt32BE(20)>0)return'image/png';
 if(a.length>=4&&a[0]===255&&a[1]===216&&a[2]===255&&a[a.length-2]===255&&a[a.length-1]===217)return'image/jpeg';
 if(a.length>=13&&['GIF87a','GIF89a'].includes(a.toString('ascii',0,6))&&a.readUInt16LE(6)>0&&a.readUInt16LE(8)>0)return'image/gif';
 if(a.length>=20&&a.toString('ascii',0,4)==='RIFF'&&a.readUInt32LE(4)+8===a.length&&a.toString('ascii',8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(a.toString('ascii',12,16)))return'image/webp';
}
/** Select only already admitted source URLs whose exact raster file bytes are in this bundle. */
export function prepareNativeSlidePreviewImages(input:NativeSlidePreviewResourceInput):readonly NativeSlidePreviewImageResource[]{
 const result:NativeSlidePreviewImageResource[]=[];
 for(const file of input.files){
  const name=/^assets\/([a-f0-9]{64})\.(png|jpg|jpeg|gif|webp)$/.exec(file.path);if(!name||!file.bytes.length||input.files.filter(f=>f.path===file.path).length!==1||file.sha256!==name[1]||sha(file.bytes)!==file.sha256)continue;
  const src='./'+file.path,receipts=input.urls.filter(u=>u.target===src);if(receipts.length!==1||!receipts[0]!.source.trim()||receipts[0]!.sha256!==file.sha256)continue;
  const mime=rasterMime(file.bytes),expected={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[name[2]!];if(!mime||mime!==expected)continue;
  result.push({src,sha256:file.sha256,bytes:file.bytes.length,mime});
 }
 return result;
}
