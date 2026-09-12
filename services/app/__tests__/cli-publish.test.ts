/**
 * The REAL CLI through the REAL publication handlers: push, pull, dependencies, fork and export.
 * One file per verb family rather than one per command — they all pay the same workspace + token +
 * handler-transport setup, which `cli-harness.ts` now owns.
 */

import { expect, it, vi, afterEach, beforeEach } from 'vitest';
import { writeFile, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { useAppHarness, request } from './harness';
import { artifactTransport, cliWorkspace, routesCalled, addressesCalled, type CliCall } from './cli-harness';
import { mintToken } from '@/lib/tokens';
import { POST as create } from '@/app/api/artifacts/route';
import { GET as read } from '@/app/api/artifacts/[id]/route';
import { tracking } from '../../cli/test/tracking';
import { parseDocument, writeDocument } from '../../cli/src/document';
import { publishJsx } from '@/lib/story/jsx-tier';
import { GET as content } from '@/app/api/artifacts/[id]/content/route';
import { createHash } from 'node:crypto';
import { createUser } from '@/lib/users';
import { getArtifactById } from '@/lib/artifacts';
import { State } from '../../cli/src/state';
import { fakeBrowser } from '@artifactbin/utils';
import type { RenderRequest } from '@artifactbin/contracts';
import { setServices } from '@/lib/services';
import { resetExportRenderer } from '@/lib/export';
import { GET as exportImage } from '@/app/a/[id]/export/route';
import { GET as serveRaw } from '@/app/a/[id]/raw/route';

useAppHarness();

describe('cli-sync-integration', () => {
  it('runs the real CLI through publication handlers: create, no-op, body edit, metadata and pull',async()=>{
   const calls:CliCall[]=[];
   const cli=await cliWorkspace('handler-sync',{fetch:artifactTransport(calls)});const root=cli.root;
   try{
    await cli.connect('real-cli-sync');
    await writeFile(join(root,'doc.jsx'),'<p>Initial</p>');
    await cli.invoke(['push','doc.jsx']);expect(routesCalled(calls)).toEqual(['POST /api/artifacts']);
    const first=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));expect(first.metadata.id).toBeTruthy();expect(first.body).toMatch(/id=/);
    await cli.invoke(['push']);expect(calls).toHaveLength(1);
    await writeFile(join(root,'doc.jsx'),writeDocument({...first,body:first.body.replace('Initial','Updated')}));
    await cli.invoke(['push']);expect(routesCalled(calls).at(-1)).toBe(`POST /api/artifacts/${first.metadata.id}/edits`);expect(calls).toHaveLength(2);
    const updated=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));expect(updated.metadata.head_version).toBe(2);
    updated.metadata.title='Changed title';await writeFile(join(root,'doc.jsx'),writeDocument(updated));
    await cli.invoke(['push']);expect(routesCalled(calls).at(-1)).toBe(`PATCH /api/artifacts/${first.metadata.id}`);expect(routesCalled(calls).slice(-2)).toEqual([`GET /api/artifacts/${first.metadata.id}`,`PATCH /api/artifacts/${first.metadata.id}`]);expect(calls).toHaveLength(4);
    const renamed=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));expect(renamed.metadata.title).toBe('Changed title');expect(renamed.metadata.head_version).toBe(2);
    await cli.invoke(['pull']);expect(routesCalled(calls).at(-1)).toBe(`GET /api/artifacts/${first.metadata.id}`);
    await cli.invoke(['push']);expect(calls).toHaveLength(5);
   }finally{await cli.cleanup();}
  });
  it('bare push publishes changed composed dependencies under new identities before replacing their document refs',async()=>{
   const calls:CliCall[]=[];
   const cli=await cliWorkspace('handler-deps',{fetch:artifactTransport(calls)});const root=cli.root;
   try{
    const token=await cli.connect('real-cli-deps');
    await writeFile(join(root,'sales.csv'),'region,total\nEast,12\n');
    await writeFile(join(root,'doc.jsx'),'<Helmet><Query name="sales" source="./sales.csv">{`select * from public.rows`}</Query></Helmet><Table data="$sales" />');
    await writeFile(join(root,'other.jsx'),await readFile(join(root,'doc.jsx')));
    await cli.invoke(['push','doc.jsx','other.jsx']);
    expect(routesCalled(calls).filter(call=>call==='POST /api/artifacts')).toHaveLength(3);
    const oldAsset=(await tracking(root,root)).files['sales.csv'].id;
    calls.length=0;await writeFile(join(root,'sales.csv'),'region,total\nEast,24\n');await cli.invoke(['push']);
    expect(routesCalled(calls).some(call=>call===`PUT /api/artifacts/${oldAsset}`)).toBe(false);
    expect(routesCalled(calls).filter(call=>call==='POST /api/artifacts')).toHaveLength(1);
    expect((await tracking(root,root)).files['sales.csv'].id).not.toBe(oldAsset);
    expect(parseDocument(await readFile(join(root,'doc.jsx'),'utf8')).body).toContain('source="./sales.csv"');
    const old=await read(new Request(`http://localhost:3000/api/artifacts/${oldAsset}`,{headers:{Authorization:`Bearer ${token.token}`}}),{params:Promise.resolve({id:oldAsset})});expect((await old.json()).version).toBe(1);
    const titled=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));titled.metadata.title='Sales';await writeFile(join(root,'doc.jsx'),writeDocument(titled));
    calls.length=0;await cli.invoke(['push','doc.jsx']);expect(routesCalled(calls)).toEqual([`GET /api/artifacts/${titled.metadata.id}`,`PATCH /api/artifacts/${titled.metadata.id}`]);
   }finally{await cli.cleanup();}
  });
});

