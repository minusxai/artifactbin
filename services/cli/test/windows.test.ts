import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,chmod,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {browserCommand} from '../src/platform';
import {ensureNativePackage} from '../src/native-package';
import {digest} from '../src/files';
import {updateCli} from '../src/update';
import {scheduleBackgroundUpdate,runBackgroundUpdate} from '../src/background-update';

test('Windows browser handoff treats URL shell characters as literal data',()=>{
 const url="https://example.test/approve?a=1&next=$(touch nope)'";
 const command=browserCommand(url,'win32');
 assert.equal(command.file,'powershell.exe');
 assert.ok(command.args.includes('-EncodedCommand'));
 const script=Buffer.from(command.args.at(-1)!,'base64').toString('utf16le');
 assert.equal(script,`$env:PSModulePath=$PSHOME+'\\Modules'; Start-Process -FilePath '${url.replace(/'/g,"''")}'`);
 assert.deepEqual(browserCommand(url,'darwin'),{file:'open',args:[url]});
 assert.deepEqual(browserCommand(url,'linux'),{file:'xdg-open',args:[url]});
});

test('Windows native cache ignores Unix mode bits but still rejects changed bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-windows-cache-'));
 const bytes=Buffer.from('native'),gzip=gzipSync(bytes);
 const spec={url:'https://example.test/native.gz',sha256:digest(gzip),files:[{path:'node_modules/demo/native.node',size:bytes.length,sha256:digest(bytes)}]};
 try{
  const dir=await ensureNativePackage(spec,{root,fetch:async()=>new Response(gzip),platform:'win32'});
  await chmod(join(dir,spec.files[0].path),0o666);
  assert.equal(await ensureNativePackage(spec,{root,platform:'win32',fetch:async()=>assert.fail('offline')}),dir);
  await writeFile(join(dir,spec.files[0].path),'broken');
  await assert.rejects(ensureNativePackage(spec,{root,platform:'win32'}),/cache/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Windows archive names cannot alias or address device files and alternate streams',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-windows-path-'));
 const file={path:'node_modules/demo/file',size:1,sha256:digest('x')};
 try{
  for(const paths of [['node_modules/demo/file:stream'],['node_modules/demo/CON.txt'],['node_modules/demo/file.'],['node_modules/demo/X','node_modules/demo/x']]){
   await assert.rejects(ensureNativePackage({url:'https://example.test/a.gz',sha256:digest('a'),files:paths.map(path=>({...file,path}))},{root,platform:'win32',fetch:async()=>assert.fail('reject before download')}),/manifest/i);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Windows update directs users to the installer before touching state or network',async()=>{
 await assert.rejects(updateCli({platform:'win32',home:'/unused',server:'https://example.test',harnesses:[],fetch:async()=>assert.fail('no network')}),error=>error instanceof Error&&/close.*afbin.*installer/i.test(error.message));
 let launched=false,updated=false;
 const options={platform:'win32',standalone:true,home:'/unused',server:'https://example.test',launch:()=>{launched=true;},update:async()=>{updated=true;}};
 await scheduleBackgroundUpdate(options);await runBackgroundUpdate(options);
 assert.equal(launched,false);assert.equal(updated,false);
});
