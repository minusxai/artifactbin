/** Admit only source-owned runtime code, never a page-selected path or URL.
 * Split modules are discovered by their source/Path pair in the build output, at their flat /af/ addresses (D17);
 * the legacy /af/v1/core.js alias serves the same core. */
export function runtimeAssetManifest(assets){
 const manifest=new Map();
 if(typeof assets.core!=='string'||!assets.core)throw Error('Preview runtime core is missing');
 manifest.set('/af/core.js',assets.core);manifest.set('/af/v1/core.js',assets.core);
 for(const [key,path] of Object.entries(assets)){
  if(!key.endsWith('Path')||path===undefined)continue;
  const source=assets[key.slice(0,-4)];
  if(typeof source!=='string'||!source||typeof path!=='string'||!/^\/af\/[a-z]+\.js$/.test(path)||path==='/af/core.js')throw Error(`Preview runtime asset does not match its source: ${key}`);
  manifest.set(path,source);
 }
 return manifest;
}