describe('cli-plan-probe', () => {
  it('refuses invalid publication before any import hook runs', async () => {
    const importAsset = vi.fn(async () => null);
    const result = await publishJsx({}, '<img src="https://example.com/probe.png" /><UnknownPlanningComponent />', { importAsset });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(importAsset).not.toHaveBeenCalled();
  });

  it('can reject the same invalid markup with the import capability withheld', async () => {
    const result = await publishJsx({}, '<img src="https://example.com/probe.png" /><UnknownPlanningComponent />', {});
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });
});

describe('cli-content', () => {
  it('downloads exact stored bytes at a selected version through authenticated API access',async()=>{
   const token=await mintToken('download');const bytes=Buffer.from([0,1,255,10]);
   const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{file:{filename:'data.zip',contentType:'application/zip',base64:bytes.toString('base64')}}}));expect(created.status).toBe(201);const row=await created.json();
   const ctx={params:Promise.resolve({id:row.id})};
   const response=await content(request(`/api/artifacts/${row.id}/content?version=1`,{token:token.token}),ctx);expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
   const other=await mintToken('other-download');expect((await content(request(`/api/artifacts/${row.id}/content?version=1`,{token:other.token}),ctx)).status).toBe(200);
   expect((await content(request(`/api/artifacts/${row.id}/content?version=2`,{token:token.token}),ctx)).status).toBe(404);
  });
  it('preflights deletion without deleting or changing the head',async()=>{
   const token=await mintToken('delete-preview');
   const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Keep</p>'}}));const row=await created.json();
   const {POST:preflight}=await import('@/app/api/artifacts/preflight/route');
   const preview=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{id:row.id,mode:'delete',input:{}}}));expect(preview.status).toBe(200);expect((await preview.json()).would_delete).toBe(row.id);
   expect((await content(request(`/api/artifacts/${row.id}/content`,{token:token.token}),{params:Promise.resolve({id:row.id})})).status).toBe(200);
  });
  it('a conditional standalone asset update reports the affected owned documents',async()=>{
   const token=await mintToken('asset-impact');const file={filename:'data.zip',contentType:'application/zip',base64:Buffer.from('first').toString('base64')};
   const asset=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{file}}))).json();
   const documentResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:`<a href="ref:${asset.id}">Download</a>`}}));expect(documentResponse.status).toBe(201);const document=await documentResponse.json();
   const {GET,PUT}=await import('@/app/api/artifacts/[id]/route');const ctx={params:Promise.resolve({id:asset.id})};
   const head=await(await GET(request(`/api/artifacts/${asset.id}`,{token:token.token}),ctx)).json();
   const changed=await PUT(request(`/api/artifacts/${asset.id}`,{method:'PUT',token:token.token,json:{file:{...file,base64:Buffer.from('second').toString('base64')},expectedVersion:head.version,expectedState:head.state}}),ctx);
   expect(changed.status).toBe(200);expect((await changed.json()).affected_dependents.map((row:{id:string})=>row.id)).toContain(document.id);
  });
});

