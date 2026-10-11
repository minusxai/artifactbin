import {homedir} from 'node:os';
import {CliError} from './commands';
import {normalizeServer,type Connection} from './config';
import {deviceAuthenticate,type AuthOptions} from './browser-auth';
import {transportFailure} from './http';
import {withLock} from './state';
import {CODE_DELIVERY_HEADER,codeDeliveryOf} from '@artifactbin/contracts';

/** Two-step OTP login. The web session exists only in memory, to approve the normal CLI grant. */
export async function emailAuthenticate(origin:string,email:string,otp:string|undefined,options:Pick<AuthOptions,'home'|'env'|'fetch'|'aliases'>):Promise<Connection>{
 const server=normalizeServer(origin);const request=options.fetch??fetch;
 const retry=`Run afbin auth --server ${server} --email <email>`;
 const post=async(path:string,body:unknown,cookie?:string)=>request(`${server}${path}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{'Content-Type':'application/json',Origin:server,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),
 }).catch(error=>{throw transportFailure(server,error);});
 if(!otp){
  const response=await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'});
  if(!response.ok)throw new CliError('otp_send_failed',`Could not send the email login code (HTTP ${response.status}).`,retry+' to try again.');
  const delivery=codeDeliveryOf(response.headers.get(CODE_DELIVERY_HEADER));
  const source=delivery==='operator_outbox'?'Ask the server operator for the code from the protected local outbox or server output.':delivery==='email'?'Ask the user for the emailed code.':'Ask the user or server operator for the code.';
  throw new CliError('otp_required',delivery==='operator_outbox'?'A login code was written to the server operator’s local outbox.':delivery==='email'?'A login code was sent to your email.':'A login code was requested.',source+' '+retry+' --otp <code>.');
 }
 const home=options.home??homedir();
 return withLock(home,`auth:${server}`,async()=>{
  const response=await post('/api/auth/sign-in/email-otp',{email,otp});
  if(!response.ok){
   const body=await response.json().catch(()=>null) as {error?:unknown}|null;
   if(response.status===403&&body?.error==='deployment_admission_required')throw new CliError('deployment_admission_required','The company deployment did not admit this email.','Ask the operator to invite this email to the company group, confirm company setup, and check its allowed email policy.');
   throw new CliError('otp_rejected',`Email login was refused (HTTP ${response.status}).`,'Check the code and email, or request a new code. '+retry+'.');
  }
  const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  if(!cookie)throw new CliError('invalid_response','Email login returned no session.');
  try{
   // Reuse the origin-checked pairing and credential persistence boundary. No OS browser is involved.
   return await deviceAuthenticate(server,{...options,home,resume:false,interactive:false,notify:()=>{},open:async raw=>{
    const url=new URL(raw);
    const approval=await request(`${server}/oauth/device/approve`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:server,Cookie:cookie},body:new URLSearchParams({user_code:url.searchParams.get('user_code')??'',decision:'approve'})}).catch(error=>{throw transportFailure(server,error);});
    if(!approval.ok)throw new CliError('auth_failed',`Email login could not approve the CLI connection (HTTP ${approval.status}).`,retry+'.');
   }});
  }finally{
   // Revoke the temporary human session; the independently issued CLI refresh grant remains valid.
   await post('/api/auth/sign-out',{},cookie).catch(()=>{});
  }
 });
}
