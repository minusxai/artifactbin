/**
 * The save-less edit buffer. These pin the rules that decide whether the
 * user's work survives — most importantly that a remote document is NEVER
 * adopted while there is local work the server has not seen, which is a real
 * data-loss bug this suite exists to prevent recurring.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {resolveEditBatch} from '@/lib/story/edit-batch';
import { useLiveEdits } from '@/lib/story/use-live-edits';

const ID = 'live01';

function setup(opts: { isUserEditing?: () => boolean; initialSource?:string } = {}) {
  const adopted: string[] = [];
  const hook = renderHook(() =>
    useLiveEdits({
      id: ID,
      initialEditId: 'edit-1',
      initialVersion: 1,
      onRemoteDocument: (s) => adopted.push(s),
      ...opts,
    }),
  );
  return { hook, adopted };
}

const okResponse = (body: Record<string, unknown>) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;
const errResponse = (status: number, body: Record<string, unknown>) =>
  ({ ok: false, status, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(okResponse({ edit_id: 'edit-2', version: 2, markup: '<p>x</p>' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('buffering is batching, never a draft', () => {
  it('navigation refuses a rejected save and keeps the exact draft available for retry', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(400, { error: 'invalid_jsx' }));
    const { hook, adopted } = setup();
    act(() => { hook.result.current.queue({ source: '<p>last typed text</p>' }); });
    let allowed: boolean | undefined;
    await act(async () => { allowed = await hook.result.current.flushForNavigation(async () => {}); });
    expect(allowed).toBe(false);
    expect(adopted).toEqual([]);
    expect(hook.result.current.state.status).toMatch(/not saved/);
    await act(async () => { allowed = await hook.result.current.flushForNavigation(async () => {}); });
    expect(allowed).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).source).toBe('<p>last typed text</p>');
  });

  it('navigation conflict does not replace the local DOM/source with the remote document', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(409, { error: 'doc_changed', edit_id: 'edit-head', source: '<p>theirs</p>' }));
    const { hook, adopted } = setup();
    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await hook.result.current.flushForNavigation(async () => { hook.result.current.queue({ source: '<p>mine</p>' }); });
    });
    expect(allowed).toBe(false);
    expect(adopted).toEqual([]);
    expect(hook.result.current.state.editId).toBe('edit-1');
  });

  it('navigation offline returns false without a retry spin; commit failure never starts persistence', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { hook } = setup();
    let allowed: boolean | undefined;
    await act(async () => { allowed = await hook.result.current.flushForNavigation(async () => { throw new Error('commit timeout'); }); });
    expect(allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { allowed = await hook.result.current.flushForNavigation(async () => { hook.result.current.queue({ title: 'local' }); }); });
    expect(allowed).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('coalesces a burst into ONE request carrying the latest text', async () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.queue({ source: '<p>a</p>' });
      hook.result.current.queue({ source: '<p>ab</p>' });
      hook.result.current.queue({ source: '<p>abc</p>' });
    });
    expect(fetchMock).not.toHaveBeenCalled(); // still inside the window
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ edit_id: 'edit-1', source: '<p>abc</p>' });
  });

  it('sends metadata through the state-guarded metadata protocol', async () => {
    fetchMock.mockResolvedValue(okResponse({state:'a'.repeat(64),version:1,edit_id:'edit-1'}));
    const { hook } = setup();
    act(() => { hook.result.current.queue({ title: 'T', theme: 'nocturne', colorMode: 'dark' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      expectedState: 'a'.repeat(64), title: 'T', theme: 'nocturne', colorMode: 'dark',
    });
  });

  it('advances the head pointer so the NEXT edit is based on what landed', async () => {
    const { hook } = setup();
    act(() => { hook.result.current.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(hook.result.current.state.editId).toBe('edit-2');

    act(() => { hook.result.current.queue({ source: '<p>b</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).edit_id).toBe('edit-2');
  });

  it('flushNow drains immediately (leaving edit mode must not lose the last keystrokes)', async () => {
    const { hook } = setup();
    act(() => { hook.result.current.queue({ source: '<p>a</p>' }); });
    await act(async () => { await hook.result.current.flushNow(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the change and retries when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { hook } = setup();
    act(() => { hook.result.current.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(hook.result.current.state.status).toMatch(/offline/);

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).source).toBe('<p>a</p>');
  });
});

describe('adopting a remote document', () => {
  it('adopts when there is nothing local to lose', () => {
    const { hook, adopted } = setup();
    let took = false;
    act(() => { took = hook.result.current.adoptRemote('edit-9', '<p>remote</p>'); });
    expect(took).toBe(true);
    expect(adopted).toEqual(['<p>remote</p>']);
  });

  it('names who moved the document when the frame carries a handle, and stays quiet when it does not', () => {
    const { hook } = setup();
    act(() => { hook.result.current.adoptRemote('edit-9', '<p>remote</p>', 'bob'); });
    expect(hook.result.current.state.status).toBe('updated by @bob');
    act(() => { hook.result.current.adoptRemote('edit-10', '<p>again</p>'); });
    expect(hook.result.current.state.status).toBe('updated by @bob');
  });

  it('ignores a frame that just echoes the version we already hold', () => {
    const { hook, adopted } = setup();
    act(() => { hook.result.current.adoptRemote('edit-1', '<p>same</p>'); });
    expect(adopted).toEqual([]);
  });

  it('REFUSES while a change is buffered (that change would be overwritten)', () => {
    const { hook, adopted } = setup();
    act(() => { hook.result.current.queue({ source: '<p>mine</p>' }); });
    let took = true;
    act(() => { took = hook.result.current.adoptRemote('edit-9', '<p>remote</p>'); });
    expect(took).toBe(false);
    expect(adopted).toEqual([]);
  });

  it('REFUSES while the user has typing the engine has not committed', () => {
    // The buffer is EMPTY here — the engine commits on blur — so this is
    // exactly the window where an "idle" editor would destroy real work.
    let typing = true;
    const { hook, adopted } = setup({ isUserEditing: () => typing });
    let took = true;
    act(() => { took = hook.result.current.adoptRemote('edit-9', '<p>remote</p>'); });
    expect(took).toBe(false);
    expect(adopted).toEqual([]);

    // Once committed, the same frame is welcome.
    typing = false;
    act(() => { took = hook.result.current.adoptRemote('edit-9', '<p>remote</p>'); });
    expect(took).toBe(true);
    expect(adopted).toEqual(['<p>remote</p>']);
  });

  it('retains the local draft on doc_changed and blocks navigation until resolved', async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(409, { error: 'doc_changed', edit_id: 'edit-head', source: '<p>theirs</p>', version: 7 }),
    );
    const { hook, adopted } = setup();
    act(() => { hook.result.current.queue({ source: '<p>mine</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(adopted).toEqual([]);
    expect(hook.result.current.state.editId).toBe('edit-1');
    expect(hook.result.current.state.status).toMatch(/not saved/);
  });

  it('treats an identical no-op flush as success, not an error', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(400, { error: 'bad_diff', detail: 'identical' }));
    const { hook } = setup();
    act(() => { hook.result.current.queue({ source: '<p>same</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(hook.result.current.state.status).toBe('');
  });
});

/**
 * A rejected save must say WHAT was wrong, not merely that something was.
 *
 * The chip read `not saved (invalid_jsx)` — honest and visible, which was the
 * important half — but the error class is not actionable. The API already
 * returns a precise, self-correcting message ("a document may carry only one
 * <Helmet>"), and the author is the one person who can act on it.
 */
