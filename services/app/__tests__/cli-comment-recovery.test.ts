import {it,expect} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {GET as readArtifact} from '@/app/api/artifacts/[id]/route';
import {POST as createComment,GET as listComments} from '@/app/api/artifacts/[id]/annotations/route';
import {POST as updateComment} from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import {mintToken} from '@/lib/tokens';
import {runCli} from '../../cli/src/dispatch';
import {saveConnection} from '../../cli/src/config';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
useAppHarness();
it('comment creation and reply recover lost responses without adding duplicate messages',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-comment-receipt-'));
 try{
  const token=await mintToken('mxmx_test_cli_comment_receipt');await saveConnection({server:'http://localhost:3000',token:token.token},root);
  const made=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Review this finding</p>'}}));expect(made.status).toBe(201);const artifact=await made.json();const ctx={params:Promise.resolve({id:artifact.id})};
  let lose=true;const keys:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
   const req=new Request(input,init),path=new URL(req.url).pathname;
   if(req.method==='GET')return readArtifact(req,ctx);
   keys.push(req.headers.get('Idempotency-Key')!);
   const response=path.endsWith('/annotations')?await createComment(req,ctx):await updateComment(req,{params:Promise.resolve({id:artifact.id,annId:path.split('/').at(-1)!})});
   if(lose){lose=false;throw Error('lost committed comment response');}return response;
  };
  const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli(['comment',artifact.id,...args,'--json'],{cwd:root,home:root,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:fetcher});return {code,result:JSON.parse(out.join(''))};};
  const args=['--quote','Review this finding','--body','Explain'];expect((await invoke(args)).result.error.code).toBe('outcome_unknown');
  const recovered=await invoke(args);expect(recovered.code,JSON.stringify(recovered)).toBe(0);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0]);
  lose=true;const reply=['--thread',recovered.result.id,'--body','Done','--state','resolved'];expect((await invoke(reply)).result.error.code).toBe('outcome_unknown');expect((await invoke(reply)).code).toBe(0);
  const listed=await listComments(request(`/api/artifacts/${artifact.id}/annotations?status=all`,{token:token.token}),ctx);const result=await listed.json();expect(result.annotations).toHaveLength(1);expect(result.annotations[0].thread).toHaveLength(2);expect(result.annotations[0].status).toBe('resolved');
 }finally{await rm(root,{recursive:true,force:true});}
});
