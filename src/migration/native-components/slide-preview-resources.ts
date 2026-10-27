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
  const src='./'+file.path,receipts=input.urls.filter(u=>u.target===src);if(!receipts.length||new Set(receipts.map(u=>u.source)).size!==receipts.length||receipts.some(u=>!u.source.trim()||u.sha256!==file.sha256))continue;
  const mime=rasterMime(file.bytes),expected={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[name[2]!];if(!mime||mime!==expected)continue;
  result.push({src,sha256:file.sha256,bytes:file.bytes.length,mime});
 }
 return result;
}

/** Preserve the admitted descriptor in inert HTML so the normal publication planner rewrites the same asset reference as authored images. */
export function projectNativeSlidePreviewResources(input:import('./slide-preview-resource-contracts.ts').NativeSlidePreviewResourceProjectionInput):import('./slide-preview-resource-contracts.ts').NativeSlidePreviewResourceProjection {
 const resources=input.resources.map(r=>({src:r.src,sha256:r.sha256,bytes:r.bytes,mime:r.mime}));
 if(/data-native-slide-preview-resources/i.test(input.authoredHtml))throw Error('preview_manifest_authored_collision');
 if(new Set(resources.map(r=>r.src)).size!==resources.length||resources.some(r=>{const match=/^\.\/assets\/([a-f0-9]{64})\.(png|jpg|jpeg|gif|webp)$/.exec(r.src);return!match||match[1]!==r.sha256||!Number.isSafeInteger(r.bytes)||r.bytes<=0||({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'}as Record<string,string>)[match[2]!]!==r.mime;}))throw Error('preview_manifest_descriptor');
 const descriptorSha256=sha(Buffer.from(JSON.stringify(resources)));
 if(!resources.length)return{descriptorSha256,templateHtml:'',registrationExpression:'[]'};
 const identityPolicy:import('./slide-preview-resource-contracts.ts').NativeSlidePreviewPlatformIdentityPolicy={attribute:'data-af-id',valuePattern:'^af-[1-9][0-9]*$'};
 const templateHtml=`<template data-native-slide-preview-resources="${descriptorSha256}">${resources.map((r,i)=>`<img src="${r.src}" data-native-slide-preview-index="${i}" data-native-slide-preview-canonical="${r.src}" data-native-slide-preview-sha256="${r.sha256}" data-native-slide-preview-bytes="${r.bytes}" data-native-slide-preview-mime="${r.mime}">`).join('')}</template>`;
 const registrationExpression=`(()=>{const expected=${JSON.stringify(resources)},identityPolicy=${JSON.stringify(identityPolicy)},normalIds=new Set(),templates=document.querySelectorAll('template[data-native-slide-preview-resources="${descriptorSha256}"]');if(templates.length!==1)throw Error('preview_manifest_count');const children=[...templates[0].content.children];if(children.length!==expected.length||templates[0].content.childNodes.length!==children.length)throw Error('preview_manifest_children');return expected.map((r,i)=>{const el=children[i],fields={'data-native-slide-preview-index':String(i),'data-native-slide-preview-canonical':r.src,'data-native-slide-preview-sha256':r.sha256,'data-native-slide-preview-bytes':String(r.bytes),'data-native-slide-preview-mime':r.mime};const platformId=el.getAttribute(identityPolicy.attribute);if(platformId!==null&&(!new RegExp(identityPolicy.valuePattern).test(platformId)||normalIds.has(platformId)))throw Error('preview_manifest_platform_identity');if(platformId!==null)normalIds.add(platformId);if(el.tagName!=='IMG'||el.attributes.length!==(platformId===null?6:7)||Object.entries(fields).some(([key,value])=>el.getAttribute(key)!==value))throw Error('preview_manifest_metadata');const raw=el.getAttribute('src');if(!raw)throw Error('preview_manifest_src');const url=new URL(raw,document.baseURI),base=new URL(document.baseURI);if(!['http:','https:'].includes(url.protocol)||url.origin!==base.origin||url.username||url.password||url.hash)throw Error('preview_manifest_origin');return{...r,resolvedSrc:raw};});})()`;
 return{descriptorSha256,templateHtml,registrationExpression};
}
