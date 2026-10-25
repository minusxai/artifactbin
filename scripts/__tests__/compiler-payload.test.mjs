import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {COMPILER_TARGETS,compilerIntegrity,compilerPayload,installCompiler,replaceCompiler} from '../../services/cli/scripts/prepare-esbuild.mjs';
const require=createRequire(import.meta.url);

async function fixture(run){
 const root=await mkdtemp(join(tmpdir(),'compiler-payload-'));
 try{
  const original=dirname(require.resolve('esbuild/package.json')),version=require('esbuild/package.json').version;
  const native=require.resolve(`@esbuild/${process.platform}-${process.arch}/${process.platform==='win32'?'esbuild.exe':'bin/esbuild'}`);
  // Exercise the actual compiler protocol without repeatedly copying multi-megabyte Mach-O/ELF files.
  // Native candidate acceptance separately verifies the real packaged binaries on every supported OS.
  const binary=process.platform==='win32'?native:join(root,'host-compiler');
  if(process.platform!=='win32')await writeFile(binary,`#!/bin/sh\nexec '${native.replaceAll("'","'\\''")}' "$@"\n`,{mode:0o755});
  const assets=join(root,'assets'),manifest={version:1,go:'go1.27.3',sys:'v0.44.0',compilers:{[version]:{}}};
  for(const target of [`${process.platform}-${process.arch}`]){
   const file=`${version}/${target}/esbuild${target.startsWith('win32-')?'.exe':''}`;
   await mkdir(dirname(join(assets,file)),{recursive:true});await cp(binary,join(assets,file));
   manifest.compilers[version][target]={file,integrity:compilerIntegrity(await readFile(binary))};
  }
  await writeFile(join(assets,'manifest.json'),JSON.stringify(manifest));
  const packageRoot=join(root,'node_modules/esbuild');await mkdir(join(packageRoot,'bin'),{recursive:true});await mkdir(join(packageRoot,'lib'));
  await cp(join(original,'package.json'),join(packageRoot,'package.json'));await cp(join(original,'lib/main.js'),join(packageRoot,'lib/main.js'));
  await run({root,assets,manifest,packageRoot,version,binary});
 }finally{await rm(root,{recursive:true,force:true});}
}

it('covers every documented install platform and rejects tampering, missing assets and path redirection before execution',()=>fixture(async({assets,manifest,version})=>{
 expect(COMPILER_TARGETS).toEqual(['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-x64']);
 const target=`${process.platform}-${process.arch}`,file=await compilerPayload(assets,version,target);
 await writeFile(file,'tampered');await expect(compilerPayload(assets,version,target)).rejects.toThrow('integrity mismatch');
 manifest.compilers[version][target].file='../outside';await writeFile(join(assets,'manifest.json'),JSON.stringify(manifest));
 await expect(compilerPayload(assets,version,target)).rejects.toThrow('Missing compiler payload');
 await expect(compilerPayload(assets,'0.0.0',target)).rejects.toThrow('Missing compiler payload');
 await expect(compilerPayload(assets,version,'linux-mips')).rejects.toThrow('Unsupported compiler platform');
}));

it('replaces the installed Unix native copies and preserves the real JavaScript compiler protocol',()=>fixture(async({root,assets,packageRoot,binary})=>{
 if(process.platform==='win32')return;
 const platformRoot=join(root,'node_modules',`@esbuild/${process.platform}-${process.arch}`);
 await mkdir(join(platformRoot,'bin'),{recursive:true});await cp(binary,join(platformRoot,'bin/esbuild'));
 await writeFile(join(platformRoot,'package.json'),JSON.stringify({name:`@esbuild/${process.platform}-${process.arch}`,version:'0.0.0'}));
 await writeFile(join(packageRoot,'bin/esbuild'),'old launcher');
 const fallback=join(packageRoot,'lib',`downloaded-@esbuild-${process.platform}-${process.arch}-esbuild`);
 await writeFile(fallback,'old retained fallback');
 await installCompiler(packageRoot,assets);
 expect(await readFile(join(packageRoot,'bin/esbuild'))).toEqual(await readFile(binary));
 expect(await readFile(fallback)).toEqual(await readFile(binary));
 expect(execFileSync(join(packageRoot,'bin/esbuild'),['--version'],{encoding:'utf8'}).trim()).toBe(require('esbuild/package.json').version);
}));

