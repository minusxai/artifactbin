/** Durable filesystem credentials for CLI and direct HTTP clients; no environment reads. */
import {createHash} from 'node:crypto';
import {lstat,readFile,readlink,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {normalizeOrigin,API_RESOURCE_PATH} from '@artifactbin/contracts';
import {atomicWrite} from './atomic-file';
import {privateDirectory} from './private-directory';
import {withStateLock} from './state-lock';
export interface Credentials {server:string;token:string;refreshToken?:string;clientId?:string;expiresAt?:number}
export function credentialOrigin(value:string):string{
 const origin=normalizeOrigin(value);if(!origin)throw new Error('Use an HTTPS server origin, or HTTP on a local development host (localhost, 127.0.0.1, [::1], *.localhost, *.lvh.me, *.test).');return origin;
}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function credentialPaths(server:string,root:string){
 const origin=credentialOrigin(server),url=new URL(origin);
 // URL normalizes IDN and default ports. Encode IPv6 colons/brackets and unsafe filesystem bytes.
 let hostname=encodeURIComponent(url.hostname).replace(/\.+$/,dots=>'%2E'.repeat(dots.length));
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(hostname))hostname='%'+hostname.charCodeAt(0).toString(16).toUpperCase()+hostname.slice(1);
 const protocol=url.protocol.slice(0,-1),port=url.port||(protocol==='https'?'443':'80');
 const folder=protocol==='https'&&port==='443'?hostname:`${hostname}@${protocol}-${port}`;
 const directory=join(root,'hosts',folder),backingDirectory=join(root,'hosts',digest(origin).slice(0,16));
 return {origin,directory,path:join(directory,'credentials.env'),backingDirectory,backingPath:join(backingDirectory,'credentials.env')};
}
async function projection(server:string,root:string,create=false):Promise<ReturnType<typeof credentialPaths>>{
 const paths=credentialPaths(server,root);
 try{const backing=await lstat(paths.backingDirectory);if(!backing.isDirectory()||backing.isSymbolicLink())throw new Error('Unsafe credential backing directory.');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 try{
  const info=await lstat(paths.directory);
  if(!info.isSymbolicLink()||resolve(paths.directory,'..',await readlink(paths.directory))!==resolve(paths.backingDirectory))throw new Error('Unsafe credential origin projection: expected the legacy backing directory.');
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  if(create){
   await privateDirectory(join(root,'hosts'));
   try{await symlink(process.platform==='win32'?resolve(paths.backingDirectory):paths.backingDirectory.split(/[\\/]/).pop()!,paths.directory,process.platform==='win32'?'junction':'dir');}
   catch(error){
    const code=(error as NodeJS.ErrnoException).code;
    if(code==='EEXIST')return projection(server,root,false);
    // A Windows account without link privileges still uses the exact legacy store; never copy a grant.
    if(!['EPERM','EACCES','ENOTSUP'].includes(code??''))throw error;
   }
  }
 }
 return paths;
}
export async function credentialLocation(server:string,root:string){
 const paths=await projection(server,root);let readable=false;
 try{readable=(await lstat(paths.directory)).isSymbolicLink();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return {...paths,path:readable?paths.path:paths.backingPath,readable};
}
export async function readCredentials(server:string,root:string):Promise<Credentials|null>{
 const paths=await projection(server,root);const saved:Record<string,string>={};
 try{if(!(await lstat(paths.backingPath)).isFile())throw new Error('Expected a private credential file.');for(const line of(await readFile(paths.backingPath,'utf8')).split(/\r?\n/)){
  const match=line.match(/^\s*(?:export\s+)?(ARTIFACTBIN_URL|ARTIFACTBIN_TOKEN|ARTIFACTBIN_REFRESH_TOKEN|ARTIFACTBIN_CLIENT_ID|ARTIFACTBIN_EXPIRES_AT)\s*=\s*(.*?)\s*$/);
  if(match?.[1]&&match[2]!==undefined)saved[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');
 }}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(saved.ARTIFACTBIN_URL!==paths.origin||!saved.ARTIFACTBIN_TOKEN)return null;
 const expiresAt=Number(saved.ARTIFACTBIN_EXPIRES_AT);
 return {server:paths.origin,token:saved.ARTIFACTBIN_TOKEN,...(saved.ARTIFACTBIN_REFRESH_TOKEN&&saved.ARTIFACTBIN_CLIENT_ID?{refreshToken:saved.ARTIFACTBIN_REFRESH_TOKEN,clientId:saved.ARTIFACTBIN_CLIENT_ID,...(Number.isSafeInteger(expiresAt)&&expiresAt>0?{expiresAt}:{})}:{})};
}
export async function saveCredentials(connection:Credentials,root:string):Promise<void>{
 return withStateLock(root,'home',()=>writeCredentials(connection,root));
}
async function writeCredentials(connection:Credentials,root:string):Promise<void>{
 const paths=await projection(connection.server,root);
 if(!/^[A-Za-z0-9_-]+$/.test(connection.token))throw new Error('Invalid token format');
 for(const value of[connection.refreshToken,connection.clientId])if(value!==undefined&&!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('Invalid refresh credential format');
 if(connection.expiresAt!==undefined&&(!Number.isSafeInteger(connection.expiresAt)||connection.expiresAt<=0))throw new Error('Invalid credential expiry');
 await privateDirectory(paths.backingDirectory);
 const profilePath=join(paths.backingDirectory,'profile.json');let profile:Record<string,unknown>={url:paths.origin};
 try{profile={...JSON.parse(await readFile(profilePath,'utf8')),url:paths.origin};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if((profile.credentialAccount as {credential?:string}|undefined)?.credential!==digest(connection.token))delete profile.credentialAccount;
 await atomicWrite(profilePath,JSON.stringify(profile,null,2)+'\n');
 const values={ARTIFACTBIN_URL:paths.origin,ARTIFACTBIN_TOKEN:connection.token,ARTIFACTBIN_REFRESH_TOKEN:connection.refreshToken,ARTIFACTBIN_CLIENT_ID:connection.clientId,ARTIFACTBIN_EXPIRES_AT:connection.expiresAt};
 await atomicWrite(paths.backingPath,Object.entries(values).filter(([,value])=>value!==undefined).map(([key,value])=>`${key}=${value}\n`).join(''));
 await projection(connection.server,root,true);
}
export async function observedCredentialAccount(connection:Credentials,root:string):Promise<{account:string;observedAt:string}|null>{
 const paths=await projection(connection.server,root);
 try{const value=JSON.parse(await readFile(join(paths.backingDirectory,'profile.json'),'utf8')).credentialAccount;
 return value?.credential===digest(connection.token)&&typeof value.account==='string'&&typeof value.observedAt==='string'?{account:value.account,observedAt:value.observedAt}:null;
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
export async function observeCredentialAccount(connection:Credentials,account:string,root:string):Promise<void>{
 const paths=await projection(connection.server,root);await privateDirectory(paths.backingDirectory);
 const path=join(paths.backingDirectory,'profile.json');let profile:Record<string,unknown>={url:paths.origin};
 try{profile=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 await atomicWrite(path,JSON.stringify({...profile,credentialAccount:{account,credential:digest(connection.token),observedAt:new Date().toISOString()}},null,2)+'\n');
}
export class CredentialRefreshError extends Error {}
export class CredentialRefreshUnavailableError extends Error {
 constructor(message:string,readonly status?:number){super(message);}
}
export async function refreshCredentials(connection:Credentials,root:string,options:{fetch?:typeof fetch}={}):Promise<Credentials>{
 return withStateLock(root,'home',()=>withStateLock(root,'@credential-refresh',async()=>{
  const saved=await readCredentials(connection.server,root);
  if(saved&&saved.token!==connection.token&&saved.refreshToken&&saved.clientId===connection.clientId)return saved;
  if(!connection.refreshToken||!connection.clientId)throw new CredentialRefreshError('auth_required: credentials could not be refreshed.');
  const origin=credentialOrigin(connection.server);
  const response=await(options.fetch??fetch)(`${origin}/oauth/token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',client_id:connection.clientId,refresh_token:connection.refreshToken,resource:`${origin}${API_RESOURCE_PATH}`})}).catch(()=>{throw new CredentialRefreshUnavailableError('refresh_unavailable: the refresh server could not be reached. Retry later; the saved grant was retained.');});
  const data=await response.json().catch(()=>null) as {access_token?:unknown;refresh_token?:unknown;expires_in?:number;error?:unknown}|null;
  if(!response.ok){
   if(response.status<500&&response.status!==429&&['invalid_grant','invalid_client','revoked_token'].includes(String(data?.error)))throw new CredentialRefreshError('auth_required: credentials could not be refreshed.');
   throw new CredentialRefreshUnavailableError(`refresh_unavailable: refresh failed (HTTP ${response.status}). Retry later; the saved grant was retained.`,response.status);
  }
  if(typeof data?.access_token!=='string'||typeof data?.refresh_token!=='string'||typeof data?.expires_in!=='number'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw new CredentialRefreshUnavailableError('refresh_unavailable: the refresh server returned an incomplete response. Retry later; the saved grant was retained.',response.status);
  const expiresAt=Date.now()+data.expires_in*1000;
  if(!/^[A-Za-z0-9_-]+$/.test(data.access_token)||!/^[A-Za-z0-9_-]+$/.test(data.refresh_token)||!Number.isSafeInteger(expiresAt))throw new CredentialRefreshUnavailableError('refresh_unavailable: the refresh server returned invalid credentials. Retry later; the saved grant was retained.',response.status);
  const refreshed={...connection,server:origin,token:data.access_token,refreshToken:data.refresh_token,expiresAt};
  await saveCredentials(refreshed,root);return refreshed;
 },{reentrant:false}));
}
/** HTTP fallback shares the CLI's grant, lock and binding; secrets never enter URLs. */
export async function credentialRequest(server:string,root:string,path:string,options:{method?:string;body?:string;account?:string;fetch?:typeof fetch}={}):Promise<Response>{
 const origin=credentialOrigin(server);if(!path.startsWith('/api/')||path.includes('\\')||path.includes('#'))throw new Error('Use a path inside /api/.');
 const url=new URL(path,origin);if(url.origin!==origin||!url.pathname.startsWith('/api/'))throw new Error('Use a path inside /api/.');
 let connection=await readCredentials(origin,root);if(!connection)throw new Error('auth_required: no saved credentials for this origin.');
 const transport=options.fetch??fetch;
 const observed=await observedCredentialAccount(connection,root);
 if(options.account&&observed&&options.account!==observed.account)throw new Error('account_mismatch: saved credentials belong to another account.');
 const account=options.account??observed?.account;
 for(let attempt=0;attempt<2;attempt++){
  const headers:Record<string,string>={Authorization:`Bearer ${connection.token}`};if(options.body!==undefined)headers['Content-Type']='application/json';
  if(account)headers['X-Artifactbin-Account']=account;
  const response=await transport(url,{method:options.method??'GET',headers,body:options.body,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(response.status===401&&attempt===0&&connection.refreshToken&&connection.clientId){await response.body?.cancel();connection=await refreshCredentials(connection,root,{fetch:transport});continue;}
  const actual=response.headers.get('X-Artifactbin-Account');if(response.ok&&account&&actual&&actual!==account)throw new Error('account_mismatch: the response belongs to another account.');
  if(response.ok&&actual)try{await observeCredentialAccount(connection,actual,root);}catch{/* Advisory observations never change a confirmed outcome. */}
  return response;
 }
 throw new Error('auth_required: sign in again.');
}
