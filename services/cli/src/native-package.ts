import {lstat,mkdtemp,readFile,readlink,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {dirname,join,posix,relative} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {digest,privateDirectory,isMissing} from './files';
import {download} from './release-download';
import {CliError} from './commands';

/** Binary archive = gzip(concatenated file bytes in manifest order), without base64. Browser/runtime archives may carry executable modes and confined links. */
export interface NativePackage {url:string;sha256:string;files:{path:string;size:number;sha256:string;mode?:0o600|0o700;link?:string}[]}
const hash=/^[a-f0-9]{64}$/;
function validate(spec:NativePackage,kind='sql'):number{
 const seen=new Set<string>();let total=0;
 if(!hash.test(spec.sha256)||!spec.files.length||spec.files.length>(kind==='sql'?4096:30000))throw new CliError('invalid_release','Invalid native package manifest.');
 const url=new URL(spec.url);
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw new CliError('invalid_release','Invalid native package manifest URL.');
 for(const file of spec.files){
  if(!file.path.startsWith('node_modules/')||file.path.includes('\\')||file.path.includes('\0')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(file.path)||!hash.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0)throw new CliError('invalid_release','Invalid native package manifest entry.');
  if(file.mode!==undefined&&![0o600,0o700].includes(file.mode))throw new CliError('invalid_release','Invalid native package manifest mode.');
  if(file.link!==undefined){
   const target=posix.resolve('/',posix.dirname(file.path),file.link);
   if(kind==='sql'||!file.link||file.link.startsWith('/')||file.link.includes('\\')||file.link.includes('\0')||!target.startsWith('/node_modules/')||Buffer.byteLength(file.link)!==file.size||digest(file.link)!==file.sha256)throw new CliError('invalid_release','Invalid native package manifest link.');
  }
  seen.add(file.path);total+=file.size;
 }
 for(const file of spec.files)if(file.link!==undefined&&spec.files.some(other=>other.path.startsWith(file.path+'/')))throw new CliError('invalid_release','Invalid native package manifest link parent.');
 if(total<1||total>(kind==='sql'?268435456:1073741824))throw new CliError('invalid_release','Invalid native package manifest size.');
 return total;
}
async function verifyCache(root:string,spec:NativePackage):Promise<boolean>{
 try{const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('directory');}
 catch(error){if(isMissing(error))return false;throw new CliError('invalid_service_cache',`Invalid Service cache: ${root}.`,'Remove this cache directory and retry the command.');}
 try{
  for(const file of spec.files){
   let path=root;
   const parts=file.path.split('/');
   for(const [index,part] of parts.entries()){path=join(path,part);const info=await lstat(path);if(info.isSymbolicLink()&&!(index===parts.length-1&&file.link!==undefined))throw new Error('link');}
   const info=await lstat(path);
   if(file.link!==undefined){
    if(!info.isSymbolicLink()||await readlink(path)!==file.link)throw new Error('link');
    const target=relative(await realpath(root),await realpath(path));
    if(!target.startsWith('node_modules/'))throw new Error('link escape');
   }else if(!info.isFile()||info.size!==file.size||(info.mode&0o777)!==(file.mode??0o600)||digest(await readFile(path))!==file.sha256)throw new Error('checksum');
  }
 }catch{throw new CliError('invalid_service_cache',`Service cache checksum failed: ${root}.`,'Remove this cache directory and retry the command.');}
 return true;
}
/** No process starts or loads native code until all bytes are verified and atomically published. */
export async function ensureNativePackage(spec:NativePackage,options:{root:string;fetch?:typeof fetch;kind?:'sql'|'runtime'|'chromium'}):Promise<string>{
 const total=validate(spec,options.kind),destination=join(options.root,spec.sha256);
 if(await verifyCache(destination,spec))return destination;
 let compressed:Buffer;
 try{compressed=await download(spec.url,options.fetch??fetch,options.kind&&options.kind!=='sql'?536870912:134217728);}
 catch(error){throw new CliError('service_unavailable',`Service package download failed: ${error instanceof Error?error.message:String(error)}`,options.kind==='runtime'?'Connect once and retry preview or serve to cache the runtime for offline use.':`Connect once and run afbin setup --service ${options.kind??'sql'} before using it offline.`);}
 if(digest(compressed)!==spec.sha256)throw new CliError('checksum_mismatch','Service package download checksum mismatch.');
 const bytes=gunzipSync(compressed,{maxOutputLength:total});
 if(bytes.length!==total)throw new CliError('invalid_release','Service package size mismatch.');
 let offset=0;
 for(const file of spec.files){if(digest(bytes.subarray(offset,offset+file.size))!==file.sha256)throw new CliError('checksum_mismatch','Service package file checksum mismatch.');offset+=file.size;}
 await privateDirectory(options.root);
 const staging=await mkdtemp(join(options.root,'.install-'));
 try{
  offset=0;
  for(const file of spec.files){const path=join(staging,file.path);await privateDirectory(dirname(path));if(file.link===undefined)await writeFile(path,bytes.subarray(offset,offset+file.size),{mode:file.mode??0o600,flag:'wx'});offset+=file.size;}
  for(const file of spec.files)if(file.link!==undefined)await symlink(file.link,join(staging,file.path));
  await verifyCache(staging,spec);
  try{await rename(staging,destination);}
  catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
  if(!await verifyCache(destination,spec))throw new CliError('invalid_service_cache','Service cache disappeared during installation.');
  return destination;
 }finally{await rm(staging,{recursive:true,force:true});}
}
