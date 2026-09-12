import {API_RESOURCE_PATH,CLI_PROTOCOL_VERSION} from '@artifactbin/contracts';
import {homedir} from 'node:os';
import {CliError} from './commands';
import {loadConnection,saveConnection,normalizeServer,type Connection} from './config';
export interface HttpOptions {connection:Connection;home?:string;env?:NodeJS.ProcessEnv;fetch?:typeof fetch;readOnly?:boolean;account?:string;authenticate?:()=>Promise<Connection>}
export class HttpClient {
 connection:Connection;
 account?:string;
 constructor(private options:HttpOptions){this.connection={...options.connection,server:normalizeServer(options.connection.server)};this.account=options.account;}
 async request<T=Record<string,unknown>>(path:string,method='GET',body?:unknown,headers:Record<string,string>={},options:{timeoutMs?:number;readOnly?:boolean;signal?:AbortSignal}={}):Promise<T>{
  return this.perform(path,method,body,headers,false,options.timeoutMs,options.readOnly,apiUrl,options.signal) as Promise<T>;
 }
 async content(path:string,method='GET',body?:unknown):Promise<{bytes:Buffer;contentType:string}>{
  return this.perform(path,method,body,{},true) as Promise<{bytes:Buffer;contentType:string}>;
 }
 /**
  * The viewer routes under /a/<id> — the rendered image and the standalone page — serve bytes
  * the API surface has no equivalent for. Same origin, same credential, same refusal handling:
  * one transport, addressed at the other half of the server's own URL space.
  */
 async view(path:string,timeoutMs=60000):Promise<{bytes:Buffer;contentType:string}>{
  return this.perform(path,'GET',undefined,{},true,timeoutMs,true,viewerUrl) as Promise<{bytes:Buffer;contentType:string}>;
 }
 private async perform(path:string,method:string,body:unknown,headers:Record<string,string>,binary:boolean,timeoutMs=30000,readOnly=false,address:(path:string,server:string)=>URL=apiUrl,signal?:AbortSignal):Promise<unknown>{
  const url=address(path,this.connection.server);
  if(this.options.readOnly&&!['GET','HEAD'].includes(method)&&url.pathname!=='/api/artifacts/preflight')throw new CliError('unsupported_dry_run','This request has no read-only preflight.');
  let refreshed=false,authenticated=false;
  for(let attempt=0;attempt<3;attempt++){
   let response:Response;
   try{response=await (this.options.fetch??fetch)(url.toString(),{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),headers:{
    ...headers,Authorization:`Bearer ${this.connection.token}`,'X-Artifactbin-Protocol':String(CLI_PROTOCOL_VERSION),
    ...(body!==undefined?{'Content-Type':'application/json'}:{}),...(this.account?{'X-Artifactbin-Account':this.account}:{}),
    ...(this.options.readOnly?{'X-Artifactbin-Dry-Run':'1'}:{}),
   },...(body!==undefined?{body:JSON.stringify(body)}:{})});}
   catch(error){
    if(signal?.aborted)throw new CliError('cancelled','The request was cancelled.');
    if(readOnly||['GET','HEAD','DELETE'].includes(method))throw transportFailure(this.connection.server,error);
    throw new CliError('outcome_unknown',`The ${method} request to ${this.connection.server} did not return a confirmed response (${transportFailure(this.connection.server,error).message}).`);
   }
   if(response.status===401){
    if(!this.options.readOnly&&!refreshed&&this.connection.refreshToken&&this.connection.clientId){
     refreshed=true;try{await this.refresh();continue;}catch(error){if(!(error instanceof CliError)||error.code!=='auth_required')throw error;}
    }
    if(!this.options.readOnly&&!authenticated&&this.options.authenticate){
     authenticated=true;const next=await this.options.authenticate();
     if(normalizeServer(next.server)!==this.connection.server)throw new CliError('wrong_server','Browser authentication returned a different server origin.');
     this.connection=next;continue;
    }
    throw new CliError('auth_required','auth_required: sign-in is required.','Run afbin auth, or set ARTIFACTBIN_TOKEN for the selected server.',{http_status:401});
   }
   const account=response.headers.get('X-Artifactbin-Account');
   if(account){if(this.account&&this.account!==account)throw new CliError('account_mismatch','The server account differs from this workspace.','Use the workspace account credentials.');this.account=account;}
   if(response.ok&&binary)return{bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('Content-Type')??'application/octet-stream'};
   const data=method==='HEAD'?{}:await response.json().catch(()=>null);
   if(!response.ok){
    const code=typeof data?.error==='string'?data.error:`http_${response.status}`;
    throw new CliError(code,`${code}: ${data?.message??response.statusText??'request refused'}`,typeof data?.hint==='string'?data.hint:typeof data?.recovery==='string'?data.recovery:undefined,{...data,http_status:response.status,...(response.headers.has('X-Artifactbin-Mutation-Receipt')?{mutation_receipt:response.headers.get('X-Artifactbin-Mutation-Receipt')}:{})},response.status===409?3:1);
   }
   if(!data||typeof data!=='object')throw new CliError('invalid_response','The server returned an incomplete JSON response.','Keep pending recovery state before retrying a write.');
   return data;
  }
  throw new CliError('auth_required','Run afbin auth to sign in again.',undefined,{http_status:401});
 }
 private async refresh():Promise<void>{
  // The lock dependency is loaded only for credential mutation, never local help or validation.
  const {withProcessLock}=await import('./process-lock');
  const home=this.options.home??homedir();
  await withProcessLock(home,async()=>{
   const saved=await loadConnection(this.connection.server,home,{ARTIFACTBIN_HOME:this.options.env?.ARTIFACTBIN_HOME});
   if(saved&&saved.token!==this.connection.token&&saved.refreshToken&&saved.clientId===this.connection.clientId){this.connection=saved;return;}
   const response=await(this.options.fetch??fetch)(`${this.connection.server}/oauth/token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',client_id:this.connection.clientId,refresh_token:this.connection.refreshToken,resource:`${this.connection.server}${API_RESOURCE_PATH}`})});
   const data=await response.json().catch(()=>null);
   if(!response.ok||typeof data?.access_token!=='string'||typeof data?.refresh_token!=='string'||!Number.isFinite(data?.expires_in)||data.expires_in<=0)throw new CliError('auth_required','auth_required: credentials could not be refreshed.','Run afbin auth again.');
   this.connection={...this.connection,token:data.access_token,refreshToken:data.refresh_token,expiresAt:Date.now()+data.expires_in*1000};
   await saveConnection(this.connection,home,{ARTIFACTBIN_HOME:this.options.env?.ARTIFACTBIN_HOME});
  });
 }
}

/** The refusal for a request that never reached the server: the cause, and the origin the caller can fix. */
export function transportFailure(server:string,error:unknown):CliError{
 const cause=error instanceof Error&&error.cause instanceof Error?error.cause.message:error instanceof Error?error.message:String(error);
 return new CliError('transport_error',`Cannot reach ${server} (${cause}).`);
}

/** The HTTP status behind a server refusal, for callers that key reconnect behaviour on it. */
export function httpStatus(error:unknown):number|undefined{
 const status=error instanceof CliError&&error.details&&typeof error.details==='object'?(error.details as {http_status?:unknown}).http_status:undefined;
 return typeof status==='number'?status:undefined;
}

export function apiUrl(path:string,server:string):URL{
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||path.includes('#'))throw new CliError('invalid_api_path','Use an API path beginning with /; full URLs are not allowed.');
  const url=new URL(path.startsWith('/api/')?path:`/api${path}`,server);
  if(url.origin!==server||!url.pathname.startsWith('/api/'))throw new CliError('invalid_api_path','The path must remain inside the selected server API.');
 return url;
}

export function viewerUrl(path:string,server:string):URL{
  if(!path.startsWith('/a/')||path.includes('\\')||path.includes('#'))throw new CliError('invalid_view_path','Use a viewer path beginning with /a/.');
  const url=new URL(path,server);
  if(url.origin!==server||!url.pathname.startsWith('/a/'))throw new CliError('invalid_view_path','The path must remain inside the selected server.');
 return url;
}
