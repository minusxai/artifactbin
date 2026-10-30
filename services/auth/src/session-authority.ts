/** Auth-owned RPC, mounted before browser/session resolution and the public internal-path refusal. */
import {timingSafeEqual} from 'node:crypto';
import {HUMAN_SESSION_LIVE_PATH,SERVICE_AUTH_HEADER,type Part} from '@artifactbin/contracts';
import {BodyTooLargeError,readBody} from '@artifactbin/utils';
import type {AuthEnv,AuthOptions} from './parts';
import {readEnv} from './env';
export function sessionAuthority(o:AuthOptions):Part<AuthEnv>{return {name:'sessionAuthority',mount:app=>{
 const secret=readEnv(o.env,'INTERNAL__SERVICE_SECRET');
 app.all(HUMAN_SESSION_LIVE_PATH,async c=>{
  const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  if(c.req.method!=='POST')return answer({error:'method_not_allowed'},405);
  const provided=Buffer.from(c.req.header(SERVICE_AUTH_HEADER)??''),expected=Buffer.from(secret??'');
  if(!expected.length||provided.length!==expected.length||!timingSafeEqual(provided,expected))return answer({error:'unauthorized'},401);
  let body:unknown;
  try{body=JSON.parse(await readBody(c.req.raw,{limit:8192,as:'text'}));}catch(e){return answer({error:e instanceof BodyTooLargeError?'too_large':'bad_request'},e instanceof BodyTooLargeError?413:400);}
  const input=body as {sessionId?:unknown;userId?:unknown}|null;
  if(!input||typeof input.sessionId!=='string'||!input.sessionId||typeof input.userId!=='string'||!input.userId)return answer({error:'bad_request'},400);
  try{return answer({live:await o.sessions.live?.(input.sessionId,input.userId)??false});}catch{return answer({error:'session_unavailable'},503);}
 });
}};}
