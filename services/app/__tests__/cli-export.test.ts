/**
 * Export through the REAL handlers. Image and HTML exports leave the CLI as ordinary reads of
 * the viewer routes — `/a/<id>/export` and `/a/<id>/raw` — so what is proved here is that the
 * CLI addresses the routes the way the product serves them (format, slide, access), that a
 * draft is never uploaded for rendering, and that data formats never reach the network at all.
 * Rasterization itself is the browser contract's business; this uses the BrowserService fake.
 */
import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness} from './harness';
import {fakeBrowser} from '@artifactbin/utils';
import type {RenderRequest} from '@artifactbin/contracts';
import {setServices} from '@/lib/services';
import {resetExportRenderer} from '@/lib/export';
import {mintToken} from '@/lib/tokens';
import {createUser} from '@/lib/users';
import {GET as exportImage} from '@/app/a/[id]/export/route';
import {GET as serveRaw} from '@/app/a/[id]/raw/route';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace,PATCH as metadata} from '@/app/api/artifacts/[id]/route';
import {GET as content} from '@/app/api/artifacts/[id]/content/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
import {runCli} from '../../cli/src/dispatch';
import {tracking} from '../../cli/test/tracking';
import {saveConnection} from '../../cli/src/config';
import {parseDocument,writeDocument} from '../../cli/src/document';

const EXPORT_BYTES=new Uint8Array([0x89,0x50,0x4e,0x47,0x45,0x58,0x50,0x4f,0x52,0x54]);
useAppHarness();
let browser=fakeBrowser({ok:true,mime:'image/png',bytes:EXPORT_BYTES});
beforeEach(async()=>{await resetExportRenderer();browser=fakeBrowser({ok:true,mime:'image/png',bytes:EXPORT_BYTES});setServices({browser});});
afterEach(async()=>{setServices({});await resetExportRenderer();});

/** Both halves of the server's URL space: the bearer API and the viewer routes the CLI renders through. */
function transportFor(calls:string[]):typeof fetch{
 return async(input,init)=>{
  const request=new Request(input,init);const url=new URL(request.url);calls.push(`${request.method} ${url.pathname}${url.search}`);
  const view=url.pathname.match(/^\/a\/([^/]+)\/(export|raw)$/);
  if(view)return (view[2]==='export'?exportImage:serveRaw)(request,{params:Promise.resolve({id:view[1]})});
  if(url.pathname==='/api/artifacts')return create(request);
  if(url.pathname==='/api/artifacts/preflight')return preflight(request);
  const match=url.pathname.match(/^\/api\/artifacts\/([^/]+)(\/edits|\/content)?$/);if(!match)throw new Error(`Unexpected route ${url.pathname}`);
  const context={params:Promise.resolve({id:match[1]})};
  if(match[2]==='/content')return content(request,context);
  return match[2]?edit(request,context):request.method==='GET'?read(request,context):request.method==='PATCH'?metadata(request,context):replace(request,context);
 };
}

// Unlisted, because `/a/<id>/raw` admits only browser credentials today (see REPORT contract requests).
const DECK='---\nvisibility: unlisted\n---\n<Slide><h1>One</h1></Slide><Slide><h1>Two</h1></Slide>';

