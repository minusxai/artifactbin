import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir,symlink,stat,readlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {ensureNativePackage,type NativePackage} from '../src/native-package';
import {digest} from '../src/files';
const bytes=Buffer.from('native bytes');
const zipped=gzipSync(bytes);
const spec:NativePackage={url:'https://github.com/minusxai/artifactbin/releases/download/afbin-v1.0.0/afbin-sql-darwin-arm64.gz',sha256:digest(zipped),files:[{path:'node_modules/example/native.node',size:bytes.length,sha256:digest(bytes)}]};
test('native install verifies, publishes atomically, shares concurrent installs and reuses offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-native-test-'));let requests=0;
 try{
  const fetcher=async()=>{requests++;return new Response(zipped);};
  const paths=await Promise.all(Array.from({length:3},()=>ensureNativePackage(spec,{root,fetch:fetcher})));
  assert.equal(new Set(paths).size,1);assert.deepEqual(await readFile(join(paths[0],spec.files[0].path)),bytes);
  assert.equal(await ensureNativePackage(spec,{root,fetch:async()=>assert.fail('offline cache must not fetch')}),paths[0]);
  assert.ok(requests>=1);assert.deepEqual(await readdir(root),[spec.sha256]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('corrupt download never publishes and a subsequent attempt can succeed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-native-bad-'));
 try{
  await assert.rejects(ensureNativePackage(spec,{root,fetch:async()=>new Response('corrupt')}),/checksum/i);
  assert.deepEqual(await readdir(root),[]);
  await ensureNativePackage(spec,{root,fetch:async()=>new Response(zipped)});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('cache tampering fails closed without loading bytes, including symbolic links',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-native-cache-'));
 try{
  const dir=await ensureNativePackage(spec,{root,fetch:async()=>new Response(zipped)}),file=join(dir,spec.files[0].path);
  await writeFile(file,'bad');
  await assert.rejects(ensureNativePackage(spec,{root,fetch:async()=>assert.fail('do not overwrite a loaded cache')}),/cache/i);
  await rm(file);await symlink('/etc/hosts',file);
  await assert.rejects(ensureNativePackage(spec,{root}),/cache/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
for(const path of ['../escape','/absolute','node_modules/../escape','node_modules/x\\y','node_modules/x/./y'])test(`native package refuses unsafe path ${path}`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-native-path-'));
 try{await assert.rejects(ensureNativePackage({...spec,files:[{...spec.files[0],path}]},{root,fetch:async()=>assert.fail('validate before fetching')}),/manifest/i);assert.deepEqual(await readdir(root),[]);}
 finally{await rm(root,{recursive:true,force:true});}
});
test('a valid gzip checksum cannot hide wrong file contents or excessive decoded bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-native-size-'));
 try{
  await assert.rejects(ensureNativePackage({...spec,files:[{...spec.files[0],sha256:'0'.repeat(64)}]},{root,fetch:async()=>new Response(zipped)}),/checksum/i);
  await assert.rejects(ensureNativePackage({...spec,files:[{...spec.files[0],size:1}]},{root,fetch:async()=>new Response(zipped)}));
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('browser archives retain executable modes and confined framework links, including offline verification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-browser-package-'));
 const executable=Buffer.from('#!/bin/sh\nexit 0\n'),link=Buffer.from('browser');
 const zipped=gzipSync(Buffer.concat([executable,link]));
 const archive:NativePackage={url:spec.url,sha256:digest(zipped),files:[
  {path:'node_modules/chromium/browser',size:executable.length,sha256:digest(executable),mode:0o700},
  {path:'node_modules/chromium/current',size:link.length,sha256:digest(link),link:'browser'},
 ]};
 try{
  const dir=await ensureNativePackage(archive,{root,kind:'chromium',fetch:async()=>new Response(zipped)});
  assert.equal((await stat(join(dir,archive.files[0]!.path))).mode&0o777,0o700);
  assert.equal(await readlink(join(dir,archive.files[1]!.path)),'browser');
  assert.equal(await ensureNativePackage(archive,{root,kind:'chromium',fetch:async()=>assert.fail('offline')}),dir);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('archive links cannot escape the cache or become parents of other entries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-package-link-'));
 try{
  for(const link of ['/etc','../../../escape','../outside']){
   const entry={path:'node_modules/current',size:link.length,sha256:digest(link),link};
   await assert.rejects(ensureNativePackage({...spec,files:[entry]},{root,kind:'chromium',fetch:async()=>assert.fail('reject unsafe manifest before download')}),/manifest/i);
  }
  await assert.rejects(ensureNativePackage({...spec,files:[
   {path:'node_modules/current',size:3,sha256:digest('bin'),link:'bin'},
   {path:'node_modules/current/browser',size:bytes.length,sha256:digest(bytes)},
  ]},{root,kind:'chromium',fetch:async()=>assert.fail('reject link traversal')}),/manifest/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
