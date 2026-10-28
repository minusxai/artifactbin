/** Installs a source-built compiler from this package's integrity-checked payload, never the network. */
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {readFile,copyFile,chmod,access,rename,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

export const COMPILER_TARGETS=['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-x64'];
export function compilerIntegrity(bytes){return 'sha512-'+createHash('sha512').update(bytes).digest('base64');}
export async function compilerPayload(directory,version,target){
 if(!COMPILER_TARGETS.includes(target))throw new Error(`Unsupported compiler platform: ${target}`);
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 if(manifest.version!==1||manifest.go!=='go1.27.3'||manifest.sys!=='v0.44.0')throw new Error('Unsupported compiler build recipe');
 const entry=manifest.compilers?.[version]?.[target];
 const file=`${version}/${target}/esbuild${target.startsWith('win32-')?'.exe':''}`;
 if(entry?.file!==file||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity))throw new Error(`Missing compiler payload: ${version}/${target}`);
 const path=join(directory,file),bytes=await readFile(path);
 if(compilerIntegrity(bytes)!==entry.integrity)throw new Error(`Compiler integrity mismatch: ${version}/${target}`);
 return path;
}

/** npm runs package postinstalls concurrently; Windows may briefly hold esbuild.exe open. */
export async function replaceCompiler(source,destination,{platform=process.platform,move=rename,wait=pause}={}){
 for(let attempt=0;;attempt++){
  try{return await move(source,destination);}
  catch(error){
   if(platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=19)throw error;
   await wait(100);
  }
 }
}

export async function installCompiler(packageRoot,assets,{platform=process.platform,arch=process.arch,diagnosticsPath=process.env.ARTIFACTBIN_COMPILER_DIAGNOSTICS}={}){
 let operation='read package',activeDestination;
 try{
 const require=createRequire(join(packageRoot,'package.json'));
 const version=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8')).version;
 operation='verify compiler payload';
 const source=await compilerPayload(assets,version,`${platform}-${arch}`);
 operation='check compiler version';
 const reported=execFileSync(source,['--version'],{encoding:'utf8',timeout:10000}).trim();
 if(reported!==version)throw new Error(`Compiler protocol mismatch: ${reported} != ${version}`);
 operation='find installed compiler executable';
 // Windows bin/esbuild is a JavaScript launcher used by npm's .cmd shim. Keep it intact.
 const subpath=platform==='win32'?'esbuild.exe':'bin/esbuild';
 const fallback=join(packageRoot,'lib',`downloaded-@esbuild-${platform}-${arch}-${platform==='win32'?'esbuild.exe':'esbuild'}`);
 let native;
 try{native=require.resolve(`@esbuild/${platform}-${arch}/${subpath}`);}
 catch(error){
  if(error.code!=='MODULE_NOT_FOUND')throw error;
  native=fallback;
  await access(native); // Only replace an installed compiler, never create an untracked fallback.
 }
 const destinations=[native,...(platform==='win32'?[]:[join(packageRoot,'bin/esbuild')])];
 try{await access(fallback);destinations.push(fallback);}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const destination of new Set(destinations)){
  activeDestination=destination;
  // Replacing an executable inode also preserves running processes and Mach-O code-signing caches.
  const temporary=`${destination}.${randomUUID()}.tmp`;
  let primaryError;
  try{
   operation='copy compiler executable';await copyFile(source,temporary);
   operation='set compiler permissions';await chmod(temporary,0o755);
   operation='replace compiler executable';await replaceCompiler(temporary,destination,{platform});
  }catch(error){primaryError=error;throw error;}
  finally{try{await rm(temporary,{force:true});}catch(error){if(!primaryError)throw error;}}
 }
 activeDestination=undefined;operation='check installed JavaScript protocol';
 // A fresh process validates the installed package without reusing a caller's cached compiler worker.
 execFileSync(process.execPath,['-e',`
  const esbuild=module.require(process.argv[1]);
  try{if(esbuild.version!==process.argv[2]||esbuild.transformSync('const answer: number = 42',{loader:'ts'}).code.trim()!=='const answer = 42;')throw new Error('Compiler JavaScript protocol check failed');}
  finally{esbuild.stop();}
 `,packageRoot,version],{encoding:'utf8',timeout:15000});
 }catch(error){
  // npm exec can hide lifecycle stderr. The native CI fixture owns this optional path outside its disposable install.
  if(diagnosticsPath){
   const details={operation,destination:activeDestination??null,code:error.code??null,status:error.status??null,signal:error.signal??null,message:String(error.message).slice(-8192),stdout:String(error.stdout??'').slice(-4096),stderr:String(error.stderr??'').slice(-4096)};
   try{await writeFile(diagnosticsPath,JSON.stringify(details,null,2)+'\n');}catch(diagnosticError){console.error('Compiler diagnostic unavailable:',diagnosticError.code);}
  }
  throw error;
 }
}
