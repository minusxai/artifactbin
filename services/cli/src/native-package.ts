import {lstat,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {digest,privateDirectory,isMissing} from './files';
import {download} from './release-download';
import {CliError} from './commands';

/** Binary archive = gzip(concatenated file bytes in manifest order), without base64 or executable links. */
export interface NativePackage {url:string;sha256:string;files:{path:string;size:number;sha256:string}[]}
const hash=/^[a-f0-9]{64}$/;
function validate(spec:NativePackage):number{
 const seen=new Set<string>();let total=0;
 if(!hash.test(spec.sha256)||!spec.files.length||spec.files.length>4096)throw new CliError('invalid_release','Invalid native package manifest.');
 const url=new URL(spec.url);
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw new CliError('invalid_release','Invalid native package manifest URL.');
 for(const file of spec.files){
  if(!file.path.startsWith('node_modules/')||file.path.includes('\\')||file.path.includes('\0')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(file.path)||!hash.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0)throw new CliError('invalid_release','Invalid native package manifest entry.');
  seen.add(file.path);total+=file.size;
 }
 if(total<1||total>268435456)throw new CliError('invalid_release','Invalid native package manifest size.');
 return total;
}
async function verifyCache(root:string,spec:NativePackage):Promise<boolean>{
 try{const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('directory');}
 catch(error){if(isMissing(error))return false;throw new CliError('invalid_service_cache',`Invalid SQL service cache: ${root}.`,'Remove this cache directory and run afbin setup --service sql again.');}
 try{
  for(const file of spec.files){
   let path=root;
   const parts=file.path.split('/');
   for(const part of parts){path=join(path,part);const info=await lstat(path);if(info.isSymbolicLink())throw new Error('link');}
   const info=await lstat(path);if(!info.isFile()||info.size!==file.size||digest(await readFile(path))!==file.sha256)throw new Error('checksum');
  }
 }catch{throw new CliError('invalid_service_cache',`SQL service cache checksum failed: ${root}.`,'Remove this cache directory and run afbin setup --service sql again.');}
 return true;
}
/** No process starts or loads native code until all bytes are verified and atomically published. */
export async function ensureNativePackage(spec:NativePackage,options:{root:string;fetch?:typeof fetch}):Promise<string>{
 const total=validate(spec),destination=join(options.root,spec.sha256);
 if(await verifyCache(destination,spec))return destination;
 let compressed:Buffer;
 try{compressed=await download(spec.url,options.fetch??fetch,134217728);}
 catch(error){throw new CliError('service_unavailable',`SQL service download failed: ${error instanceof Error?error.message:String(error)}`,'Connect once and run afbin setup --service sql before using local queries offline.');}
 if(digest(compressed)!==spec.sha256)throw new CliError('checksum_mismatch','SQL service download checksum mismatch.');
 const bytes=gunzipSync(compressed,{maxOutputLength:total});
 if(bytes.length!==total)throw new CliError('invalid_release','SQL service size mismatch.');
 let offset=0;
 for(const file of spec.files){if(digest(bytes.subarray(offset,offset+file.size))!==file.sha256)throw new CliError('checksum_mismatch','SQL service file checksum mismatch.');offset+=file.size;}
 await privateDirectory(options.root);
 const staging=await mkdtemp(join(options.root,'.install-'));
 try{
  offset=0;
  for(const file of spec.files){const path=join(staging,file.path);await privateDirectory(dirname(path));await writeFile(path,bytes.subarray(offset,offset+file.size),{mode:0o600,flag:'wx'});offset+=file.size;}
  try{await rename(staging,destination);}
  catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
  if(!await verifyCache(destination,spec))throw new CliError('invalid_service_cache','SQL service cache disappeared during installation.');
  return destination;
 }finally{await rm(staging,{recursive:true,force:true});}
}