describe('cli-dependencies', () => {
  const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

  it('publishes a local image by hash once, reuses it across documents, and keeps every byte out of the workspace',async()=>{
   const calls:CliCall[]=[];
   const cli=await cliWorkspace('handler-deps',{fetch:artifactTransport(calls),separateHome:true});
   const work=cli.root;const home=cli.home;
   const invoke=(args:string[])=>cli.invoke(args);
   try{
    const user=await createUser({email:'deps@minusx.ai'});
    await cli.connect('real-cli-deps',user.id);
    await writeFile(join(work,'photo.png'),PNG);
    await writeFile(join(work,'one.jsx'),'<p>One</p>\n<img src="./photo.png" alt="one" />');

    // First push: preflight carries the hash, never the bytes; the image is created, then the document.
    const first=await invoke(['push','one.jsx']);
    const flight=calls.find(call=>call.path==='/api/artifacts/preflight');expect(flight).toBeTruthy();
    expect((flight!.body as {dependencies:unknown}).dependencies).toEqual([{id:'local000001',sha256:sha256(PNG),size:PNG.length,filename:'photo.png'}]);
    expect(JSON.stringify(flight!.body)).not.toContain(PNG.toString('base64'));
    const creates=calls.filter(call=>call.method==='POST'&&call.path==='/api/artifacts');
    expect(creates.map(call=>Object.keys(call.body as object)[0])).toEqual(['image','markup']);
    const image=first.operations.find((operation:any)=>operation.path==='photo.png');expect(image.status).toBe('published');
    const imageRow=await getArtifactById(image.id);expect((imageRow!.meta as {sha256?:string}).sha256).toBe(sha256(PNG));
    const doc=first.operations.find((operation:any)=>operation.path==='one.jsx');
    expect((await getArtifactById(doc.id))!.source).toContain(`ref:${image.id}`);
    expect(await readFile(join(work,'one.jsx'),'utf8')).toContain('./photo.png');

    // A second document referencing the same bytes: the server reports the owned id and nothing is uploaded.
    calls.length=0;
    await writeFile(join(work,'two.jsx'),'<p>Two</p>\n<img src="./photo.png" alt="two" />');
    const second=await invoke(['push','two.jsx']);
    expect(second.operations.find((operation:any)=>operation.path==='photo.png')).toMatchObject({status:'reused',id:image.id});
    expect(calls.filter(call=>call.method==='POST'&&call.path==='/api/artifacts').map(call=>Object.keys(call.body as object)[0])).toEqual(['markup']);

    // An unchanged document with an unchanged asset makes no request at all.
    calls.length=0;
    const third=await invoke(['push','one.jsx']);
    expect(third.operations[0]).toMatchObject({path:'one.jsx',status:'skipped'});
    expect(calls).toEqual([]);

    // Changed bytes are a new artifact, never an in-place replacement of the one two.jsx still uses.
    await writeFile(join(work,'photo.png'),Buffer.concat([PNG,Buffer.from([0])]));
    const fourth=await invoke(['push','one.jsx']);
    const republished=fourth.operations.find((operation:any)=>operation.path==='photo.png');
    expect(republished.status).toBe('published');expect(republished.id).not.toBe(image.id);
    expect((await getArtifactById(image.id))!.deleted_at).toBeNull();

    // Nothing but the user's files in the workspace; tracking lives in the store with hashes, not bytes.
    expect((await readdir(work)).sort()).toEqual(['one.jsx','photo.png','two.jsx']);
    const state=await State.open(home);
    try{
     const tracked=state.list<{file:string;snapshot:{markup?:string}}>(await realpath(work),'tracked');
     expect(tracked.map(record=>record.key).sort()).toEqual(['one.jsx','photo.png','two.jsx']);
     for(const record of tracked){expect(record.value.file).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(record.value)).not.toContain(PNG.toString('base64'));}
     expect(parseDocument(await readFile(join(work,'one.jsx'),'utf8')).metadata.id).toBe(doc.id);
    }finally{state.close();}
   }finally{await cli.cleanup();}
  });
});

