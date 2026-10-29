/**
 * THE FRAMED DOCUMENT'S NODE TREE IS ITS OWN REQUEST (solid/document/create-framed-story): the page draws nothing from it —
 * it is only relayed to the frame's edit controller, which classifies comments and selections against it — so the page's
 * data does not carry it. The bridge attaches when the tree arrives; a restart is ridden out (lib/http/retry-lazily), a refusal is not.
 */
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsxNode } from '@/lib/jsx';
import { createFramedStory, fetchFrameNodes } from '../create-framed-story';

const PAGES = 'https://6869.pages.test';
const TREE = [{ type: 'element', tag: 'p', start: 0, end: 10, attributes: [], children: [] }] as unknown as JsxNode[];
const cleanups: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });

const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const stubFetch = (...answers: Array<Response | Error>) => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    calls.push(String(input));
    const next = answers.shift() ?? answer(500);
    if (next instanceof Error) throw next;
    return next;
  }));
  return calls;
};

describe('asking for the tree', () => {
  it('reads the nodes part of the page, for the version the address names', async () => {
    const calls = stubFetch(answer(200, { editId: 'e1', version: 3, nodes: TREE }), answer(200, { nodes: TREE }));
    expect(await fetchFrameNodes('doc1', '?$region=west')).toEqual(TREE);
    expect(await fetchFrameNodes('doc1', '?version=2&$region=west')).toEqual(TREE);
    expect(calls).toEqual(['/api/page/artifact/doc1?part=nodes', '/api/page/artifact/doc1?part=nodes&version=2']);
  });

  it('does not ask again after a refusal, and has no tree to give for an answer without one', async () => {
    const refused = stubFetch(answer(404, { error: 'not_found' }));
    expect(await fetchFrameNodes('doc1', '')).toBeNull();
    expect(refused).toHaveLength(1);
    const odd = stubFetch(answer(200, {}));
    expect(await fetchFrameNodes('doc1', '')).toBeNull();
    expect(odd).toHaveLength(1);
  });

  it('asks again through the shared retry after a restart answer or a dropped connection, and once for any other failure', async () => {
    await import('@/lib/http/retry');
    const calls = stubFetch(answer(503), new TypeError('network'), answer(200, { nodes: TREE }));
    const pending = fetchFrameNodes('doc1', '');
    for (let i = 0; i < 40 && calls.length < 3; i++) await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toEqual(TREE);
    expect(calls).toHaveLength(3);
    const failing = stubFetch(answer(500), answer(500), answer(500));
    const never = fetchFrameNodes('doc1', '');
    await vi.runAllTimersAsync();
    expect(await never).toBeNull();
    expect(failing).toHaveLength(1);
  });

  it('stops when the page goes away', async () => {
    const calls = stubFetch(answer(503), answer(200, { nodes: TREE }));
    const controller = new AbortController();
    const pending = fetchFrameNodes('doc1', '', controller.signal);
    await Promise.resolve();
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});

describe('the bridge waits for the tree', () => {
  function framedPage(nodes: Promise<JsxNode[] | null>) {
    const frame = document.createElement('iframe');
    frame.setAttribute('data-mx-document-frame', '');
    document.body.append(frame);
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
    const story = createRoot((dispose) => {
      cleanups.push(dispose);
      return createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, nodes, editId: () => 'e1', source: () => null });
    });
    const payloads = () => posted.mock.calls.map(([message]) => (message as { payload?: { kind?: string; nodes?: unknown; top?: number } }).payload);
    return { story, payloads };
  }

  it('makes no controller and attaches nothing until the tree is here, then attaches with it', async () => {
    let arrive!: (nodes: JsxNode[] | null) => void;
    const { story, payloads } = framedPage(new Promise((resolve) => { arrive = resolve; }));
    expect(story.controller()).toBeNull();
    expect(payloads()).toEqual([]);
    arrive(TREE);
    await Promise.resolve(); await Promise.resolve();
    expect(story.controller()).not.toBeNull();
    expect(payloads()).toEqual([expect.objectContaining({ kind: 'attach', nodes: TREE })]);
  });

  it('keeps the bars\' reach over the frame\'s top edge and gives it to the bridge once made', async () => {
    let arrive!: (nodes: JsxNode[] | null) => void;
    const { story, payloads } = framedPage(new Promise((resolve) => { arrive = resolve; }));
    story.setTopInset(48);
    expect(story.controller()).toBeNull();
    arrive(TREE);
    await Promise.resolve(); await Promise.resolve();
    // The bridge sends the inset to a controller that is running, so the unattached bridge only keeps it: nothing but the attach goes out yet.
    expect(payloads().map((p) => p?.kind)).toEqual(['attach']);
    expect(story.controller()).not.toBeNull();
  });

  it('never makes a controller for a tree that does not arrive, nor after the page is gone', async () => {
    const none = framedPage(Promise.resolve(null));
    await Promise.resolve(); await Promise.resolve();
    expect(none.story.controller()).toBeNull();
    expect(none.payloads()).toEqual([]);

    let arrive!: (nodes: JsxNode[] | null) => void;
    const late = framedPage(new Promise((resolve) => { arrive = resolve; }));
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    arrive(TREE);
    await Promise.resolve(); await Promise.resolve();
    expect(late.story.controller()).toBeNull();
    expect(late.payloads()).toEqual([]);
  });

  it('is unchanged for a tree already at hand: attached at once', () => {
    const { story, payloads } = framedPage(Promise.resolve(null));
    const frame = document.querySelector('iframe')!;
    const sync = createRoot((dispose) => { cleanups.push(dispose); return createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, nodes: TREE, editId: () => 'e1', source: () => null }); });
    expect(sync.controller()).not.toBeNull();
    expect(story.controller()).toBeNull();
    expect(payloads()).toEqual([expect.objectContaining({ kind: 'attach', nodes: TREE })]);
  });
});

