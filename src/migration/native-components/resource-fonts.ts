import type {NativeRetainedFontManifest} from './resource-fonts-contracts.ts';
import {resourceSha256,type NativeResourceAsset} from './resources.ts';
/** Explicit manifest sections, never a recursive search through unrelated metadata. */
export function nativeRetainedFontUrls(manifest:NativeRetainedFontManifest):string[]{
 const groups=[...Object.values(manifest.families??{}),manifest.app??[],...Object.values(manifest.systems??{})];
 if(groups.some(group=>!Array.isArray(group)))throw Error('native_pipeline_font_manifest');
 return [...new Set(groups.flat().map(font=>font.url).filter(url=>typeof url==='string'&&/^\/fonts\/[A-Za-z0-9_-]+\.[a-f0-9]{8}\.woff2$/.test(url)))];
}
/** Retain original font bytes only when both manifest admission and filename digest agree. */
export function prepareNativeRetainedFont(manifestBytes:string|Uint8Array,source:string,bytes:Uint8Array):NativeResourceAsset|undefined{
 const manifest=JSON.parse(typeof manifestBytes==='string'?manifestBytes:new TextDecoder().decode(manifestBytes)) as NativeRetainedFontManifest;
 if(!nativeRetainedFontUrls(manifest).includes(source))return undefined;
 const sha256=resourceSha256(bytes),prefix=/\.([a-f0-9]{8})\.woff2$/.exec(source)![1]!;
 if(!sha256.startsWith(prefix))throw Error('native_pipeline_font_digest');
 return {sources:[source],bytes,sha256,extension:'woff2',provenanceSha256:resourceSha256(manifestBytes)};
}
