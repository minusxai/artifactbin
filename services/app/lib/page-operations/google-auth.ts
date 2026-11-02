import {createHash,createPrivateKey,sign,type KeyObject} from 'node:crypto';
import {parseWebUrl,requestWebHop,WebIngestError,type WebIngestPolicy} from '@/lib/web-ingest';

/** `caps.fetch(url, {auth})`: the one built-in auth. The named secret holds a Google service-account JSON key. */
export interface GoogleAuth {type:'google';secret:string;scopes:readonly string[]}
/** Whose token: a token is never shared across owners, resolvers, secret names, keys or scope sets. */
export interface GoogleTokenScope {owner:string;resolver:string;secret:string;scopes:readonly string[]}
export interface GoogleTokenSourceOptions {
 /** Fixed; never the key's own `token_uri`, which would let a key choose where its signed assertion goes. */
 tokenUrl?:string;
 policy:WebIngestPolicy;
 now?:()=>number;
 maxEntries?:number;
}
/** A fixed code a resolver may see; never a key, assertion, token or Google's error body. */
export class GoogleAuthFailure extends Error {
 readonly code:string;
 constructor(code:string){super(code);this.name='GoogleAuthFailure';this.code=code;}
}

const GOOGLE_TOKEN_URL='https://oauth2.googleapis.com/token';
/** Production allowlist for the bearer, on top of the secret's own host binding. */
export const isGoogleApiHost=(hostname:string)=>hostname.endsWith('.googleapis.com');
const LIFETIME_S=3600,REFRESH_MARGIN_MS=60_000;
const SECRET_NAME=/^[A-Z][A-Z0-9_]{0,63}$/,SCOPE=/^[\x21-\x7e]{1,256}$/,MAX_SCOPES=32;
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** The validated `auth` option with its scopes sorted and de-duplicated, or null when it is malformed. */
export function googleAuthOption(value:unknown):GoogleAuth|null{
 if(!isObject(value)||Object.keys(value).some(k=>k!=='type'&&k!=='secret'&&k!=='scopes'))return null;
 const {type,secret,scopes}=value;
 if(type!=='google'||typeof secret!=='string'||!SECRET_NAME.test(secret))return null;
 if(!Array.isArray(scopes)||!scopes.length||scopes.length>MAX_SCOPES||scopes.some(s=>typeof s!=='string'||!SCOPE.test(s)))return null;
 return {type,secret,scopes:[...new Set(scopes as string[])].sort()};
}

interface ServiceAccount {email:string;keyId?:string;key:KeyObject}
function serviceAccount(value:string):ServiceAccount{
 const invalid=()=>new GoogleAuthFailure('auth_key_invalid');
 let parsed:unknown;try{parsed=JSON.parse(value);}catch{throw invalid();}
 if(!isObject(parsed))throw invalid();
 const {client_email:email,private_key:pem,private_key_id:keyId}=parsed;
 if(typeof email!=='string'||!/^[^\s@]{1,128}@[^\s@]{1,255}$/.test(email)||typeof pem!=='string')throw invalid();
 if(keyId!==undefined&&(typeof keyId!=='string'||!/^[\w-]{1,128}$/.test(keyId)))throw invalid();
 let key:KeyObject;try{key=createPrivateKey(pem);}catch{throw invalid();}
 if(key.asymmetricKeyType!=='rsa')throw invalid();
 return {email,key,...(keyId?{keyId}:{})};
}
const segment=(value:object)=>Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Mints Google access tokens for service-account keys: an RS256 JWT signed here, exchanged at the fixed token
 * endpoint under the caller's address policy and deadline. Tokens are cached per (owner, resolver, secret name,
 * key hash, scope set) until a minute before they expire; concurrent callers share one exchange, and failures
 * are never cached. The caller reads the key on every request, so a deleted or rotated key takes effect at once.
 */
export function createGoogleTokenSource(options:GoogleTokenSourceOptions){
 const tokenUrl=options.tokenUrl??GOOGLE_TOKEN_URL;
 const now=options.now??Date.now;
 const maxEntries=options.maxEntries??1000;
 const cache=new Map<string,{token:Promise<string>;expiresAt:number|null}>();
 function admit(id:string,entry:{token:Promise<string>;expiresAt:number|null}){
  if(cache.size>=maxEntries)for(const [k,v] of cache)if(v.expiresAt!==null&&v.expiresAt-REFRESH_MARGIN_MS<=now())cache.delete(k);
  while(cache.size>=maxEntries)cache.delete(cache.keys().next().value!);
  cache.set(id,entry);
 }
 async function exchange(account:ServiceAccount,scopes:readonly string[],deadline:number):Promise<{token:string;expiresAt:number}>{
  const issuedAt=Math.floor(now()/1000);
  const unsigned=`${segment({alg:'RS256',typ:'JWT',...(account.keyId?{kid:account.keyId}:{})})}.${segment({iss:account.email,scope:scopes.join(' '),aud:tokenUrl,iat:issuedAt,exp:issuedAt+LIFETIME_S})}`;
  const assertion=`${unsigned}.${sign('sha256',Buffer.from(unsigned),account.key).toString('base64url')}`;
  const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString();
  let res;
  try{
   res=await requestWebHop(parseWebUrl(tokenUrl,options.policy),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json','accept-encoding':'identity','user-agent':'artifactbin-resolver/1'},body,policy:options.policy,deadline,maxBytes:65536,readBody:status=>status===200});
  }catch(e){throw new GoogleAuthFailure(e instanceof WebIngestError&&e.code==='timeout'?'timeout':'auth_failed');}
  if(res.status!==200)throw new GoogleAuthFailure('auth_failed');
  let answer:unknown;try{answer=JSON.parse(new TextDecoder().decode(res.bytes));}catch{throw new GoogleAuthFailure('auth_failed');}
  if(!isObject(answer))throw new GoogleAuthFailure('auth_failed');
  const {access_token:token,expires_in:expiresIn,token_type:type}=answer;
  if(typeof token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(token)||typeof expiresIn!=='number'||!(expiresIn>0)||(type!==undefined&&(typeof type!=='string'||type.toLowerCase()!=='bearer')))throw new GoogleAuthFailure('auth_failed');
  return {token,expiresAt:issuedAt*1000+expiresIn*1000};
 }
 return {
  /** An access token for `scope`, minted from `keyValue` (the secret's current value) on a cache miss. */
  token(scope:GoogleTokenScope,keyValue:string,deadline:number):Promise<string>{
   const id=JSON.stringify([scope.owner,scope.resolver,scope.secret,[...new Set(scope.scopes)].sort(),createHash('sha256').update(keyValue).digest('base64url')]);
   const hit=cache.get(id);
   if(hit&&(hit.expiresAt===null||now()<hit.expiresAt-REFRESH_MARGIN_MS))return hit.token;
   let account:ServiceAccount;
   try{account=serviceAccount(keyValue);}catch(e){return Promise.reject(e);}
   const entry:{token:Promise<string>;expiresAt:number|null}={token:Promise.resolve(''),expiresAt:null};
   entry.token=exchange(account,[...new Set(scope.scopes)].sort(),deadline).then(({token,expiresAt})=>{
    if(cache.get(id)===entry){if(expiresAt-REFRESH_MARGIN_MS>now())entry.expiresAt=expiresAt;else cache.delete(id);}
    return token;
   },e=>{if(cache.get(id)===entry)cache.delete(id);throw e;});
   admit(id,entry);
   return entry.token;
  },
 };
}
