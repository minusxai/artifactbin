/** Private producer toolchain. Source and SDK downloads are checked against pinned upstream digests. */
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,rename,readdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {COMPILER_TARGETS,compilerPayload,compilerIntegrity} from '../../services/cli/scripts/prepare-esbuild.mjs';

const execute=promisify(execFile);
const sdkVersion='go1.27.3';
const sdkHashes={
 'darwin-arm64':'dd3908cf20959d798c1e06ebe5b72213f0505ce01373b40ce3110975a6cd99c2',
 'darwin-x64':'b6f8e931e4ab497fcde6da8ae4499a58f9d258e55c8a80824a516eae5950a750',
 'linux-arm64':'a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49',
 'linux-x64':'65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40',
 'win32-x64':'f26081f438319757f8a1b46d7d0b2c5ec7583d4038e485e0aa725cfde7885fff',
};
const sourceSums={
 '0.28.1':'h1:ds+yuRyUaZGx++GR56CrCeuXh8PVhVM4xq8v7PNELFc=',
 '0.28.2':'h1:A2uETn4jrQTcXaT/shwTDTYBxDjl7fV7nXmUrJxfA2w=',
};
const sourceModSum='h1:D2vIQZqV/vIf/VRHtViaUtViZmG7o+kKmlBfVQuRi48=';
const sysSum='h1:ildZl3J4uzeKP07r2F++Op7E9B29JRUy+a27EibtBTQ=';
const sysModSum='h1:4GL1E5IUh+htKOUEOaiffhrAeqysfVGipDYzABqnCmw=';
async function writable(directory){
 await chmod(directory,0o755);
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=join(directory,entry.name);
  if(entry.isDirectory())await writable(file);else await chmod(file,0o644);
 }
}

async function privateGo(){
 const target=`${process.platform}-${process.arch}`,digest=sdkHashes[target];
 if(!digest)throw new Error(`Unsupported compiler producer: ${target}`);
 const work=await mkdtemp(join(tmpdir(),'afbin-go-'));
 try{
  const os=process.platform==='win32'?'windows':process.platform,arch=process.arch==='x64'?'amd64':process.arch;
  const archive=join(work,process.platform==='win32'?'sdk.zip':'sdk.tar.gz');
  const response=await fetch(`https://go.dev/dl/${sdkVersion}.${os}-${arch}.${process.platform==='win32'?'zip':'tar.gz'}`);
  if(!response.ok)throw new Error(`Go SDK download failed: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==digest)throw new Error('Go SDK integrity mismatch');
  await writeFile(archive,bytes);
  await execute('tar',['-xf',archive,'-C',work]);
  const go=join(work,'go','bin',process.platform==='win32'?'go.exe':'go');
  const env={...process.env,GOENV:'off',GOROOT:join(work,'go'),GOTOOLCHAIN:'local',CGO_ENABLED:'0',GOWORK:'off',GOFLAGS:'',GOEXPERIMENT:'',GOAMD64:'v1',GOARM64:'v8.0',GOVCS:'*:off',GOINSECURE:'',GOSUMDB:'sum.golang.org',GOPROXY:'https://proxy.golang.org',GONOSUMDB:'',GONOPROXY:'',GOPRIVATE:'',GOPATH:join(work,'gopath'),GOMODCACHE:join(work,'modules'),GOCACHE:join(work,'cache')};
  const run=async(args,options={})=>(await execute(go,args,{env,maxBuffer:4*1024*1024,...options})).stdout;
  if(!(await run(['version'])).startsWith(`go version ${sdkVersion} `))throw new Error('Unexpected Go SDK version');
  return {work,run,env,go};
 }catch(error){await rm(work,{recursive:true,force:true});throw error;}
}

/** Only verified payloads are reused. Builds occur in a private SDK/module/cache directory. */
export async function prepareCompilerAssets(output,{versions=['0.28.2'],targets=COMPILER_TARGETS}={}){
 for(const version of versions)if(!sourceSums[version])throw new Error(`Unreviewed compiler source version: ${version}`);
 for(const target of targets)if(!COMPILER_TARGETS.includes(target))throw new Error(`Unsupported compiler target: ${target}`);
 const recipe=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
 let complete=false;
 try{complete=JSON.parse(await readFile(join(output,'manifest.json'),'utf8')).recipe===recipe;}catch{}
 for(const version of versions)for(const target of targets)try{await compilerPayload(output,version,target);}catch{complete=false;}
 if(complete)return output;
 const sdk=await privateGo();
 try{
  const manifest={version:1,recipe,go:sdkVersion,sys:'v0.44.0',sources:{esbuild:sourceSums,esbuildMod:sourceModSum,sys:sysSum,sysMod:sysModSum},compilers:{}};
  // Existing entries remain reusable only after their payload integrity is independently checked.
  try{
   const prior=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
   if(prior.recipe!==recipe)throw new Error('Compiler recipe changed');
   for(const version of Object.keys(sourceSums))for(const target of COMPILER_TARGETS)try{
    await compilerPayload(output,version,target);(manifest.compilers[version]??={})[target]=prior.compilers[version][target];
   }catch{}
  }catch{}
  for(const version of versions){
   const source=JSON.parse(await sdk.run(['mod','download','-json',`github.com/evanw/esbuild@v${version}`],{cwd:sdk.work}));
   if(source.Sum!==sourceSums[version]||source.GoModSum!==sourceModSum)throw new Error('Compiler source integrity mismatch');
   const cwd=join(sdk.work,`esbuild-${version}`);await cp(source.Dir,cwd,{recursive:true});
   // Module cache sources are read-only; copy-on-write avoids changing downloaded source evidence.
   await writable(cwd);
   await sdk.run(['mod','edit','-go=1.27.0','-require=golang.org/x/sys@v0.44.0'],{cwd});
   const sys=JSON.parse(await sdk.run(['mod','download','-json','golang.org/x/sys@v0.44.0'],{cwd}));
   if(sys.Sum!==sysSum||sys.GoModSum!==sysModSum)throw new Error('Compiler system dependency integrity mismatch');
   for(const target of targets){
    if(manifest.compilers[version]?.[target])continue;
    const [platform,arch]=target.split('-'),file=`${version}/${target}/esbuild${platform==='win32'?'.exe':''}`,destination=join(output,file);
    await mkdir(dirname(destination),{recursive:true});
    await sdk.run(['build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',destination,'./cmd/esbuild'],{cwd,env:{...sdk.env,GOOS:platform==='win32'?'windows':platform,GOARCH:arch==='x64'?'amd64':arch}});
    const bytes=await readFile(destination);
    (manifest.compilers[version]??={})[target]={file,integrity:compilerIntegrity(bytes)};
   }
  }
  await mkdir(output,{recursive:true});
  await writeFile(join(output,'manifest.json.tmp'),JSON.stringify(manifest,null,2)+'\n');
  await rename(join(output,'manifest.json.tmp'),join(output,'manifest.json'));
  return output;
 }finally{await writable(sdk.work);await rm(sdk.work,{recursive:true,force:true});}
}

export const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