describe('a refused save tells the author what to fix', () => {
  const refusal = (details: Array<{ message: string }>) =>
    errResponse(400, { error: 'invalid_jsx', details });

  it('surfaces the validator’s own message', async () => {
    const { hook } = setup();
    fetchMock.mockResolvedValue(refusal([{ message: 'A document may carry only one <Helmet>' }]));
    act(() => { hook.result.current.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(hook.result.current.state.status).toContain('only one <Helmet>');
  });

  it('keeps it to ONE message when a document has many faults', async () => {
    const { hook } = setup();
    fetchMock.mockResolvedValue(refusal([
      { message: 'Tag <marquee> is not in the allowed HTML tag list — see allowed_html_tags' },
      { message: 'Tag <blink> is not in the allowed HTML tag list — see allowed_html_tags' },
      { message: 'Event handler attribute "onclick" is not allowed' },
    ]));
    act(() => { hook.result.current.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const status = hook.result.current.state.status;
    expect(status).toContain('<marquee>');
    expect(status).not.toContain('<blink>');   // one problem at a time, not a wall
    expect(status).toContain('+2 more');
  });

  it('still falls back to the error class when there is no detail', async () => {
    const { hook } = setup();
    fetchMock.mockResolvedValue(errResponse(400, { error: 'invalid_refs' }));
    act(() => { hook.result.current.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(hook.result.current.state.status).toBe('not saved (invalid_refs)');
  });
});

describe('flushNow drains EVERYTHING owed, not just what is idle', () => {
  it('waits for the in-flight request and then sends what was queued behind it', async () => {
    // A is on the wire; B is typed while it is; the drain must land B too —
    // an anchor stamp after a drain that skipped B is how mid-edit typing was lost.
    let resolveA!: (r: Response) => void;
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((r) => { resolveA = r; }))
      .mockResolvedValueOnce(okResponse({ edit_id: 'edit-3', version: 3, markup: '<p>ab</p>' }));
    const { hook } = setup();
    act(() => { hook.result.current.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => { hook.result.current.queue({ source: '<p>ab</p>' }); });
    let drained = false;
    const drain = hook.result.current.flushNow().then(() => { drained = true; });
    await act(async () => { await Promise.resolve(); });
    expect(drained).toBe(false); // A is still in flight — the drain must not report done

    resolveA(okResponse({ edit_id: 'edit-2', version: 2, markup: '<p>a</p>' }));
    await act(async () => { await drain; });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({ edit_id: 'edit-2', source: '<p>ab</p>' });
    expect(hook.result.current.state.editId).toBe('edit-3');
  });
});


describe('V2 atomic source queue',()=> {
  const initial='<p id="a">one</p><p id="b">two</p><p id="c">three</p>';
  it('sends disjoint node edits through the existing batch protocol',async()=> {
    const next=initial.replace('one','long one').replace('three','3');
    const {hook}=setup({initialSource:initial});
    act(()=>hook.result.current.queue({source:next}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(600);});
    const body=JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.source).toBeUndefined();
    expect(body.edits).toHaveLength(2);
    expect(body.edits[0]).toEqual({old_string:expect.any(String),new_string:expect.any(String)});
    expect(resolveEditBatch(initial,body.edits.map((e:{old_string:string;new_string:string})=>({oldString:e.old_string,newString:e.new_string})))).toMatchObject({ok:true,source:next});
  });
  it('undo before the first save produces no source request',async()=> {
    const {hook}=setup({initialSource:initial});
    act(()=>{hook.result.current.queue({source:initial.replace('one','changed')});hook.result.current.queue({source:initial});});
    await act(async()=>{await vi.advanceTimersByTimeAsync(600);});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('undo queued during a save is based on the accepted head',async()=> {
    const changed=initial.replace('one','changed');
    let accept!:(r:Response)=>void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve=>{accept=resolve;}));
    const {hook}=setup({initialSource:initial});
    act(()=>hook.result.current.queue({source:changed}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(600);});
    act(()=>hook.result.current.queue({source:initial}));
    accept(okResponse({edit_id:'edit-2',version:2,markup:changed}));
    await act(async()=>{await hook.result.current.flushNow();});
    const body=JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.edit_id).toBe('edit-2');
    expect(resolveEditBatch(changed,body.edits.map((e:{old_string:string;new_string:string})=>({oldString:e.old_string,newString:e.new_string})))).toMatchObject({ok:true,source:initial});
  });
});


it('rebases a pending undo over an unrelated edit included in the save response',async()=> {
  const base='<p id="a">one</p><p id="b">two</p>';
  const submitted=base.replace('one','changed');
  let accept!:(r:Response)=>void;
  fetchMock.mockReturnValueOnce(new Promise<Response>(resolve=>{accept=resolve;}));
  const {hook,adopted}=setup({initialSource:base});
  act(()=>hook.result.current.queue({source:submitted}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(600);});
  act(()=>hook.result.current.queue({source:base}));
  const accepted=submitted.replace('two','remote two');
  accept(okResponse({edit_id:'edit-2',version:2,markup:accepted}));
  await act(async()=>{await hook.result.current.flushNow();});
  const next=JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(resolveEditBatch(accepted,next.edits.map((e:{old_string:string;new_string:string})=>({oldString:e.old_string,newString:e.new_string})))).toMatchObject({ok:true,source:base.replace('two','remote two')});
  expect(adopted[0]).toBe(base.replace('two','remote two'));
});

it('retries a preserved draft against a fresh head without overwriting unrelated remote text',async()=>{
 const base='<p id="a">one</p><p id="b">two</p>',draft=base.replace('one','local'),remote=base.replace('two','remote');
 fetchMock.mockResolvedValueOnce(errResponse(409,{error:'doc_changed'}));
 const {hook,adopted}=setup({initialSource:base});act(()=>hook.result.current.queue({source:draft}));
 await act(async()=>{await hook.result.current.flushNow();});
 fetchMock.mockResolvedValueOnce(okResponse({edit_id:'remote-head',version:2,markup:remote}));
 fetchMock.mockResolvedValueOnce(okResponse({edit_id:'merged-head',version:3,markup:draft.replace('two','remote')}));
 await act(async()=>{await hook.result.current.recover('retry');});
 const body=JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
 expect(body.edit_id).toBe('remote-head');expect(body.edits).toEqual([{old_string:'<p id="a">one</p>',new_string:'<p id="a">local</p>'}]);
 expect(adopted.at(-1)).toBe(draft.replace('two','remote'));expect(hook.result.current.state.status).toBe('');
});

it('retains annotation operations when newer source is queued during a failed save',async()=>{
 let reject!:(e:Error)=>void;
 fetchMock.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;}));
 const {hook}=setup();const operation={id:'12345678-1234-1234-1234-123456789012',kind:'map' as const,maps:[]};
 act(()=>hook.result.current.queue({source:'<p>merged</p>',annotationOps:[operation]}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
 act(()=>hook.result.current.queue({source:'<p>merged and typed</p>'}));
 await act(async()=>{reject(new Error('offline'));await Promise.resolve();});
 fetchMock.mockResolvedValue(okResponse({edit_id:'edit-2',version:2,markup:'<p>merged and typed</p>'}));
 await act(async()=>{await hook.result.current.flushForNavigation(async()=>{});});
 const body=JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
 expect(body.source).toBe('<p>merged and typed</p>');
 expect(body.annotation_ops).toEqual([operation]);
});

it('defers an accepted remote rebase until composition finishes, preserving both changes',async()=>{
 const base='<p id="a">one</p><p id="b">two</p>',sent=base.replace('one','one!'),accepted=sent.replace('two','remote');
 let composing=false;let respond!:(r:Response)=>void;
 fetchMock.mockImplementationOnce(()=>new Promise(r=>{respond=r;}));
 const {hook,adopted}=setup({initialSource:base,isUserEditing:()=>composing});
 act(()=>hook.result.current.queue({source:sent}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
 composing=true;
 act(()=>hook.result.current.queue({source:sent.replace('one!','one!日本語')}));
 await act(async()=>{respond(okResponse({edit_id:'edit-2',version:2,markup:accepted}));await Promise.resolve();});
 expect(adopted).toEqual([]);
 composing=false;
 await act(async()=>{await vi.advanceTimersByTimeAsync(50);});
 expect(adopted).toContain(accepted.replace('one!','one!日本語'));
});