it('renders a published head through the viewer routes, maps --page to slide, and refuses drafts and versions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-export-'));const calls:string[]=[];
 const transport=transportFor(calls);
 const run=async(args:string[],fetchImpl:typeof fetch=transport)=>{
  const output:string[]=[];const errors:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:fetchImpl,stdout:s=>output.push(s),stderr:s=>errors.push(s)});
  return {code,result:output.length?JSON.parse(output.join('')):null,errors:errors.join('')};
 };
 try{
  const user=await createUser({email:'exporter@minusx.ai'});
  const token=await mintToken('real-cli-export',user.id);await saveConnection({server:'http://localhost:3000',token:token.token},root);
  await writeFile(join(root,'deck.jsx'),DECK);
  const published=await run(['push','deck.jsx']);expect(published.code,JSON.stringify(published.result)).toBe(0);
  const id=published.result.operations[0].id as string;
  calls.length=0;

  // A tracked file identical to its observed head renders that head, and --page becomes slide.
  const shot=await run(['export','deck.jsx','--format','png','--page','2','--output','slide.png']);
  expect(shot.code,JSON.stringify(shot.result)).toBe(0);
  expect(calls).toEqual([`GET /a/${id}/export?format=png&slide=2`]);
  expect(new Uint8Array(await readFile(join(root,'slide.png')))).toEqual(EXPORT_BYTES);
  expect(shot.result.operations[0].format).toBe('png');
  // The render request the route actually built names this document's own slide.
  expect((browser.calls.at(-1) as RenderRequest).url).toContain(`/a/${id}/raw`);

  // HTML export is the standalone page, served by the raw route.
  calls.length=0;
  const page=await run(['export',id,'--format','html','--output','deck.html']);
  expect(page.code,JSON.stringify(page.result)).toBe(0);
  expect(calls).toEqual([`GET /a/${id}/raw`]);
  expect(await readFile(join(root,'deck.html'),'utf8')).toContain('<html');

  // A modified draft is refused locally, offline, and nothing is uploaded to render it.
  const tracked=parseDocument(await readFile(join(root,'deck.jsx'),'utf8'));
  await writeFile(join(root,'deck.jsx'),writeDocument({...tracked,body:tracked.body.replace('One','Edited')}));
  const refused=await run(['export','deck.jsx','--format','png','--output','edited.png'],async()=>{throw new Error('a draft was sent to the renderer');});
  expect(refused.code).not.toBe(0);
  expect(refused.result.error.code).toBe('renderer_unavailable');
  expect(refused.result.error.fix).toBe('push the draft, or export csv/json/yaml/original');
  await expect(stat(join(root,'edited.png'))).rejects.toThrow();

  // A historical version has no rendering: the renderer only ever photographs the head.
  const historical=await run(['export',`${id}@1`,'--format','png','--output','v1.png'],async()=>{throw new Error('a version was sent to the renderer');});
  expect(historical.code).not.toBe(0);
  expect(historical.result.error.code).toBe('unsupported_version_export');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('exports data formats offline, honours --force backups and --dry-run, and never establishes tracking',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-export-data-'));const calls:string[]=[];
 const transport=transportFor(calls);
 const offline:typeof fetch=async()=>{throw new Error('a local data export attempted a request');};
 const run=async(args:string[],fetchImpl:typeof fetch=transport)=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:fetchImpl,stdout:s=>output.push(s),stderr:()=>{}});
  return {code,result:output.length?JSON.parse(output.join('')):null};
 };
 try{
  const user=await createUser({email:'export-data@minusx.ai'});
  const token=await mintToken('real-cli-export-data',user.id);await saveConnection({server:'http://localhost:3000',token:token.token},root);
  await writeFile(join(root,'rows.csv'),'region,total\nEast,12\nWest,7\n');

  const converted=await run(['export','rows.csv','--format','json','--output','rows.json'],offline);
  expect(converted.code,JSON.stringify(converted.result)).toBe(0);
  expect(JSON.parse(await readFile(join(root,'rows.json'),'utf8'))).toEqual([{region:'East',total:12},{region:'West',total:7}]);
  // An export is not a working copy: nothing was tracked by it.
  expect((await tracking(root,root)).workspace).toBeNull();

  // A second export refuses rather than replacing the file.
  const clash=await run(['export','rows.csv','--format','json','--output','rows.json'],offline);
  expect(clash.code).not.toBe(0);
  expect(clash.result.error.code).toBe('output_exists');

  // --force replaces it only after preserving the previous bytes.
  await writeFile(join(root,'rows.csv'),'region,total\nEast,99\n');
  const forced=await run(['export','rows.csv','--format','json','--output','rows.json','--force'],offline);
  expect(forced.code,JSON.stringify(forced.result)).toBe(0);
  expect(JSON.parse(await readFile(join(root,'rows.json'),'utf8'))).toEqual([{region:'East',total:99}]);
  // The replaced bytes are kept in the CLI's own state directory, named by an absolute path.
  const backup=forced.result.operations[0].backup as string;
  expect(backup.startsWith(join(root,'.artifactbin','backups','local'))).toBe(true);
  expect(JSON.parse(await readFile(backup,'utf8'))).toHaveLength(2);

  // --dry-run reports the destination and the capability, renders nothing and writes nothing.
  const planned=await run(['export','rows.csv','--format','csv','--output','planned.csv','--dry-run'],offline);
  expect(planned.code,JSON.stringify(planned.result)).toBe(0);
  expect(planned.result.dry_run).toBe(true);
  expect(planned.result.operations[0].requires).toBe('local_conversion');
  await expect(stat(join(root,planned.result.operations[0].path))).rejects.toThrow();

  // A remote dataset's rows convert through the content route; original bytes come back verbatim.
  const dataset=await run(['push','rows.csv']);expect(dataset.code,JSON.stringify(dataset.result)).toBe(0);
  const datasetId=dataset.result.operations[0].id as string;
  calls.length=0;
  const remote=await run(['export',datasetId,'--format','csv','--output','remote.csv']);
  expect(remote.code,JSON.stringify(remote.result)).toBe(0);
  expect(await readFile(join(root,'remote.csv'),'utf8')).toBe('region,total\nEast,99\n');
  expect(calls.every(call=>call.startsWith('GET '))).toBe(true);
 }finally{await rm(root,{recursive:true,force:true});}
});
