/** `@afbin/<name>` -> served module path, derived from the shipped library files. */
export function libraryImportMap(manifest){
 const imports={};
 for(const url of manifest.keys()){const match=/^\/libraries\/([a-z][a-z0-9-]*)-\d+\.\d+\.\d+\/index\.js$/.exec(url);if(match)imports['@afbin/'+match[1]]=url;}
 return imports;
}
/** Only generated, flat, versioned public library modules enter this route map.
 * Nothing here resolves a request-selected disk path or remote URL. */
export function libraryAssetManifest(assets){
 const manifest=new Map();
 for(const [url,source] of Object.entries(assets)){
  if(!/^\/libraries\/[a-z][a-z0-9-]*-\d+\.\d+\.\d+\/index\.js$/.test(url)||typeof source!=='string'||!source)throw Error('Invalid preview library asset');
  manifest.set(url,source);
 }
 return manifest;
}
