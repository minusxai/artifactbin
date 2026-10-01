import {afterEach,expect,it,vi} from 'vitest';
import type {DocumentGraph} from '@artifactbin/contracts';
import {createDocumentGraph,graphSource} from '../graph/document-graph';
import {prepareClientDocumentUpdate} from '../graph/document-update-client';
import {applyGraphPatch} from '../graph/document-graph-patch';
import {createDocumentPreparer,type PrepareWorker} from '../document/document-authoring-client';
import type {PrepareRequest,PrepareResponse} from '../document/document-prepare-protocol';

const source='<main id="root"><p id="a">Alpha</p><p id="b">Beta</p></main>';
const workerScope=globalThis as unknown as {onmessage:((event:MessageEvent<PrepareRequest>)=>void)|null;postMessage:(message:unknown)=>void};
const realPost=workerScope.postMessage;
afterEach(()=>{workerScope.onmessage=null;workerScope.postMessage=realPost;vi.resetModules();});

/** The real worker entry, loaded in-process: messages are structured-cloned both ways, as across a thread. */
async function inProcessWorker(sent:PrepareRequest[]):Promise<PrepareWorker> {
 const worker:PrepareWorker={onmessage:null,onerror:null,onmessageerror:null,terminate:vi.fn(),postMessage(message){
  sent.push(message);const copy=structuredClone(message);
  queueMicrotask(()=>workerScope.onmessage!({data:copy} as MessageEvent<PrepareRequest>));
 }};
 workerScope.postMessage=(reply:unknown)=>{const copy=structuredClone(reply) as PrepareResponse;queueMicrotask(()=>worker.onmessage?.({data:copy} as MessageEvent<PrepareResponse>));};
 await import('../document/document-prepare.worker');
 return worker;
}

it('prepares a save in the worker exactly as the page would, posting the graph once per snapshot',async()=>{
 const sent:PrepareRequest[]=[];const worker=await inProcessWorker(sent);
 const prepare=createDocumentPreparer(()=>worker);
 const document=createDocumentGraph(source,1),base={document,version:1,meta:{}};
 const change={source:source.replace('Beta','Beta, typed')};
 const viaWorker=await prepare(base,change);
 const inPage=prepareClientDocumentUpdate(base,change);
 expect(viaWorker.update).toEqual(inPage);
 expect(graphSource(applyGraphPatch(document,1,viaWorker.update.patch)!)).toContain('Beta, typed');
 // A second flush on the same snapshot sends only the change; a new snapshot (an accepted save) sends its graph.
 await prepare({...base},{source:source.replace('Beta','Beta, typed more')});
 const next:DocumentGraph=applyGraphPatch(document,1,viaWorker.update.patch)!;
 const third=await prepare({document:next,version:2,meta:{}},{source:graphSource(next).replace('Alpha','Alpha, again')});
 expect(sent.map(message=>message.document!==undefined)).toEqual([true,false,true]);
 expect(graphSource(applyGraphPatch(next,2,third.update.patch)!)).toContain('Alpha, again');
});

it('reports a refusal from the worker with the in-page message',async()=>{
 const worker=await inProcessWorker([]);
 const prepare=createDocumentPreparer(()=>worker);
 const base={document:createDocumentGraph(source,1),version:1,meta:{}},change={source:'<p onClick="bad">Bad</p>'};
 let inPage='';try {prepareClientDocumentUpdate(base,change);} catch(error) {inPage=(error as Error).message;}
 expect(inPage).not.toBe('');
 await expect(prepare(base,change)).rejects.toThrow(inPage);
});

it('prepares in the page when no worker starts, or when the worker fails to load',async()=>{
 const base={document:createDocumentGraph(source,1),version:1,meta:{}},change={source:source.replace('Alpha','Alpha!')};
 const expected=prepareClientDocumentUpdate(base,change);
 expect((await createDocumentPreparer(()=>null)(base,change)).update).toEqual(expected);
 expect((await createDocumentPreparer(()=>{throw new Error('blocked');})(base,change)).update).toEqual(expected);
 const broken:PrepareWorker={onmessage:null,onerror:null,onmessageerror:null,terminate:vi.fn(),postMessage(){queueMicrotask(()=>broken.onerror?.(new Event('error')));}};
 const start=vi.fn(()=>broken);
 const prepare=createDocumentPreparer(start);
 expect((await prepare(base,change)).update).toEqual(expected);
 expect(broken.terminate).toHaveBeenCalled();
 // Once failed, later saves stay in the page rather than retrying a worker that cannot load.
 expect((await prepare(base,change)).update).toEqual(expected);
 expect(start).toHaveBeenCalledTimes(1);
});
