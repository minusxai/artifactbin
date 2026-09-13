import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir,symlink} from 'node:fs/promises';
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
