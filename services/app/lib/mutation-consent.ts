import {randomBytes} from 'node:crypto';
import {effectiveRole,getArtifactById,runDocumentMutation,type ArtifactRow} from './artifacts';
import {claimByHash,issueCode,peekByHash} from './codes';
import {CONTROLS_ORIGIN,PUBLIC_BASE_URL} from './config';
import {baseUrl,json} from './http';
import {parseJsx} from './jsx';
import {canRead} from './share-roles';
import {splitHelmet} from './story/helmet';
import type {MutationRequest} from './story/mutation-request';
import {requestOrSessionActor,type RequestActor} from './viewer';

const KIND='mutation-consent';
interface Pending {
  document:string; editId:string; input:MutationRequest;
  sessionId:string; userId:string|null; tokenId:string|null; credential:string;
}
const identity=(actor:RequestActor)=>({sessionId:actor.sessionId!,userId:actor.viewer?.userId??null,tokenId:actor.tokenId,credential:actor.credential});
const matches=(pending:Pending,actor:RequestActor)=>Object.entries(identity(actor)).every(([k,v])=>pending[k as keyof Pending]===v);
const headers={'Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const escape=(value:unknown)=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/** One server-stored operation, not a reusable grant. Uses app-owned codes;
 * the browser never supplies SQL or chooses a different target at approval. */
export async function issueMutationConsent(doc: ArtifactRow, input: MutationRequest, actor: RequestActor): Promise<string> {
  if(!actor.sessionId || !['session','agent-cookie'].includes(actor.credential)) throw new Error('Trusted browser session required');
  const code=randomBytes(32).toString('base64url');
  await issueCode({kind:KIND,secret:code,ttlMs:5*60_000,payload:{document:doc.id,editId:doc.edit_id,input,...identity(actor)}});
  return `${CONTROLS_ORIGIN}/mutation-consent/${code}`;
}
export async function mutationConsentPage(request: Request, code: string): Promise<Response> {
  const refuse=(error:string,status:number)=>json({error},status,headers);
  if(!CONTROLS_ORIGIN || baseUrl(request)!==CONTROLS_ORIGIN) return refuse('trusted_host_required',403);
  if(request.method==='POST' && request.headers.get('origin')!==CONTROLS_ORIGIN) return refuse('browser_origin_required',403);
  const actor=await requestOrSessionActor(request);
  if(!actor.sessionId || !['session','agent-cookie'].includes(actor.credential) || !/^[A-Za-z0-9_-]{43}$/.test(code)) return refuse('not_found',404);
  const pending=await peekByHash({kind:KIND,code}) as Pending|null;
  if(!pending || !matches(pending,actor)) return refuse('not_found',404);
  const doc=await getArtifactById(pending.document);
  const roleActor={userId:actor.viewer?.userId??null,tokenId:actor.tokenId,email:actor.viewer?.email};
  if(!doc || !canRead(await effectiveRole(doc,roleActor))) return refuse('not_found',404);
  if(doc.edit_id!==pending.editId) return refuse('document_changed',409);
  if(request.method==='POST'){
    if((await request.formData()).get('approve')!=='yes') return refuse('approval_required',400);
    // Consuming before execution guarantees at most one attempt. A failed or
    // unknown outcome never retries automatically; a new attempt needs review.
    if(!await claimByHash({kind:KIND,code})) return refuse('not_found',404);
    const input=pending.input;
    const result=await runDocumentMutation(doc,input.mutation,input.values??{},input.row,roleActor,input.localTables);
    if(!result.ok) return refuse(result.reason,result.reason==='document_changed'?409:result.reason==='contended'?503:403);
    return new Response(null,{status:303,headers:{...headers,Location:`${new URL(PUBLIC_BASE_URL).origin}/a/${doc.id}`}});
  }
  const parsed=parseJsx(doc.source??'');
  const declaration=parsed.ok?splitHelmet(parsed.nodes).content.mutations.find(m=>m.name===pending.input.mutation):null;
  if(!declaration || declaration.scope==='local') return refuse('not_found',404);
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Review dataset change</title><style>body{font:16px system-ui;margin:3rem auto;padding:0 1.25rem;max-width:44rem;line-height:1.5;color:#172033;background:#f8fafc}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e2e8f0;padding:1rem;border-radius:.5rem}button,a{display:inline-block;padding:.65rem 1rem}button{background:#1d4ed8;color:white;border:0;border-radius:.4rem;font:inherit}small{color:#475569}</style></head><body><main><small>Artifactbin · trusted approval</small><h1>Review dataset change</h1><p>Document: <strong>${escape(doc.title??doc.id)}</strong></p><p>Target dataset: <strong>${escape(declaration.target)}</strong></p><p>This approves one operation, not future writes. Current permissions are checked again before committing.</p><pre>${escape(declaration.sql)}</pre><h2>Submitted values</h2><pre>${escape(JSON.stringify({values:pending.input.values??{},row:pending.input.row??null},null,2))}</pre><form method="post"><button name="approve" value="yes" type="submit">Approve this change</button><a href="${escape(new URL(PUBLIC_BASE_URL).origin+'/a/'+doc.id)}">Cancel</a></form></main></body></html>`;
  // Chromium applies form-action to the 303 destination as well as the POST.
  // Admit only this operation's server-owned return document, not arbitrary URLs.
  return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8',
    'Content-Security-Policy':headers['Content-Security-Policy'].replace("form-action 'self'",`form-action 'self' ${new URL(PUBLIC_BASE_URL).origin}/a/${doc.id}`)}});
}
