import {afterEach,expect,it,vi} from 'vitest';
import type {DocumentGraph} from '@artifactbin/contracts';
import {createDocumentGraph,graphSource} from '../graph/document-graph';
import {prepareClientDocumentUpdate} from '../graph/document-update-client';
import {applyGraphPatch} from '../graph/document-graph-patch';
import {createDocumentPreparer,type PrepareWorker} from '../document/document-authoring-client';
import type {PrepareRequest,PrepareResponse,WorkerRequest} from '../document/document-prepare-protocol';

const source='<main id="root"><p id="a">Alpha</p><p id="b">Beta</p></main>';
const workerScope=globalThis as unknown as {onmessage:((event:MessageEvent<PrepareRequest>)=>void)|null;postMessage:(message:unknown)=>void};
const realPost=workerScope.postMessage;
afterEach(()=>{workerScope.onmessage=null;workerScope.postMessage=realPost;vi.resetModules();});

/** The real worker entry, loaded in-process: messages are structured-cloned both ways, as across a thread. */
async function inProcessWorker(sent:WorkerRequest[]):Promise<PrepareWorker> {
 const worker:PrepareWorker={onmessage:null,onerror:null,onmessageerror:null,terminate:vi.fn(),postMessage(message:WorkerRequest){
  sent.push(message);const copy=structuredClone(message);
  queueMicrotask(()=>workerScope.onmessage!({data:copy} as unknown as MessageEvent<PrepareRequest>));
 }};
 workerScope.postMessage=(reply:unknown)=>{const copy=structuredClone(reply) as PrepareResponse;queueMicrotask(()=>worker.onmessage?.({data:copy} as MessageEvent<PrepareResponse>));};
 await import('../document/document-prepare.worker');
 return worker;
}

it('prepares a save in the worker exactly as the page would, posting the graph once per snapshot',async()=>{
 const sent:WorkerRequest[]=[];const worker=await inProcessWorker(sent);
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
 expect(sent.map(message=>'document' in message&&message.document!==undefined)).toEqual([true,false,true]);
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

it('advances the graph by an accepted patch in the worker: only the patch crosses, and the next save is prepared on the advanced graph',async()=>{
 const sent:WorkerRequest[]=[];const worker=await inProcessWorker(sent);
 const prepare=createDocumentPreparer(()=>worker);
 const document=createDocumentGraph(source,1),base={document,version:1,meta:{}};
 const first=await prepare(base,{source:source.replace('Beta','Beta, typed')});
 const advanced=await prepare.advance(document,1,first.update.patch);
 expect(advanced!.document).toEqual(applyGraphPatch(document,1,first.update.patch));
 expect(advanced!.source).toBe(graphSource(applyGraphPatch(document,1,first.update.patch)!));
 expect(sent[1]).toMatchObject({kind:'advance',version:1});
 expect(sent[1]).not.toHaveProperty('document');
 // The worker already holds the advanced graph: the next save sends no graph, and prepares what the page would.
 const change={source:advanced!.source.replace('Alpha','Alpha, again')};
 const second=await prepare({document:advanced!.document,version:2,meta:{}},change);
 expect(sent[2]).not.toHaveProperty('document');
 expect(second.update).toEqual(prepareClientDocumentUpdate({document:advanced!.document,version:2,meta:{}},change));
 // Untouched nodes are shared, not copied; the input graph is left as it was.
 expect(graphSource(document)).toBe(source);
});

it('sends a large graph in parts, never whole, and prepares exactly as the page would',async()=>{
 const {GRAPH_PART}=await import('../document/document-authoring-client');
 const sent:WorkerRequest[]=[];const worker=await inProcessWorker(sent);
 const prepare=createDocumentPreparer(()=>worker);
 const big=`<main id="root">${Array.from({length:GRAPH_PART+150},(_,i)=>`<p id="p${i}">Paragraph ${i} <b id="b${i}">bold</b></p>`).join('')}</main>`;
 const document=createDocumentGraph(big,1),base={document,version:1,meta:{}};
 expect(Object.keys(document.nodes).length).toBeGreaterThan(GRAPH_PART*2);
 const change={source:big.replace('Paragraph 7 ','Paragraph 7, typed ')};
 const viaWorker=await prepare(base,change);
 expect(viaWorker.update).toEqual(prepareClientDocumentUpdate(base,change));
 const parts=sent.filter(message=>message.kind==='graph-part');
 expect(parts.length).toBeGreaterThan(2);
 expect(sent.some(message=>'document' in message&&message.document!==undefined)).toBe(false);
 // The next flush on the same snapshot sends only its change.
 sent.length=0;
 const again=await prepare({...base},{source:big.replace('Paragraph 9 ','Paragraph 9, typed ')});
 expect(sent.map(message=>message.kind??'prepare')).toEqual(['prepare']);
 expect(graphSource(applyGraphPatch(document,1,again.update.patch)!)).toContain('Paragraph 9, typed');
});

it('warms the worker ahead of the first save: the graph crosses and one preparation runs, so the save sends only its change',async()=>{
 const {GRAPH_PART}=await import('../document/document-authoring-client');
 const sent:WorkerRequest[]=[];const worker=await inProcessWorker(sent);
 const prepare=createDocumentPreparer(()=>worker);
 const big=`<main id="root">${Array.from({length:GRAPH_PART+150},(_,i)=>`<p id="p${i}">Paragraph ${i}</p>`).join('')}</main>`;
 const document=createDocumentGraph(big,1),base={document,version:1,meta:{}};
 await prepare.warm(base);
 expect(sent.filter(message=>message.kind==='graph-part').length).toBeGreaterThan(1);
 expect(sent.at(-1)).toMatchObject({staged:true});
 sent.length=0;
 const change={source:big.replace('Paragraph 7<','Paragraph 7, typed<')};
 const saved=await prepare({...base},change);
 expect(sent.map(message=>message.kind??'prepare')).toEqual(['prepare']);
 expect(saved.update).toEqual(prepareClientDocumentUpdate(base,change));
 // No worker: nothing is warmed in the page (that is the main-thread work the worker keeps off it).
 const inPage=vi.fn(()=>null);
 await createDocumentPreparer(inPage).warm(base);
 expect(inPage).toHaveBeenCalledTimes(1);
});