describe('cli-export', () => {
  const EXPORT_BYTES=new Uint8Array([0x89,0x50,0x4e,0x47,0x45,0x58,0x50,0x4f,0x52,0x54]);
  let browser=fakeBrowser({ok:true,mime:'image/png',bytes:EXPORT_BYTES});
  beforeEach(async()=>{await resetExportRenderer();browser=fakeBrowser({ok:true,mime:'image/png',bytes:EXPORT_BYTES});setServices({browser});});
  afterEach(async()=>{setServices({});await resetExportRenderer();});

  /** The viewer routes the CLI renders through; the bearer API half is the shared transport's. */
  const viewerRoutes=(request:Request,url:URL)=>{
   const view=/^\/a\/([^/]+)\/(export|raw)$/.exec(url.pathname);
   return view?(view[2]==='export'?exportImage:serveRaw)(request,{params:Promise.resolve({id:view[1]!})}):undefined;
  };
  const transportFor=(calls:CliCall[]):typeof fetch=>artifactTransport(calls,viewerRoutes);

  // Unlisted, because `/a/<id>/raw` admits only browser credentials today (see REPORT contract requests).
  const DECK='---\nvisibility: unlisted\n---\n<Slide><h1>One</h1></Slide><Slide><h1>Two</h1></Slide>';

  it('renders a published head through the viewer routes, maps --page to slide, and refuses drafts and versions',async()=>{
   const calls:CliCall[]=[];
   const cli=await cliWorkspace('handler-export',{fetch:transportFor(calls)});const root=cli.root;const run=cli.run;
   try{
    const user=await createUser({email:'exporter@minusx.ai'});
    await cli.connect('real-cli-export',user.id);
    await writeFile(join(root,'deck.jsx'),DECK);
    const published=await run(['push','deck.jsx']);expect(published.code,JSON.stringify(published.result)).toBe(0);
    const id=published.result.operations[0].id as string;
    calls.length=0;

    // A tracked file identical to its observed head renders that head, and --page becomes slide.
    const shot=await run(['export','deck.jsx','--format','png','--page','2','--output','slide.png']);
    expect(shot.code,JSON.stringify(shot.result)).toBe(0);
    expect(addressesCalled(calls)).toEqual([`GET /a/${id}/export?format=png&slide=2`]);
    expect(new Uint8Array(await readFile(join(root,'slide.png')))).toEqual(EXPORT_BYTES);
    expect(shot.result.operations[0].format).toBe('png');
    // The render request the route actually built names this document's own slide.
    expect((browser.calls.at(-1) as RenderRequest).url).toContain(`/a/${id}/raw`);

    // HTML export is the standalone page, served by the raw route.
    calls.length=0;
    const page=await run(['export',id,'--format','html','--output','deck.html']);
    expect(page.code,JSON.stringify(page.result)).toBe(0);
    expect(addressesCalled(calls)).toEqual([`GET /a/${id}/raw`]);
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
   }finally{await cli.cleanup();}
  });

  it('exports data formats offline, honours --force backups and --dry-run, and never establishes tracking',async()=>{
   const calls:CliCall[]=[];
   const cli=await cliWorkspace('handler-export-data',{fetch:transportFor(calls)});const root=cli.root;const run=cli.run;
   const offline:typeof fetch=async()=>{throw new Error('a local data export attempted a request');};
   try{
    const user=await createUser({email:'export-data@minusx.ai'});
    await cli.connect('real-cli-export-data',user.id);
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
    expect(routesCalled(calls).every(call=>call.startsWith('GET '))).toBe(true);
   }finally{await cli.cleanup();}
  });
});