it('refuses a version mismatch and preserves the original diagnostic outside the disposable install',()=>fixture(async({root,assets,manifest,packageRoot,version})=>{
 const target=`${process.platform}-${process.arch}`;
 manifest.compilers['0.0.0']={[target]:{...manifest.compilers[version][target],file:`0.0.0/${target}/esbuild${process.platform==='win32'?'.exe':''}`}};
 const destination=join(assets,manifest.compilers['0.0.0'][target].file);await mkdir(dirname(destination),{recursive:true});await cp(join(assets,manifest.compilers[version][target].file),destination);
 await writeFile(join(assets,'manifest.json'),JSON.stringify(manifest));await writeFile(join(packageRoot,'package.json'),JSON.stringify({version:'0.0.0'}));
 const diagnosticsPath=join(root,'compiler-install.json');
 await expect(installCompiler(packageRoot,assets,{diagnosticsPath})).rejects.toThrow('Compiler protocol mismatch');
 const diagnostic=JSON.parse(await readFile(diagnosticsPath,'utf8'));
 expect(diagnostic.operation).toBe('check compiler version');expect(diagnostic.message).toContain('Compiler protocol mismatch');
 expect(diagnostic.destination).toBeNull();
}));

it('preserves the Windows JavaScript launcher while replacing the platform executable',()=>fixture(async({root,assets,manifest,packageRoot,version,binary})=>{
 // The host executable stands in for PE here; native Windows execution is covered by npm CI acceptance.
 const target='win32-x64',file=`${version}/${target}/esbuild.exe`;
 await mkdir(dirname(join(assets,file)),{recursive:true});await cp(binary,join(assets,file));
 manifest.compilers[version][target]={file,integrity:compilerIntegrity(await readFile(binary))};
 await writeFile(join(assets,'manifest.json'),JSON.stringify(manifest));
 for(const [platform,arch]of [['win32','x64'],[process.platform,process.arch]]){
  const platformRoot=join(root,'node_modules',`@esbuild/${platform}-${arch}`),subpath=platform==='win32'?'esbuild.exe':'bin/esbuild';
  await mkdir(dirname(join(platformRoot,subpath)),{recursive:true});await cp(binary,join(platformRoot,subpath));
  await writeFile(join(platformRoot,'package.json'),JSON.stringify({name:`@esbuild/${platform}-${arch}`,version}));
 }
 const launcher='#!/usr/bin/env node\n// Windows npm launcher remains JavaScript\n';
 await writeFile(join(packageRoot,'bin/esbuild'),launcher);
 await installCompiler(packageRoot,assets,{platform:'win32',arch:'x64'});
 expect(await readFile(join(packageRoot,'bin/esbuild'),'utf8')).toBe(launcher);
 expect(await readFile(join(root,'node_modules/@esbuild/win32-x64/esbuild.exe'))).toEqual(await readFile(binary));
}));

it('retries only bounded Windows executable locks and preserves permanent replacement failures',async()=>{
 const locked=Object.assign(new Error('locked executable'),{code:'EPERM'});
 let attempts=0,waits=0;
 await replaceCompiler('verified.tmp','esbuild.exe',{platform:'win32',move:async()=>{if(++attempts<3)throw locked;},wait:async(ms)=>{expect(ms).toBe(100);waits++;}});
 expect(attempts).toBe(3);expect(waits).toBe(2);
 attempts=0;waits=0;
 await expect(replaceCompiler('verified.tmp','esbuild.exe',{platform:'win32',move:async()=>{attempts++;throw locked;},wait:async()=>{waits++;}})).rejects.toBe(locked);
 expect(attempts).toBe(20);expect(waits).toBe(19);
 for(const [platform,code]of [['linux','EPERM'],['win32','ENOENT']]){
  const failure=Object.assign(new Error(code),{code});let calls=0;
  await expect(replaceCompiler('verified.tmp','esbuild.exe',{platform,move:async()=>{calls++;throw failure;},wait:async()=>{throw Error('Unexpected retry');}})).rejects.toBe(failure);
  expect(calls).toBe(1);
 }
});
