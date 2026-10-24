import {createHash} from 'node:crypto';

/** Admit only source-owned immutable code, never a page-selected path or URL.
 * New split modules are discovered by their source/Path pair in the build output. */
export function runtimeAssetManifest(assets){
 const manifest=new Map();
 if(typeof assets.core!=='string'||!assets.core)throw Error('Preview runtime core is missing');
 manifest.set('/af/v1/core.js',assets.core);
 for(const [key,path] of Object.entries(assets)){
  if(!key.endsWith('Path')||path===undefined)continue;
  const source=assets[key.slice(0,-4)];
  if(typeof source!=='string'||!source||typeof path!=='string'||!/^\/af\/v1\/(?:reader|apollo)\/[a-f0-9]{64}$/.test(path)||path.split('/').at(-1)!==createHash('sha256').update(source).digest('hex'))throw Error(`Preview runtime asset does not match its immutable source: ${key}`);
  manifest.set(path,source);
 }
 return manifest;
}
