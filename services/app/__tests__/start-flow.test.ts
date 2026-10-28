/** Native browser creation and tokenless handoff use the original account and publication API. */
import {describe,expect,it} from 'vitest';
import {POST as startRoute} from '@/app/api/start/route';
import {POST as createBrowserArtifact} from '@/app/api/my/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {GET as eventsRoute} from '@/app/a/[id]/events/route';
import {GET as frameRoute} from '@/app/a/[id]/events/frame/route';
import {getArtifactById} from '@/lib/artifacts';
import {existingPaste} from '@/lib/serving';
import {createUser} from '@/lib/accounts';
import {artifactStarter} from '@/lib/workspace/artifact-starters';
import {mintAccountToken,request,useAppHarness} from './harness';
const harness=useAppHarness(),params=(id:string)=>({params:Promise.resolve({id})});
const native=(text:string)=>`<!doctype html><html><head><title>Report</title></head><body><h1>${text}</h1></body></html>`;

describe('native start flow',()=>{
 it('creates private HTML starters owned by the signed-in account without saved setup UI',async()=>{
  const user=await createUser({email:'starters@example.test'}),actor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true};
  for(const type of ['doc','deck'] as const){
   const response=await createBrowserArtifact(request('/api/my/artifacts',{method:'POST',actor,json:artifactStarter(type)}));expect(response.status).toBe(201);
   const row=(await getArtifactById((await response.json()).id))!;
   expect(row).toMatchObject({format:'html',user_id:user.id,visibility:'private'});
   expect(row.source).toContain('<!doctype html>');expect(row.source).toContain('data-af-id=');
   expect(row.source).not.toMatch(/<Markdown|Copy agent instructions|Waiting for your agent/);
  }
 });
 it('normal and explicit blank starts create readable native pages with tokenless HTTP instructions',async()=>{
  const account=await mintAccountToken('start');
  for(const path of ['/api/start','/api/start?mode=blank']){
   const response=await startRoute(request(path,{method:'POST',token:account.token}));expect(response.status).toBe(201);
   const body=await response.json();expect(Object.keys(body).sort()).toEqual(['edit_id','id','prompt','url']);
   expect(body.url).toBe(`http://localhost:3000/a/${body.id}`);expect(body.url).not.toContain('/edit');
   expect(body.prompt).toBe(existingPaste('http://localhost:3000',body.id));expect(body.prompt).toContain('/llms.txt');
   expect(body.prompt).not.toMatch(/afbin |npx |mx_|\/tokens\/new/);expect(response.headers.get('set-cookie')).toBeNull();
   const page=await read(request(`/api/artifacts/${body.id}`,{token:account.token}),params(body.id));expect(page.status).toBe(200);
   const head=await page.json();expect(head.format).toBe('html');expect(head.html).toContain('Untitled document');
  }
 });
 it('session creation stamps account ownership and does not issue a browser credential',async()=>{
  const user=await createUser({email:'start-owner@example.test'});
  const response=await startRoute(request('/api/start',{method:'POST',actor:{credential:'session',userId:user.id,email:user.email!,emailVerified:true}}));
  expect(response.status).toBe(201);expect(response.headers.get('set-cookie')).toBeNull();
  expect((await getArtifactById((await response.json()).id))!.user_id).toBe(user.id);
 });
 it('refuses signed-out starts without creating any artifact or cookie',async()=>{
  const response=await startRoute(request('/api/start',{method:'POST'}));expect(response.status).toBe(401);expect(response.headers.get('set-cookie')).toBeNull();
  expect((await(await harness.db()).query('SELECT id FROM artifacts')).rows).toHaveLength(0);
 });
 it('the first native replacement reaches a watching reader and rejects a stale second write',async()=>{
  const account=await mintAccountToken('native-edit');const doc=await(await startRoute(request('/api/start',{method:'POST',token:account.token}))).json();
  const head=await(await read(request(`/api/artifacts/${doc.id}`,{token:account.token}),params(doc.id))).json();
  const actor={credential:'session' as const,userId:account.userId!,email:'watcher@example.test'};
  const stream=await eventsRoute(request(`/a/${doc.id}/events`,{actor}),params(doc.id));expect(stream.status).toBe(200);
  const reader=stream.body!.getReader(),frames:Record<string,unknown>[]=[],decoder=new TextDecoder();
  const pump=(async()=>{const deadline=Date.now()+3000;while(frames.length<2&&Date.now()<deadline){const part=await Promise.race([reader.read(),new Promise<{done:true,value:undefined}>(resolve=>setTimeout(()=>resolve({done:true,value:undefined}),Math.max(1,deadline-Date.now())))]);if(part.done||!part.value)break;for(const line of decoder.decode(part.value).split('\n\n'))if(line.startsWith('data: '))frames.push(JSON.parse(line.slice(6)));}})();
  const body={html:native('Q3 revenue is up 12%.'),expectedVersion:head.version,expectedState:head.state};
  const send=()=>replace(request(`/api/artifacts/${doc.id}`,{method:'PUT',token:account.token,json:body}),params(doc.id));
  expect((await send()).status).toBe(200);await pump;void reader.cancel().catch(()=>{});
  expect(frames.at(-1)?.version).toBe(2);expect((await send()).status).toBe(409);
  const frame=await(await frameRoute(request(`/a/${doc.id}/events/frame`,{actor}),params(doc.id))).json();expect(frame.version).toBe(2);
  const updated=await(await read(request(`/api/artifacts/${doc.id}`,{token:account.token}),params(doc.id))).json();expect(updated.html).toContain('Q3 revenue is up 12%.');
 });
 it('one existing account credential can create several pages without minting another token',async()=>{
  const account=await mintAccountToken('one-agent');for(let i=0;i<2;i++)expect((await startRoute(request('/api/start',{method:'POST',token:account.token}))).status).toBe(201);
  expect((await(await harness.db()).query('SELECT id FROM tokens')).rows).toHaveLength(1);
 });
});
