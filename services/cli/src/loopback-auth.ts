import {API_RESOURCE_PATH,ARTIFACT_SCOPE} from '@artifactbin/contracts';
/** Loopback callback carries only a single-use PKCE code, never bearer credentials. */
import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {homedir} from 'node:os';
import {normalizeServer,saveConnection,type Connection} from './config';
import {CliError} from './commands';

interface Options {home?:string;env?:NodeJS.ProcessEnv;fetch?:typeof fetch;open:(url:string)=>Promise<void>;notify?:(message:string)=>void;timeoutMs?:number}
export async function loopbackAuthenticate(origin:string,options:Options):Promise<Connection>{
 const server=normalizeServer(origin);const verifier=randomBytes(32).toString('base64url');const state=randomBytes(32).toString('base64url');
 let accept!:(code:string)=>void;let refuse!:(error:Error)=>void;
 const completed=new Promise<string>((resolve,reject)=>{accept=resolve;refuse=reject;});
 // Register a rejection observer before browser startup; cleanup may reject early.
 void completed.catch(()=>{});
 let consumed=false;let redirectUri='';
 const listener=createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','text/plain; charset=utf-8');response.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  const url=new URL(request.url??'/',redirectUri);
  const supplied=url.searchParams.get('state')??'';
  if(request.method!=='GET'||request.headers.host!==new URL(redirectUri).host||url.pathname!=='/callback'||Buffer.byteLength(supplied)!==Buffer.byteLength(state)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(state))){response.writeHead(400).end('Invalid callback. Return to the approval page.');return;}
  if(consumed){response.writeHead(409).end('This approval was already received.');return;}
  if(url.searchParams.has('error')){consumed=true;response.end('Connection was not approved. You may close this tab.');refuse(new CliError('access_denied','Browser approval was denied.'));return;}
  const code=url.searchParams.get('code');
  if(!code||code.length>2048){response.writeHead(400).end('Missing authorization code.');return;}
  consumed=true;response.end('Approval received. Return to your terminal.');accept(code);
 });
 await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{listener.off('error',reject);resolve();});});
 const address=listener.address();if(!address||typeof address==='string')throw new Error('Loopback listener did not bind');
 redirectUri=`http://127.0.0.1:${address.port}/callback`;
 const timer=setTimeout(()=>refuse(new CliError('approval_expired','Browser approval timed out.','Run afbin setup again.')),Math.min(options.timeoutMs??300000,300000));
 const post=async(path:string,body:Record<string,unknown>)=>{
  const response=await(options.fetch??fetch)(`${server}${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data||typeof data!=='object')throw new CliError('auth_failed',`Browser authentication failed (HTTP ${response.status}).`,'Run afbin setup again.');
  return data as Record<string,unknown>;
 };
 try{
  const registered=await post('/oauth/register',{client_name:'artifactbin CLI',redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});
  if(typeof registered.client_id!=='string'||!registered.client_id)throw new CliError('invalid_response','Registration did not return a client id.');
  const authorize=new URL('/oauth/authorize',server);
  authorize.search=new URLSearchParams({client_id:registered.client_id,redirect_uri:redirectUri,response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state,scope:ARTIFACT_SCOPE,resource:`${server}${API_RESOURCE_PATH}`}).toString();
  options.notify?.(`Approve artifactbin in your browser: ${authorize}`);
  try{await options.open(authorize.toString());}catch{options.notify?.('Could not open the browser. Open the approval URL above.');}
  const code=await completed;
  const token=await post('/oauth/token',{grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:redirectUri,code,code_verifier:verifier,resource:`${server}${API_RESOURCE_PATH}`});
  if(typeof token.access_token!=='string'||typeof token.refresh_token!=='string'||typeof token.expires_in!=='number'||token.expires_in<=0)throw new CliError('invalid_response','Token exchange returned incomplete credentials.');
  const connection:Connection={server,token:token.access_token,refreshToken:token.refresh_token,clientId:registered.client_id,expiresAt:Date.now()+token.expires_in*1000};
  await saveConnection(connection,options.home??homedir(),{ARTIFACTBIN_HOME:options.env?.ARTIFACTBIN_HOME});return connection;
 }finally{clearTimeout(timer);listener.closeAllConnections();await new Promise<void>(resolve=>listener.close(()=>resolve()));}
}
