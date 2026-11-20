/** Native browser creation and tokenless handoff use the original account and publication API. */
import {describe,expect,it} from 'vitest';
import {POST as startRoute} from '@/app/api/start/route';
import {POST as createBrowserArtifact} from '@/app/api/my/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {GET as eventsRoute} from '@/app/a/[id]/events/route';
import {GET as frameRoute} from '@/app/a/[id]/events/frame/route';
import {getArtifactById} from '@/lib/artifacts';
import { existingPaste } from '@/lib/agent-copy';
import { createUser } from '@/lib/accounts';
import {artifactStarter} from '@/lib/workspace/artifact-starters';
import {mintAccountToken,request,useAppHarness} from './harness';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {setDefaultHtmlSystem,setInstallationDesignSystem} from '@/lib/html-systems';
import {readInstallationDesignSystem} from '@/lib/html-systems/server';
const harness=useAppHarness(),params=(id:string)=>({params:Promise.resolve({id})});
const native=(text:string)=>`<!doctype html><html><head><title>Report</title></head><body><h1>${text}</h1></body></html>`;

describe('native start flow',()=>{
 it('starts a New document in the server\'s default design system, and leaves every other body as sent',async()=>{
  // The Harbor fixture (lib/html-systems/__tests__/fixtures/harbor), read as the boot reads APP__DESIGN_SYSTEM_DIR.
  setInstallationDesignSystem(readInstallationDesignSystem(path.resolve('lib/html-systems/__tests__/fixtures/harbor')));
  try{
   const user=await createUser({email:'starter-design@example.test'}),actor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true};
   const create=async(json:unknown)=>{const response=await createBrowserArtifact(request('/api/my/artifacts',{method:'POST',actor,json}));expect(response.status).toBe(201);return (await getArtifactById((await response.json()).id))!.source!;};
   expect(await create(artifactStarter('doc'))).toMatch(/<meta name="artifactbin:design-system" content="harbor"[ >]/);
   const written=artifactStarter('doc');written.html=written.html.replace('<h1></h1>','<h1>Mine</h1>');
   expect(await create(written)).toMatch(/<meta name="artifactbin:design-system" content="meridian"[ >]/);
   expect(await create(artifactStarter('deck'))).not.toContain('artifactbin:design-system');
   // A built-in named as the default (APP__DEFAULT_DESIGN_SYSTEM) starts it the same way.
   setDefaultHtmlSystem('graphite');
   expect(await create(artifactStarter('doc'))).toMatch(/<meta name="artifactbin:design-system" content="graphite"[ >]/);
   setInstallationDesignSystem(null);
   expect(await create(artifactStarter('doc'))).toMatch(/<meta name="artifactbin:design-system" content="graphite"[ >]/);
   setDefaultHtmlSystem(null);
   expect(await create(artifactStarter('doc'))).toMatch(/<meta name="artifactbin:design-system" content="meridian"[ >]/);
  }finally{setInstallationDesignSystem(null);setDefaultHtmlSystem(null);}
  expect(readFileSync(path.resolve('lib/html-systems/__tests__/fixtures/harbor/system.json'),'utf8')).toContain('"slug": "harbor"');
 });
 it('creates HTML starters owned by the signed-in account without saved setup UI: a doc unlisted, the rest private',async()=>{
  const user=await createUser({email:'starters@example.test'}),actor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true};
  for(const type of ['doc','deck'] as const){
   const response=await createBrowserArtifact(request('/api/my/artifacts',{method:'POST',actor,json:artifactStarter(type)}));expect(response.status).toBe(201);
   const row=(await getArtifactById((await response.json()).id))!;
   expect(row).toMatchObject({format:'html',user_id:user.id,visibility:type==='doc'?'unlisted':'private'});
   expect(row.source).toContain('<!doctype html>');expect(row.source).toContain('data-af-id=');
   expect(row.source).not.toMatch(/<Markdown|Copy agent instructions|Waiting for your agent/);
  }
 });
 it('the agent start creates a readable native page with tokenless HTTP instructions',async()=>{
  const account=await mintAccountToken('start');
  {
   const response=await startRoute(request('/api/start',{method:'POST',token:account.token}));expect(response.status).toBe(201);
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
  // Frames until the version-2 one (a missing one fails at the test's timeout, or below when the stream ends first).
  const pump=(async()=>{let text='';while(!frames.some(frame=>frame.version===2)){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true});const blocks=text.split('\n\n');text=blocks.pop()!;for(const block of blocks)for(const line of block.split('\n'))if(line.startsWith('data: '))frames.push(JSON.parse(line.slice(6)));}})();
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
