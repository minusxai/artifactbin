/** CI-only registry for real npm setup of the exact, not-yet-published candidate.
 * Only @afbin/cli is overridden; npm still obtains pinned dependencies normally.
 * No product installer seam, modified package bytes, or mocked npm command.
 */
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';

export function candidateManifest(bytes){
 const tar=gunzipSync(bytes);
 for(let offset=0;offset+512<=tar.length;){
  const header=tar.subarray(offset,offset+512);
  const name=header.subarray(0,100).toString().replace(/\0.*$/s,'');
  if(!name)break;
  const size=parseInt(header.subarray(124,136).toString().replace(/\0.*$/s,'').trim(),8);
  if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)throw Error('Invalid candidate tar manifest boundary');
  if(name==='package/package.json'){
   const manifest=JSON.parse(tar.subarray(offset+512,offset+512+size).toString());
   if(manifest.name!=='@afbin/cli'||typeof manifest.version!=='string')throw Error('Expected @afbin/cli candidate manifest');
   return manifest;
  }
  offset+=512+Math.ceil(size/512)*512;
 }
 throw Error('Candidate package manifest missing');
}
export async function startCandidateRegistry(bytes){
 const manifest=candidateManifest(bytes);
 const server=createServer((request,response)=>{
  const path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  if(path==='/@afbin/cli'){
   const dist={tarball:`http://127.0.0.1:${server.address().port}/candidate.tgz`,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),shasum:createHash('sha1').update(bytes).digest('hex')};
   response.writeHead(200,{'Content-Type':'application/json'});
   response.end(JSON.stringify({name:manifest.name,'dist-tags':{latest:manifest.version},versions:{[manifest.version]:{...manifest,dist}}}));
  }else if(path==='/candidate.tgz'){
   response.writeHead(200,{'Content-Type':'application/octet-stream'});response.end(bytes);
  }else{response.writeHead(404);response.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {origin:`http://127.0.0.1:${server.address().port}`,version:manifest.version,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [tarball,ready]=process.argv.slice(2);
 const registry=await startCandidateRegistry(await readFile(tarball));
 await writeFile(ready,JSON.stringify({origin:registry.origin,version:registry.version}));
}