describe('cli-fork', () => {
  it('forks a published document offline and stores lineage on the first push',async()=>{
   const calls:CliCall[]=[];
   const cli=await cliWorkspace('handler-fork',{fetch:artifactTransport(calls)});const root=cli.root;const invoke=cli.invoke;
   try{
    const user=await createUser({email:'forker@minusx.ai'});
    await cli.connect('real-cli-fork',user.id);
    await writeFile(join(root,'report.jsx'),'<p>Original</p>');
    await invoke(['push','report.jsx']);
    const source=parseDocument(await readFile(join(root,'report.jsx'),'utf8'));
    expect(source.metadata.id).toBeTruthy();
    // Sharing is permission state, so the fork must not carry it even when the source has it.
    await invoke(['push','report.jsx']);
    calls.length=0;

    // A local source never reaches the network: an unexpected request fails the test.
    const forked=await invoke(['fork','report.jsx','--output','copy.jsx'],async()=>{throw new Error('fork of a local source made a request');});
    expect(calls).toEqual([]);
    expect(forked.operations[0].forked_from).toBe(source.metadata.id);
    const copy=parseDocument(await readFile(join(root,'copy.jsx'),'utf8'));
    expect(copy.metadata.id).toBeUndefined();
    expect(copy.metadata.edit_id).toBeUndefined();
    expect(copy.metadata.forked_from).toBe(source.metadata.id);
    expect(copy.metadata.visibility).toBe('private');
    expect(copy.body).toBe(source.body);

    const published=await invoke(['push','copy.jsx']);
    expect(routesCalled(calls).filter(call=>call==='POST /api/artifacts')).toHaveLength(1);
    const copyId=published.operations.at(-1).id as string;
    expect(copyId).not.toBe(source.metadata.id);
    const stored=await getArtifactById(copyId);
    expect(stored?.forked_from).toBe(source.metadata.id);
    expect(stored?.visibility).toBe('private');
    // Lineage is written once: the fence no longer carries it, so a later push cannot rewrite it.
    expect(parseDocument(await readFile(join(root,'copy.jsx'),'utf8')).metadata.forked_from).toBeUndefined();
    // The source is untouched by the whole exchange.
    expect(parseDocument(await readFile(join(root,'report.jsx'),'utf8')).metadata.id).toBe(source.metadata.id);
    expect((await getArtifactById(String(source.metadata.id)))?.forked_from).toBeNull();
   }finally{await cli.cleanup();}
  });

  it('refuses lineage naming a source the pushing account cannot read, and never overwrites a destination',async()=>{
   const calls:CliCall[]=[];const transport=artifactTransport(calls);
   const stranger=await cliWorkspace('handler-fork-acl',{fetch:transport});
   const owner=await cliWorkspace('handler-fork-owner',{fetch:transport});
   const root=stranger.root;const other=owner.root;
   const run=(home:string,args:string[])=>(home===other?owner:stranger).run(args);
   try{
    const ownerUser=await createUser({email:'fork-owner@minusx.ai'});
    await owner.connect('real-cli-fork-owner',ownerUser.id);
    await writeFile(join(other,'private.jsx'),'---\nvisibility: private\n---\n<p>Secret</p>');
    const publishedPrivate=await run(other,['push','private.jsx']);
    expect(publishedPrivate.code,JSON.stringify(publishedPrivate.result)).toBe(0);
    const secretId=publishedPrivate.result.operations[0].id as string;

    const strangerUser=await createUser({email:'fork-stranger@minusx.ai'});
    await stranger.connect('real-cli-fork-stranger',strangerUser.id);
    await writeFile(join(root,'claim.jsx'),`---\nforked_from: ${secretId}\nvisibility: private\n---\n<p>Claimed</p>`);
    const refused=await run(root,['push','claim.jsx']);
    expect(refused.code).not.toBe(0);
    expect(refused.result.error.code).toBe('not_found');
    // Nothing was created under the false claim: the draft is still unpublished.
    expect(parseDocument(await readFile(join(root,'claim.jsx'),'utf8')).metadata.id).toBeUndefined();

    // A readable source is accepted: the stranger's own artifact.
    await writeFile(join(root,'mine.jsx'),'<p>Mine</p>');
    const mine=await run(root,['push','mine.jsx']);expect(mine.code,JSON.stringify(mine.result)).toBe(0);
    const forked=await run(root,['fork','mine.jsx','--output','mine-copy.jsx']);
    expect(forked.code,JSON.stringify(forked.result)).toBe(0);
    const publishedCopy=await run(root,['push','mine-copy.jsx']);
    expect(publishedCopy.code,JSON.stringify(publishedCopy.result)).toBe(0);
    expect((await getArtifactById(publishedCopy.result.operations[0].id as string))?.forked_from).toBe(mine.result.operations[0].id);

    // A second fork to the same destination refuses rather than replacing the draft.
    const again=await run(root,['fork','mine.jsx','--output','mine-copy.jsx']);
    expect(again.code).not.toBe(0);
    expect(again.result.error.code).toBe('output_exists');

    // A folder is not forkable, and the refusal costs no local file.
    await writeFile(join(root,'shelf.yaml'),'type: folder\ntitle: Shelf\n');
    const folder=await run(root,['push','shelf.yaml']);expect(folder.code,JSON.stringify(folder.result)).toBe(0);
    const refusedFolder=await run(root,['fork','shelf.yaml']);
    expect(refusedFolder.code).not.toBe(0);
    expect(refusedFolder.result.error.code).toBe('not_forkable');
    await expect(stat(join(root,'shelf-fork.yaml'))).rejects.toThrow();
   }finally{await stranger.cleanup();await owner.cleanup();}
  });
});
