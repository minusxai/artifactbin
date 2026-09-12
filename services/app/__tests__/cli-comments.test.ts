/**
 * The REAL CLI and the REAL annotation routes: comments by quote and by node, deletion, paging,
 * and the journal that lets an interrupted comment finish on the repeated command.
 */
import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { cliWorkspace } from './cli-harness';
import { mintToken } from '@/lib/tokens';
import { createUser, claimToken } from '@/lib/users';
import { createArtifact, getArtifactFor } from '@/lib/artifacts';
import * as annotations from '@/app/api/artifacts/[id]/annotations/route';
import { POST as createComment, GET as listComments } from '@/app/api/artifacts/[id]/annotations/route';
import { DELETE as removeComment, POST as updateComment } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as readArtifact } from '@/app/api/artifacts/[id]/route';

useAppHarness();

it('creates agent comments by unambiguous quote without editing the document, and refuses ambiguous quotes',async()=>{
 const token=await mintToken('comments');const actor={tokenId:token.id,userId:null};
 const row=await createArtifact(token.id,null,{title:'comments',format:'markup',content:'',source:'<div id="container"><p id="first">One unique sentence.</p><p id="second">Repeated</p><p id="third">Repeated</p></div>',meta:{}});
 const post=(annotations as unknown as {POST:typeof annotations.GET}).POST;expect(post).toBeTypeOf('function');
 const call=(body:Record<string,unknown>)=>post(request(`/api/artifacts/${row.id}/annotations`,{method:'POST',token:token.token,json:body}),{params:Promise.resolve({id:row.id})});
 const made=await call({quote:'unique sentence',body:'Clarify this'});expect(made.status).toBe(201);expect((await made.json()).anchor.nodeId).toBe('first');
 const after=await getArtifactFor(actor,row.id);expect(after?.source).toBe(row.source);expect(after?.version).toBe(row.version);
 const ambiguous=await call({quote:'Repeated',body:'Which one?'});expect(ambiguous.status).toBe(400);expect((await ambiguous.json()).error).toBe('ambiguous_quote');
 const outsider=await mintToken('outsider');const denied=await post(request(`/api/artifacts/${row.id}/annotations`,{method:'POST',token:outsider.token,json:{node_id:'first',body:'No'}}),{params:Promise.resolve({id:row.id})});expect(denied.status).toBe(404);
});

it('pages comment threads in creation order with a bounded database read',async()=>{
 const token=await mintToken('comment-pages');
 const row=await createArtifact(token.id,null,{title:'pages',format:'markup',content:'',source:'<p id="paragraph">Text</p>',meta:{}});
 const ctx={params:Promise.resolve({id:row.id})};
 for(let i=0;i<3;i++)expect((await createComment(request(`/api/artifacts/${row.id}/annotations`,{method:'POST',token:token.token,json:{node_id:'paragraph',body:String(i)}}),ctx)).status).toBe(201);
 let cursor:string|undefined;const bodies:string[]=[];
 do{
  const response=await listComments(request(`/api/artifacts/${row.id}/annotations?limit=1`+(cursor?'&cursor='+cursor:''),{token:token.token}),ctx);
  expect(response.status).toBe(200);const page=await response.json();expect(page.annotations).toHaveLength(1);bodies.push(page.annotations[0].thread[0].body);cursor=page.next_cursor;
 }while(cursor);
 expect(bodies).toEqual(['0','1','2']);
});

/** The bearer comment DELETE door mirrors the browser door's ACL: account-claimed governors only. */
it('deletes a thread for an account-claimed owner, refuses anonymous tokens and outsiders, and answers 404 on repeat',async()=>{
 const user=await createUser({email:'mxmx_test_comment_delete@example.com'});
 const token=await mintToken('mxmx_test_comment_delete');await claimToken(user.id,token.token);
 const row=await createArtifact(token.id,user.id,{title:'delete',format:'markup',content:'',source:'<p id="paragraph">Text</p>',meta:{}});
 const ctx={params:Promise.resolve({id:row.id})};
 const made=await createComment(request(`/api/artifacts/${row.id}/annotations`,{method:'POST',token:token.token,json:{node_id:'paragraph',body:'Remove me'}}),ctx);expect(made.status).toBe(201);
 const annId=(await made.json()).id as string;
 const annCtx={params:Promise.resolve({id:row.id,annId})};
 const anonymous=await mintToken('mxmx_test_comment_anon');
 expect((await removeComment(request(`/api/artifacts/${row.id}/annotations/${annId}`,{method:'DELETE',token:anonymous.token}),annCtx)).status).toBe(403);
 const outsider=await createUser({email:'mxmx_test_comment_outsider@example.com'});const outsiderToken=await mintToken('mxmx_test_comment_outsider');await claimToken(outsider.id,outsiderToken.token);
 expect((await removeComment(request(`/api/artifacts/${row.id}/annotations/${annId}`,{method:'DELETE',token:outsiderToken.token}),annCtx)).status).toBe(404);
 expect((await removeComment(request(`/api/artifacts/${row.id}/annotations/${annId}`,{method:'DELETE',token:token.token}),annCtx)).status).toBe(200);
 expect((await removeComment(request(`/api/artifacts/${row.id}/annotations/${annId}`,{method:'DELETE',token:token.token}),annCtx)).status).toBe(404);
 const listed=await listComments(request(`/api/artifacts/${row.id}/annotations`,{token:token.token}),ctx);expect((await listed.json()).annotations).toHaveLength(0);
});

it('comment creation and reply recover lost responses without adding duplicate messages',async()=>{
 const cli=await cliWorkspace('comment-receipt',{env:{}});
 try{
  const token=await cli.connect('mxmx_test_cli_comment_receipt');
  const made=await createArtifactRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Review this finding</p>'}}));expect(made.status).toBe(201);const artifact=await made.json();const ctx={params:Promise.resolve({id:artifact.id})};
  let lose=true;const keys:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
   const req=new Request(input,init),path=new URL(req.url).pathname;
   if(req.method==='GET')return readArtifact(req,ctx);
   keys.push(req.headers.get('Idempotency-Key')!);
   const response=path.endsWith('/annotations')?await createComment(req,ctx):await updateComment(req,{params:Promise.resolve({id:artifact.id,annId:path.split('/').at(-1)!})});
   if(lose){lose=false;throw Error('lost committed comment response');}return response;
  };
  const invoke=(args:string[])=>cli.run(['comment',artifact.id,...args],fetcher);
  const args=['--quote','Review this finding','--body','Explain'];expect((await invoke(args)).result.error.code).toBe('outcome_unknown');
  const recovered=await invoke(args);expect(recovered.code,JSON.stringify(recovered)).toBe(0);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0]);
  lose=true;const reply=['--thread',recovered.result.id,'--body','Done','--state','resolved'];expect((await invoke(reply)).result.error.code).toBe('outcome_unknown');expect((await invoke(reply)).code).toBe(0);
  const listed=await listComments(request(`/api/artifacts/${artifact.id}/annotations?status=all`,{token:token.token}),ctx);const result=await listed.json();expect(result.annotations).toHaveLength(1);expect(result.annotations[0].thread).toHaveLength(2);expect(result.annotations[0].status).toBe('resolved');
 }finally{await cli.cleanup();}
});
