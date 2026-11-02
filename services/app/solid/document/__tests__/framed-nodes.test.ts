/**
 * THE FRAMED DOCUMENT'S NODE TREE IS ITS OWN REQUEST (solid/document/create-framed-story): the page draws nothing from it —
 * it is only relayed to the frame's edit controller, which classifies comments and selections against it — so the page's
 * data does not carry it. The bridge attaches when the tree arrives; a restart is ridden out (lib/http/retry-lazily), a refusal is not.
 */
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFramedStory } from '../create-framed-story';

const PAGES = 'https://6869.pages.test';
const cleanups: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });

const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('native HTML trusted context', () => {
  it('uses the platform revision and refuses archived writes through the original shell bridge', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
    const fetcher = vi.fn(async () => answer(200, { data: {} }));
    vi.stubGlobal('fetch', fetcher);
    createRoot((dispose) => {
      cleanups.push(dispose);
      createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, editId: () => 'head', source: () => null,
        htmlContext: () => ({ revision: '2', readOnly: true }) });
    });
    const key = (posted.mock.calls[0][0] as { key: string }).key;
    const send = (payload: unknown) => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'mx:frame-bridge', key, payload }, origin: PAGES, source: frame.contentWindow,
    }));
    send({ kind: 'ready', nonce: 'native' });
    const request = (operation: string) => ({ kind: 'fetch', call: 1, path: '/api/artifacts/doc1/graphql', method: 'POST', headers: {},
      body: JSON.stringify({ operation, revision: '999', query: '{ count }' }) });
    send(request('query'));
    await Promise.resolve(); await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).revision).toBe('2');
    send(request('mutation'));
    await Promise.resolve(); await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(posted.mock.calls.some(([envelope]) => (envelope as {payload?:{status?:number}}).payload?.status === 403)).toBe(true);
  });
});

describe('native upload trusted context',()=>{
 it('pins the live edit and passes only bounded upload fields to the authenticated file door',async()=>{
  const frame=document.createElement('iframe');document.body.append(frame);const posted=vi.spyOn(frame.contentWindow!,'postMessage');
  const fetcher=vi.fn(async()=>answer(403,{error:'dataset_file_upload_failed',detail:'No insert grant permits this upload'}));vi.stubGlobal('fetch',fetcher);
  createRoot(dispose=>{cleanups.push(dispose);createFramedStory({id:'Page123',framed:{frame,origin:PAGES},editId:()=> 'trusted-edit',source:()=>null,htmlContext:()=>({revision:'3',readOnly:false,uploadSession:{state:'signed-in',subject:'owner'}})});});
  const key=(posted.mock.calls[0][0] as {key:string}).key;
  const send=(payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key,payload},origin:PAGES,source:frame.contentWindow}));send({kind:'ready',nonce:'native'});
  send({kind:'upload-file',call:2,datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'upload-request-123',bytes:new Uint8Array([1,2]),editId:'forged',authorization:'Bearer forged'});
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  const [path,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(path).toBe('/a/Page123/datasets/Dataset123/files');expect(init.headers).toEqual({'Content-Type':'text/plain','X-Filename':'sample.txt','X-Edit-Id':'trusted-edit','Idempotency-Key':'upload-request-123'});expect(init.credentials).toBe('same-origin');
  await vi.waitFor(()=>expect(posted.mock.calls.some(([message])=>{const payload=(message as {payload?:{kind?:string;call?:number;status?:number}}).payload;return payload?.kind==='fetch-result'&&payload.call===2&&payload.status===403;})).toBe(true));
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('refuses archived uploads without making a request',async()=>{
  const frame=document.createElement('iframe');document.body.append(frame);const posted=vi.spyOn(frame.contentWindow!,'postMessage');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  createRoot(dispose=>{cleanups.push(dispose);createFramedStory({id:'Page123',framed:{frame,origin:PAGES},editId:()=> 'head',source:()=>null,htmlContext:()=>({revision:'2',readOnly:true})});});
  const key=(posted.mock.calls[0][0] as {key:string}).key;const send=(payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key,payload},origin:PAGES,source:frame.contentWindow}));send({kind:'ready',nonce:'native'});send({kind:'upload-file',call:2,datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'upload-request-123',bytes:new Uint8Array([1])});
  await Promise.resolve();expect(fetcher).not.toHaveBeenCalled();expect(posted.mock.calls.some(([message])=>(message as {payload?:{status?:number}}).payload?.status===403)).toBe(true);
 });
});
