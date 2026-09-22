/** Pinned PGLite ESM runtime only. No optional extensions are configured by the OSS host.
 * Keep root JS chunks and filesystem adapters for the package's dynamic imports; executable
 * persistence tests and packaged-host conformance guard changes to the upstream file layout.
 */
export function runtimePackageFile(name,relative){
 relative=relative.split('\\').join('/');
 if(name!=='@electric-sql/pglite')return true;
 if(!relative||relative==='package.json'||relative==='LICENSE'||relative==='dist'||relative==='dist/fs')return true;
 return /^dist\/[^/]+\.js$/.test(relative)||/^dist\/fs\/[^/]+\.js$/.test(relative)||/^dist\/(pglite\.wasm|pglite\.data|initdb\.wasm)$/.test(relative);
}
