/** Standalone Node 22 entry bundled into the installed and downloadable skill. */
import {readFile} from 'node:fs/promises';
import {credentialLocation,credentialRequest,credentialPaths,saveCredentials} from './credentials';
import {credentialHelperRoot} from './credential-helper-config';
async function main():Promise<void>{
 const [command,...args]=process.argv.slice(2);const flags:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!key?.startsWith('--')||value===undefined||!['--origin','--path','--method','--account','--body-file'].includes(key))throw new Error('Use path|save|request --origin <origin> [--path /api/...] [--method GET] [--account <id>] [--body-file <file>].');flags[key]=value;}
 const origin=flags['--origin'];if(!origin)throw new Error('--origin is required.');const root=credentialHelperRoot();
 if(command==='path'){process.stdout.write(JSON.stringify(await credentialLocation(origin,root))+'\n');return;}
 if(command==='save'){
  const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Expected OAuth credential JSON on stdin.');}
  if(!data||typeof data.access_token!=='string'||typeof data.refresh_token!=='string'||typeof data.client_id!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw new Error('Expected OAuth access_token, refresh_token, client_id and positive expires_in on stdin.');
  await saveCredentials({server:origin,token:data.access_token,refreshToken:data.refresh_token,clientId:data.client_id,expiresAt:Date.now()+data.expires_in*1000},root);
  process.stdout.write(JSON.stringify(await credentialLocation(origin,root))+'\n');return;
 }
 if(command==='request'){
  const path=flags['--path'];if(!path)throw new Error('--path is required.');
  const response=await credentialRequest(origin,root,path,{method:flags['--method'],account:flags['--account'],body:flags['--body-file']?await readFile(flags['--body-file'],'utf8'):undefined});
  process.stdout.write(await response.text());if(!response.ok)process.exitCode=1;return;
 }
 // Validate origins even when showing a bad command, without reading any stored credentials.
 credentialPaths(origin,root);throw new Error('Use path, save or request.');
}
main().catch(error=>{process.stderr.write((error instanceof Error?error.message:'Credential helper failed.')+'\n');process.exitCode=1;});
