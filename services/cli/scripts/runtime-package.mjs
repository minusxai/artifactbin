/** Build dependency boundary: verified prebuilt bytes only; never invokes a compiler.
 * Pins include URL, compressed and executable SHA-256, and decoded byte length.
 * Producers package a prepared executable; consumers verify before atomic publication.
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,rm,lstat,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=/^[a-f0-9]{64}$/;
const limit=134217728;
export async function downloadRuntime(pin,{root,fetch:fetcher=fetch}) {
 if(!pin||!hash.test(pin.sha256)||(pin.format!=='raw'&&!hash.test(pin.gzipSha256))||!Number.isSafeInteger(pin.size)||pin.size<1||pin.size>limit)throw new Error('Invalid prebuilt runtime pin.');
 const url=new URL(pin.url);
 if(!(pin.format==='raw'?url.origin==='https://nodejs.org'&&/^\/download\/release\/v22\.\d+\.\d+\/win-x64\/node\.exe$/.test(url.pathname):url.origin==='https://github.com'&&url.pathname.startsWith('/minusxai/artifactbin/releases/download/'))||url.username||url.password||url.search||url.hash)throw new Error('Invalid prebuilt runtime URL.');
 const destination=join(root,pin.format==='raw'?'node.exe':'node');
 try{const info=await lstat(destination);if(info.isFile()&&!info.isSymbolicLink()&&info.size===pin.size&&digest(await readFile(destination))===pin.sha256){await chmod(destination,0o755);return destination;}}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const response=await fetcher(pin.url,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error(`Prebuilt runtime download returned HTTP ${response.status}. Run the dedicated CLI runtime workflow and update the runtime pins; ordinary CLI builds do not compile Node.`);
 if(response.url&&new URL(response.url).protocol!=='https:')throw new Error('Prebuilt runtime redirected outside HTTPS.');
 if(Number(response.headers.get('content-length'))>limit||!response.body)throw new Error('Invalid prebuilt runtime download size.');
 const chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.byteLength;if(length>limit)throw new Error('Prebuilt runtime exceeds download limit.');chunks.push(Buffer.from(chunk));}
 const compressed=Buffer.concat(chunks);
 if(digest(compressed)!==(pin.format==='raw'?pin.sha256:pin.gzipSha256))throw new Error('Prebuilt runtime transport checksum mismatch.');
 const bytes=pin.format==='raw'?compressed:gunzipSync(compressed,{maxOutputLength:pin.size});
 if(bytes.length!==pin.size||digest(bytes)!==pin.sha256)throw new Error('Prebuilt runtime executable checksum mismatch.');
 await mkdir(root,{recursive:true,mode:0o700});
 const temporary=join(root,`.node-${randomUUID()}`);
 try{await writeFile(temporary,bytes,{flag:'wx',mode:0o755});await rename(temporary,destination);}
 finally{await rm(temporary,{force:true});}
 return destination;
}
export async function packageRuntime(binary,output) {
 const bytes=await readFile(binary),compressed=gzipSync(bytes,{level:9});
 if(bytes.length>limit)throw new Error('Prepare and strip the runtime before packaging.');
 await writeFile(output,compressed);
 return {sha256:digest(bytes),gzipSha256:digest(compressed),size:bytes.length};
}
