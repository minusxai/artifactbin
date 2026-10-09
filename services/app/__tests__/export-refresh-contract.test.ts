import {afterEach,expect,it} from 'vitest';
import {z} from 'zod';
import {OPERATIONS,type OpContext} from '@/lib/operations/registry';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {createArtifact,applyEditFor,getArtifactById} from '@/lib/artifacts';
import {fakeBrowser} from '@artifactbin/utils';
import type {RenderRequest} from '@artifactbin/contracts';
import {setServices} from '@/lib/platform';
import {resetExportRenderer} from '@/lib/export';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {prepareClientDocumentUpdate} from '@/lib/story/graph/document-update-client';
import {EXPORT_PNG} from './export-helpers';

useAppHarness();

const BASE='http://localhost:3000';
const params=(id:string)=>({params:Promise.resolve({id})});
const SOURCE=(footer:string)=>`<table id="budget-table"><tbody><tr id="budget-row"><td>Actual</td><td>12</td></tr></tbody><tfoot><tr id="budget-footer"><td>Total</td><td>${footer}</td></tr></tfoot></table>`;
let browser:ReturnType<typeof fakeBrowser>;
afterEach(async()=>{setServices({});await resetExportRenderer();});

it('keeps an explicit fresh-image request at the export operation boundary',()=>{
 const operation=OPERATIONS.find(operation=>operation.name==='export_artifact')!;
 const input=z.object(operation.input).parse({id:'fresh-static-table',refresh:true});
 expect(input).toMatchObject({id:'fresh-static-table',refresh:true});
});

it('forced export rerenders the current published head and leaves ordinary cache hits intact',async()=>{
 browser=fakeBrowser({ok:true,mime:'image/png',bytes:EXPORT_PNG});setServices({browser});
 const token=await mintAccountToken('mxmx_test_export_freshness');
 const actor={tokenId:token.id,userId:token.userId};
 const original=await createArtifact(token.id,token.userId,{format:'markup',source:SOURCE('$10'),meta:{},title:'Budget',description:null,visibility:'public'});
 const operation=OPERATIONS.find(operation=>operation.name==='export_artifact')!;
 const ctx={actor,base:BASE,request:request('/api/artifacts/export')} as unknown as OpContext;
 await operation.run(ctx,{id:original.id});
 expect(browser.calls).toHaveLength(1);

 const currentSource=SOURCE('$12');
 const head=(await getArtifactById(original.id))!;
 expect(head.document?.kind).toBe('graph');
 expect(await applyEditFor(actor,original.id,{baseEditId:head.edit_id,documentUpdate:prepareClientDocumentUpdate({...head,document:head.document!},{source:currentSource})})).toMatchObject({applied:true});
 const publishedHead=await getArtifactById(original.id);
 expect(publishedHead).toMatchObject({version:original.version+1});
 expect(publishedHead?.source).toContain('id="budget-table"');
 expect(publishedHead?.source).toContain('id="budget-footer"');
 const forced=await operation.run(ctx,{id:original.id,refresh:true});
 expect(forced.status).toBe(200);
 expect(browser.calls,JSON.stringify(forced)).toHaveLength(2);
 const capture=(browser.calls.at(-1) as RenderRequest).url;
 expect(new URL(capture).searchParams.has('version')).toBe(false);
 const currentPage=await raw(request(`${new URL(capture).pathname}${new URL(capture).search}`),params(original.id));
 expect(currentPage.status).toBe(200);
 const currentHtml=await currentPage.text();
 expect(currentHtml).toContain('id="budget-footer"');
 expect(currentHtml).toContain('$12');

 await operation.run(ctx,{id:original.id});
 expect(browser.calls).toHaveLength(2);
 await operation.run(ctx,{id:original.id,refresh:true});
 expect(browser.calls).toHaveLength(3);
});
