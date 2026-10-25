import path from 'node:path';
import {mkdir,readFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runTool,ToolError,serverOrigin,selectedServer,credentialRoot,platform,jsonFile,exclusive,requireFlags,positional,makeClient} from './toolbox-client.mjs';
export async function authCommand({sub,values,positionals},{env=process.env,fetcher=fetch}={}){
 positional(positionals,0);const server=serverOrigin(selectedServer(values,env)),root=credentialRoot(env),shared=await platform();
 if(sub==='status'){const saved=await shared.readCredentials(server,root);return {server,authenticated:!!(env.ARTIFACTBIN_URL===server&&env.ARTIFACTBIN_TOKEN||saved),source:env.ARTIFACTBIN_URL===server&&env.ARTIFACTBIN_TOKEN?'environment':saved?'private-store':'none',expired:saved?.expiresAt?Date.now()>=saved.expiresAt:null};}
 if(sub==='logout'){const location=shared.credentialPaths(server,root);await shared.withStateLock(root,'home',()=>shared.withStateLock(root,'@credential-refresh',()=>unlink(location.backingPath).catch(error=>{if(error.code!=='ENOENT')throw error;})));return {server,localGrantRemoved:true,serverRevoked:false,environmentGrantStillActive:!!(env.ARTIFACTBIN_URL===server&&env.ARTIFACTBIN_TOKEN),note:'No self-revocation endpoint is provided; local logout does not revoke the server grant.'};}
 const client=makeClient(server,{env,fetcher});
 if(values.email){
  if(values.challenge||values['code-file']||!/^\S+@\S+\.\S+$/.test(values.email))throw new ToolError('invalid_login','Use --email ADDRESS alone to initiate sign-in.',2);
  await client.request('/api/auth/email-otp/send-verification-otp',{method:'POST',body:{email:values.email,type:'sign-in'},authenticated:false});
  const handle=randomUUID(),directory=path.join(root,'challenges');await mkdir(directory,{recursive:true,mode:0o700});await exclusive(path.join(directory,handle+'.json'),JSON.stringify({server,email:values.email,createdAt:Date.now()}));
  return {server,challenge:handle,next:'Wait for the user-provided OTP, then auth.mjs login --challenge HANDLE --code-file FILE.'};
 }
 requireFlags(values,['challenge','code-file']);if(!/^[a-f0-9-]{36}$/.test(values.challenge))throw new ToolError('invalid_challenge','Use the private handle returned by login.',2);
 const file=path.join(root,'challenges',values.challenge+'.json'),challenge=await jsonFile(file);
 if(challenge.server!==server||Date.now()-challenge.createdAt>30*60*1000)throw new ToolError('challenge_expired','Challenge origin or lifetime does not match.',3,'Start sign-in again.');
 const code=(await readFile(values['code-file'],'utf8')).trim();if(!/^\d{4,12}$/.test(code))throw new ToolError('invalid_code','OTP file must contain the user-provided numeric code.',2);
 const response=await client.request('/api/auth/sign-in/email-otp',{method:'POST',body:{email:challenge.email,otp:code},authenticated:false,raw:true});
 const cookies=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');if(!cookies)throw new ToolError('session_missing','Sign-in returned no session cookie.',1);
 const tokenResponse=await client.request('/api/authentication/token',{method:'POST',body:{},headers:{Cookie:cookies},authenticated:false});
 if(typeof tokenResponse.access_token!=='string'||typeof tokenResponse.refresh_token!=='string'||typeof tokenResponse.client_id!=='string'||!Number.isFinite(tokenResponse.expires_in))throw new ToolError('invalid_grant_response','Sign-in grant was incomplete.',1);
 await shared.saveCredentials({server,token:tokenResponse.access_token,refreshToken:tokenResponse.refresh_token,clientId:tokenResponse.client_id,expiresAt:Date.now()+tokenResponse.expires_in*1000},root);await unlink(file);
 return {server,authenticated:true};
}
await runTool('auth',import.meta.url,authCommand);
