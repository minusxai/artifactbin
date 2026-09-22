import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {standaloneSqlPlugin} from '../../services/cli/scripts/sql-native-plugin.mjs';
import {runtimePackageFile} from '../../services/cli/scripts/runtime-package-files.mjs';
import {archiveDirectory} from '../../services/cli/scripts/runtime-archive.mjs';
import {runtimePin} from '../../services/cli/scripts/runtime.mjs';
import {downloadRuntime} from '../../services/cli/scripts/runtime-package.mjs';
it('matches Windows engine paths and retains PGLite Windows runtime paths',()=>{
 let filter;standaloneSqlPlugin().setup({onLoad:options=>{filter=options.filter;},onResolve:()=>{}});
 expect(filter.test('C:\\repo\\services\\sql\\src\\engine.ts')).toBe(true);
 expect(runtimePackageFile('@electric-sql/pglite','dist\\pglite.wasm')).toBe(true);
 expect(runtimePackageFile('@electric-sql/pglite','dist\\fs\\nodefs.js')).toBe(true);
 expect(runtimePackageFile('@electric-sql/pglite','dist\\index.cjs')).toBe(false);
});
it('marks Windows browser executables executable even without POSIX mode bits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'windows-archive-'));
 try{
  await mkdir(join(root,'browser'));await writeFile(join(root,'browser','chrome.exe'),'exe',{mode:0o600});
  const manifest=await archiveDirectory(join(root,'browser'),{prefix:'node_modules/chromium',out:join(root,'out.gz'),url:'https://example.test/a.gz'});
  expect(manifest.files[0].mode).toBe(0o700);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('verifies the pinned official Windows executable and refuses corrupt bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'windows-node-')),bytes=Buffer.from('node fixture'),sha256=createHash('sha256').update(bytes).digest('hex');
 const entry={format:'raw',url:'https://nodejs.org/download/release/v22.22.3/win-x64/node.exe',sha256,size:bytes.length,recipe:{version:'22.22.3',platform:'win32',arch:'x64',intl:'full-icu'}};
 const lock={schema:1,release:'cli-node-v22.22.3-r1',version:'22.22.3',platforms:{'win32-x64':entry}};
 try{
  const pin=runtimePin(lock,'win32','x64');expect(pin.url).toBe(entry.url);
  await expect(downloadRuntime(pin,{root,fetch:async()=>new Response('corrupt')})).rejects.toThrow(/checksum|size/);
  const file=await downloadRuntime(pin,{root,fetch:async()=>new Response(bytes)});expect(file.endsWith('node.exe')).toBe(true);expect(await readFile(file)).toEqual(bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});