/**
 * A READER THE PAGE GIVES NO COMMENT OR EDIT ACTION ON LOAD is attached at once with no tree (`[]`): the bridge still
 * carries everything reading needs (the reader's mode, the `$` values to the address), and the tree is asked for only
 * when a selection action can use it (`attachTree`), which attaches the bridge again with it.
 */
describe('a bridge made without the tree', () => {
  function barePage() {
    const frame = document.createElement('iframe');
    frame.setAttribute('data-mx-document-frame', '');
    document.body.append(frame);
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
    const story = createRoot((dispose) => {
      cleanups.push(dispose);
      return createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, nodes: [], editId: () => 'e1', source: () => null });
    });
    const envelopes = () => posted.mock.calls.map(([message]) => message as { key?: string; payload?: { kind?: string; nodes?: unknown } });
    const ready = (key: string, nonce: string) => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'mx:frame-bridge', key, payload: { kind: 'ready', nonce } }, origin: PAGES, source: frame.contentWindow,
    }));
    return { story, envelopes, ready };
  }

  it('attaches at once with no tree, then hands the tree to the same session when it is asked for and arrives', async () => {
    const { story, envelopes, ready } = barePage();
    expect(envelopes().map((e) => e.payload)).toEqual([expect.objectContaining({ kind: 'attach', nodes: [] })]);
    const firstKey = envelopes()[0]!.key!;
    ready(firstKey, 'first-nonce');
    expect(story.nonce()).toBe('first-nonce');

    let arrive!: (nodes: JsxNode[] | null) => void;
    story.attachTree(new Promise((resolve) => { arrive = resolve; }));
    expect(envelopes()).toHaveLength(1);
    arrive(TREE);
    await Promise.resolve(); await Promise.resolve();
    // The running controller takes the tree: no detach, no new session, so a selection made meanwhile keeps its
    // controller (which describes it again and shows its bubble) and the nonce the page's actions check is unchanged.
    expect(envelopes()).toEqual([
      expect.objectContaining({ key: firstKey, payload: expect.objectContaining({ kind: 'attach', nodes: [] }) }),
      expect.objectContaining({ key: firstKey, payload: { kind: 'nodes', nodes: TREE } }),
    ]);
    expect(story.nonce()).toBe('first-nonce');
  });

  it('asks once, keeps the bare bridge for a tree that never arrives, and does nothing after the page is gone', async () => {
    const none = barePage();
    none.story.attachTree(Promise.resolve(null));
    await Promise.resolve(); await Promise.resolve();
    expect(none.envelopes().map((e) => e.payload?.kind)).toEqual(['attach']);
    expect(none.story.controller()).not.toBeNull();

    const late = barePage();
    let arrive!: (nodes: JsxNode[] | null) => void;
    late.story.attachTree(new Promise((resolve) => { arrive = resolve; }));
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    arrive(TREE);
    await Promise.resolve(); await Promise.resolve();
    expect(late.envelopes().map((e) => e.payload?.kind)).toEqual(['attach', 'detach']);
    expect(late.story.controller()).toBeNull();
  });

  it('ignores a tree asked for when the bridge already holds one', async () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('data-mx-document-frame', '');
    document.body.append(frame);
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
    const story = createRoot((dispose) => { cleanups.push(dispose); return createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, nodes: TREE, editId: () => 'e1', source: () => null }); });
    story.attachTree(Promise.resolve(TREE));
    await Promise.resolve(); await Promise.resolve();
    expect(posted.mock.calls.map(([message]) => (message as { payload?: { kind?: string } }).payload?.kind)).toEqual(['attach']);
  });
});


describe('native HTML trusted context', () => {
  it('uses the platform revision and refuses archived writes through the original shell bridge', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
    const fetcher = vi.fn(async () => answer(200, { data: {} }));
    vi.stubGlobal('fetch', fetcher);
    createRoot((dispose) => {
      cleanups.push(dispose);
      createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, nodes: [], editId: () => 'head', source: () => null,
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
  createRoot(dispose=>{cleanups.push(dispose);createFramedStory({id:'Page123',framed:{frame,origin:PAGES},nodes:[],editId:()=> 'trusted-edit',source:()=>null,htmlContext:()=>({revision:'3',readOnly:false,uploadSession:{state:'signed-in',subject:'owner'}})});});
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
  createRoot(dispose=>{cleanups.push(dispose);createFramedStory({id:'Page123',framed:{frame,origin:PAGES},nodes:[],editId:()=> 'head',source:()=>null,htmlContext:()=>({revision:'2',readOnly:true})});});
  const key=(posted.mock.calls[0][0] as {key:string}).key;const send=(payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key,payload},origin:PAGES,source:frame.contentWindow}));send({kind:'ready',nonce:'native'});send({kind:'upload-file',call:2,datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'upload-request-123',bytes:new Uint8Array([1])});
  await Promise.resolve();expect(fetcher).not.toHaveBeenCalled();expect(posted.mock.calls.some(([message])=>(message as {payload?:{status?:number}}).payload?.status===403)).toBe(true);
 });
});
