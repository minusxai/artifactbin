/* @jsxImportSource solid-js */
/**
 * services/app/lib/story/__tests__/use-live-edits.ui.test.tsx, PORTED to the Solid primitive over the
 * framework-free core (solid/lib/live-edits-core). Every case and assertion is the original's; the
 * translation is mechanical: `renderHook` runs the primitive in a Solid root, `hook.result.X` replaces
 * the React `current` indirection (the primitive returns live getters, there is no re-render to wait
 * for) and `act` is a pass-through kept so this file diffs line for line against the React suite.
 *
 * The save-less edit buffer. These pin the rules that decide whether the
 * user's work survives — most importantly that a remote document is NEVER
 * adopted while there is local work the server has not seen, which is a real
 * data-loss bug this suite exists to prevent recurring.
 */
import { renderHook } from './helpers';

/** Solid applies updates synchronously: nothing to flush. */
const act = <T,>(fn: () => T): T => fn();
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {createDocumentGraph,graphSource,type DocumentGraph} from '@/lib/document/document-graph';
import {applyGraphPatch} from '@/lib/document/document-graph-patch';
import type {DocumentUpdate} from '@artifactbin/contracts';
import { createLiveEdits } from '@/solid/editor/create-live-edits';
import { httpBackend } from '@/test/helpers/artifact-backend';
import * as updateClient from '@/lib/document/document-update-client';
import { prepareClientDocumentUpdate } from '@/lib/document/document-update-client';

/** Every save preparation (no worker under test: the authoring client prepares in place), with the source it prepared. */
const preparations = vi.hoisted(() => [] as Array<string | undefined>);
// As in a browser with the save worker (the preparation itself still runs in place here): saves are prepared early.
vi.mock('@/lib/document/document-authoring-client', async (original) => ({ ...(await original<object>()), preparesOffThread: () => true }));
vi.mock('@/lib/document/document-update-client', async (original) => {
  const actual = await original<typeof updateClient>();
  return { ...actual, prepareClientDocument: (...args: Parameters<typeof actual.prepareClientDocument>) => { preparations.push(args[1].source); return actual.prepareClientDocument(...args); } };
});

const ID = 'live01';
const snapshots=new Map<string,{document:DocumentGraph;version:number;ids:boolean}>();
function snapshot(editId:string,source:string,version:number){const document=createDocumentGraph(source,version);snapshots.set(editId,{document,version,ids:/ id=/.test(source)});return document;}
function sourceOf(body:{edit_id:string;document_update:DocumentUpdate}){
 const base=snapshots.get(body.edit_id)!;const graph=applyGraphPatch(base.document,base.version,body.document_update.patch);expect(graph).not.toBeNull();
 const source=graphSource(graph!);return base.ids?source:source.replace(/ id="[A-Za-z0-9]+"/g,'');
}


function setup(opts: { isUserEditing?: () => boolean; initialSource?:string } = {}) {
  const adopted: string[] = [];
  const document=snapshot('edit-1',opts.initialSource??'<p>Initial</p>',1);
  const hook = renderHook(() =>
    createLiveEdits({
      backend: httpBackend(ID),
      initialEditId: 'edit-1',
      initialVersion: 1,
      initialDocument:document,
      onRemoteDocument: (s) => adopted.push(s),
      ...opts,
    }),
  );
  return { hook, adopted };
}

const okResponse = (body: Record<string, unknown>) => {
 const document=typeof body.markup==='string'?snapshot(String(body.edit_id),body.markup,Number(body.version)):undefined;
 return ({ok:true,status:200,json:async()=>({...body,document})}) as Response;
};
const errResponse = (status: number, body: Record<string, unknown>) =>
  ({ ok: false, status, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  snapshots.clear();
  preparations.length = 0;
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
    act(() => { hook.result.queue({ source: '<p>last typed text</p>' }); });
    let allowed: boolean | undefined;
    await act(async () => { allowed = await hook.result.flushForNavigation(async () => {}); });
    expect(allowed).toBe(false);
    expect(adopted).toEqual([]);
    expect(hook.result.state.status).toMatch(/not saved/);
    await act(async () => { allowed = await hook.result.flushForNavigation(async () => {}); });
    expect(allowed).toBe(true);
    expect(sourceOf(JSON.parse(fetchMock.mock.calls[1][1].body))).toBe('<p>last typed text</p>');
  });

  it('navigation conflict does not replace the local DOM/source with the remote document', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(409, { error: 'doc_changed', edit_id: 'edit-head', source: '<p>theirs</p>' }));
    const { hook, adopted } = setup();
    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await hook.result.flushForNavigation(async () => { hook.result.queue({ source: '<p>mine</p>' }); });
    });
    expect(allowed).toBe(false);
    expect(adopted).toEqual([]);
    expect(hook.result.state.editId).toBe('edit-1');
  });

  it('navigation offline returns false without a retry spin; commit failure never starts persistence', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { hook } = setup();
    let allowed: boolean | undefined;
    await act(async () => { allowed = await hook.result.flushForNavigation(async () => { throw new Error('commit timeout'); }); });
    expect(allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { allowed = await hook.result.flushForNavigation(async () => { hook.result.queue({ title: 'local' }); }); });
    expect(allowed).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('coalesces a burst into ONE request carrying the latest text', async () => {
    const { hook } = setup();
    act(() => {
      hook.result.queue({ source: '<p>a</p>' });
      hook.result.queue({ source: '<p>ab</p>' });
      hook.result.queue({ source: '<p>abc</p>' });
    });
    expect(fetchMock).not.toHaveBeenCalled(); // still inside the window
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.edit_id).toBe('edit-1');expect(sourceOf(body)).toBe('<p>abc</p>');
  });

  it('sends metadata with a guarded JSONB operation in one request', async () => {
    fetchMock.mockResolvedValue(okResponse({state:'a'.repeat(64),version:1,edit_id:'edit-1'}));
    const { hook } = setup();
    act(() => { hook.result.queue({ title: 'T', theme: 'modernist', colorMode: 'dark' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).document_update.metadata).toEqual({title:'T',theme:'modernist',colorMode:'dark'});
  });

  it('advances the head pointer so the NEXT edit is based on what landed', async () => {
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(hook.result.state.editId).toBe('edit-2');

    act(() => { hook.result.queue({ source: '<p>b</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).edit_id).toBe('edit-2');
  });

  it('flushNow drains immediately (leaving edit mode must not lose the last keystrokes)', async () => {
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await hook.result.flushNow(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the change and retries when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(hook.result.state.status).toMatch(/offline/);

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sourceOf(JSON.parse(fetchMock.mock.calls[1][1].body as string))).toBe('<p>a</p>');
  });
});

describe('the save is prepared while the debounce runs', () => {
  it('prepares a queued change at once, and the flush sends that preparation without preparing again', async () => {
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>early</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // Prepared before the debounce has passed, and nothing sent yet.
    expect(preparations).toEqual(['<p>early</p>']);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(preparations).toEqual(['<p>early</p>']);
    expect(sourceOf(JSON.parse(fetchMock.mock.calls[0][1].body as string))).toBe('<p>early</p>');
  });

  it('a change queued after the early preparation is prepared again and the newest is what is sent', async () => {
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => { hook.result.queue({ source: '<p>ab</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sourceOf(JSON.parse(fetchMock.mock.calls[0][1].body as string))).toBe('<p>ab</p>');
    // The older preparation is not sent; the newer one is prepared once, ahead of the flush.
    expect(preparations).toEqual(['<p>a</p>', '<p>ab</p>']);
  });

  it('a preparation made against a snapshot a save has since replaced is never sent', async () => {
    const first = '<div id="d"><p id="a">Initial</p></div>';
    const { hook } = setup({ initialSource: first });
    let release!: () => void;
    const answered = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      await answered;
      return ({ ok: true, status: 200, json: async () => ({ edit_id: 'edit-2', version: 2, patch: JSON.parse(init.body as string).document_update.patch }) }) as Response;
    });
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ edit_id: 'edit-3', version: 3, patch: JSON.parse(init.body as string).document_update.patch }) }) as Response);
    act(() => { hook.result.queue({ source: first.replace('Initial', 'one') }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledOnce();
    // Queued while the first save is on the wire: prepared after it lands, on the graph it advanced to.
    act(() => { hook.result.queue({ source: first.replace('Initial', 'two') }); });
    release();
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [one, two] = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body as string).document_update.patch);
    expect(two.baseVersion).toBe(2);
    const server = applyGraphPatch(snapshots.get('edit-1')!.document, 1, one)!;
    expect(graphSource(applyGraphPatch(server, 2, two)!)).toBe(first.replace('Initial', 'two'));
  });
});

describe('a save answered with its patch', () => {
  it('advances the graph it prepared against and prepares the next save on it, without reading the document again', async () => {
    const first = '<div id="d"><p id="a">Initial</p></div>';
    const { hook } = setup({ initialSource: first });
    const patchAnswer = (editId: string, version: number) => async (_url: string, init: RequestInit) =>
      ({ ok: true, status: 200, json: async () => ({ edit_id: editId, version, patch: JSON.parse(init.body as string).document_update.patch }) }) as Response;
    fetchMock.mockImplementationOnce(patchAnswer('edit-2', 2)).mockImplementationOnce(patchAnswer('edit-3', 3));
    act(() => { hook.result.queue({ source: first.replace('Initial', 'Initial, typed') }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(hook.result.state).toMatchObject({ editId: 'edit-2', version: 2, status: '' });
    act(() => { hook.result.queue({ source: first.replace('Initial', 'Initial, typed again') }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    // Two saves and nothing else: no GET of the whole document between them.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [one, two] = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body as string).document_update.patch);
    expect(two.baseVersion).toBe(2);
    // The second patch applies to exactly the graph the server holds after the first.
    const server = applyGraphPatch(snapshots.get('edit-1')!.document, 1, one)!;
    expect(graphSource(applyGraphPatch(server, 2, two)!)).toBe(first.replace('Initial', 'Initial, typed again'));
    expect(hook.result.state).toMatchObject({ editId: 'edit-3', version: 3 });
  });
});

describe('adopting a remote document', () => {
  it('adopts when there is nothing local to lose', () => {
    const { hook, adopted } = setup();
    let took = false;
    act(() => { took = hook.result.adoptRemote('edit-9', '<p>remote</p>'); });
    expect(took).toBe(true);
    expect(adopted).toEqual(['<p>remote</p>']);
  });

  it('names who moved the document when the frame carries a handle, and stays quiet when it does not', () => {
    const { hook } = setup();
    act(() => { hook.result.adoptRemote('edit-9', '<p>remote</p>', 'bob'); });
    expect(hook.result.state.status).toBe('updated by @bob');
    act(() => { hook.result.adoptRemote('edit-10', '<p>again</p>'); });
    expect(hook.result.state.status).toBe('updated by @bob');
  });

  it('ignores a frame that just echoes the version we already hold', () => {
    const { hook, adopted } = setup();
    act(() => { hook.result.adoptRemote('edit-1', '<p>same</p>'); });
    expect(adopted).toEqual([]);
  });

  it('REFUSES while a change is buffered (that change would be overwritten)', () => {
    const { hook, adopted } = setup();
    act(() => { hook.result.queue({ source: '<p>mine</p>' }); });
    let took = true;
    act(() => { took = hook.result.adoptRemote('edit-9', '<p>remote</p>'); });
    expect(took).toBe(false);
    expect(adopted).toEqual([]);
  });

  it('REFUSES at the instant a save starts: the "saving" announcement already counts the save as in flight', async () => {
    // A remote frame waiting for the editor to be idle retries whenever the save state changes. Woken by the
    // flush's own "saving…" before the save counted as in flight, it adopted the remote document under the save,
    // which then rebased onto it and overwrote the remote edit.
    const { hook, adopted } = setup();
    const tries: boolean[] = [];
    const watch = hook.result;
    act(() => { watch.queue({ source: '<p>mine</p>' }); });
    const { createEffect, createRoot } = await import('solid-js');
    const dispose = createRoot((done) => {
      createEffect(() => { if (watch.state.status === 'saving…') tries.push(watch.adoptRemote('edit-9', '<p>remote</p>')); });
      return done;
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    dispose();
    expect(tries).toContain(false);
    expect(tries).not.toContain(true);
    expect(adopted).not.toContain('<p>remote</p>');
  });

  it('REFUSES while the user has typing the engine has not committed', () => {
    // The buffer is EMPTY here — the engine commits on blur — so this is
    // exactly the window where an "idle" editor would destroy real work.
    let typing = true;
    const { hook, adopted } = setup({ isUserEditing: () => typing });
    let took = true;
    act(() => { took = hook.result.adoptRemote('edit-9', '<p>remote</p>'); });
    expect(took).toBe(false);
    expect(adopted).toEqual([]);

    // Once committed, the same frame is welcome.
    typing = false;
    act(() => { took = hook.result.adoptRemote('edit-9', '<p>remote</p>'); });
    expect(took).toBe(true);
    expect(adopted).toEqual(['<p>remote</p>']);
  });

  it('retains the local draft on doc_changed and blocks navigation until resolved', async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(409, { error: 'doc_changed', edit_id: 'edit-head', source: '<p>theirs</p>', version: 7 }),
    );
    const { hook, adopted } = setup();
    act(() => { hook.result.queue({ source: '<p>mine</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(adopted).toEqual([]);
    expect(hook.result.state.editId).toBe('edit-1');
    expect(hook.result.state.status).toMatch(/not saved/);
  });

  it('treats an identical no-op flush as success, not an error', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(400, { error: 'bad_diff', detail: 'identical' }));
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>same</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(hook.result.state.status).toBe('');
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
describe('the editor knows its own save before it has finished applying it', () => {
  // The stream announces a save to every page, this one included, and that ping can overtake the reply. A page
  // that cannot place it fetches the whole document (megabytes) for its own keystrokes, in the middle of typing.
  it('a ping that overtakes the save reply is placed once the reply lands: this page\'s own edit, not news', async () => {
    let respond!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => { respond = r; }));
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchMock).toHaveBeenCalledOnce();
    const own = hook.result.isOwnEdit('edit-2');
    const other = hook.result.isOwnEdit('edit-elsewhere');
    expect(own, 'undecided while the save is on the wire').not.toBe(false);
    respond(okResponse({ edit_id: 'edit-2', version: 2, markup: '<p>a</p>' }));
    await expect(Promise.resolve(own)).resolves.toBe(true);
    await expect(Promise.resolve(other)).resolves.toBe(false);
  });

  it('knows the reply\'s edit id while typing still holds the save back from being applied', async () => {
    let typing = false;
    const { hook } = setup({ isUserEditing: () => typing });
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    typing = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(hook.result.state.editId, 'the reply is held while the user types').toBe('edit-1');
    expect(hook.result.isOwnEdit('edit-2')).toBe(true);
    expect(hook.result.isOwnEdit('edit-elsewhere')).toBe(false);
    typing = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(hook.result.state.editId).toBe('edit-2');
  });

  it('a ping during a save that fails is not this page\'s', async () => {
    let fail!: (e: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const own = hook.result.isOwnEdit('edit-2');
    fail(new TypeError('Failed to fetch'));
    await expect(Promise.resolve(own)).resolves.toBe(false);
  });
});

describe('a remote document waits for typing to go quiet before it is even fetched', () => {
  // Fetching a remote frame is megabytes landing on the page thread: never while the user types.
  it('a remote ping during typing is fetched only after typing goes quiet', async () => {
    const { hook } = setup();
    let idle = false;
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    void hook.result.whenIdle().then(() => { idle = true; });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    act(() => { hook.result.queue({ source: '<p>ab</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(idle, 'still typing: nothing fetched').toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchMock, 'the typing was saved').toHaveBeenCalledOnce();
    expect(idle, 'quiet and saved: fetch now').toBe(true);
  });

  it('a remote ping after typing stops is fetched at once', async () => {
    const { hook } = setup();
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    let idle = false;
    void hook.result.whenIdle().then(() => { idle = true; });
    await act(async () => { await Promise.resolve(); });
    expect(idle).toBe(true);
  });

  it('waits out uncommitted typing the editor reports, too', async () => {
    let typing = true;
    const { hook } = setup({ isUserEditing: () => typing });
    let idle = false;
    void hook.result.whenIdle().then(() => { idle = true; });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(idle).toBe(false);
    typing = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(idle).toBe(true);
  });
});

describe('a save that lands on a newer head waits for typing to go quiet before the editor shows the head', () => {
  it('a save that lands on a newer head does not rebuild the editor while typing; it reconciles once typing goes quiet and keeps the typed text', async () => {
    const base = '<p id="a">one</p><p id="b">two</p>';
    const typed = base.replace('one', 'one typed');
    const more = base.replace('one', 'one typed more');
    const { hook, adopted } = setup({ initialSource: base });
    // The server: a collaborator's patch to #b lands first (version 2), then this editor's save (version 3).
    const start = snapshots.get('edit-1')!.document;
    const meta = { title: null, description: null, meta: {} };
    const remotePatch = prepareClientDocumentUpdate({ ...meta, document: start, version: 1 }, { source: base.replace('two', 'two remote') }).patch;
    const atTwo = applyGraphPatch(start, 1, remotePatch)!;
    let answer!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    act(() => { hook.result.queue({ source: typed }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    const atThree = applyGraphPatch(atTwo, 2, sent.document_update.patch)!;
    snapshots.set('edit-3', { document: atThree, version: 3, ids: true });
    // Typing goes on while the save is on the wire, and its answer lands mid-typing.
    act(() => { hook.result.queue({ source: more }); });
    await act(async () => {
      answer({ ok: true, status: 200, json: async () => ({ edit_id: 'edit-3', version: 3, patch: sent.document_update.patch, remote_patches: [{ version: 2, patch: remotePatch }] }) } as Response);
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(adopted, 'no rebuild while typing').toEqual([]);
    expect(fetchMock, 'the head was not read: the patches were replayed').toHaveBeenCalledOnce();
    // The next save is based on the reconciled head: the collaborator's text is kept, the newer typing is sent.
    fetchMock.mockImplementationOnce(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ edit_id: 'edit-4', version: 4, patch: body.document_update.patch }) } as Response;
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const next = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(next.edit_id).toBe('edit-3');
    expect(sourceOf(next)).toBe(more.replace('two', 'two remote'));
    // Quiet: the editor adopts the head once, with the typed text and the collaborator's.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(adopted).toEqual([more.replace('two', 'two remote')]);
    expect(hook.result.state.status).toBe('');
  });
});

describe('a refused save tells the author what to fix', () => {
  const refusal = (details: Array<{ message: string }>) =>
    errResponse(400, { error: 'invalid_jsx', details });

  it('surfaces the validator’s own message', async () => {
    const { hook } = setup();
    fetchMock.mockResolvedValue(refusal([{ message: 'A document may carry only one <Helmet>' }]));
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(hook.result.state.status).toContain('only one <Helmet>');
  });

  it('keeps it to ONE message when a document has many faults', async () => {
    const { hook } = setup();
    fetchMock.mockResolvedValue(refusal([
      { message: 'Tag <marquee> is not in the allowed HTML tag list — see allowed_html_tags' },
      { message: 'Tag <blink> is not in the allowed HTML tag list — see allowed_html_tags' },
      { message: 'Event handler attribute "onclick" is not allowed' },
    ]));
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const status = hook.result.state.status;
    expect(status).toContain('<marquee>');
    expect(status).not.toContain('<blink>');   // one problem at a time, not a wall
    expect(status).toContain('+2 more');
  });

  it('still falls back to the error class when there is no detail', async () => {
    const { hook } = setup();
    fetchMock.mockResolvedValue(errResponse(400, { error: 'invalid_refs' }));
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(hook.result.state.status).toContain('references');
    expect(hook.result.state.status).not.toContain('invalid_refs');
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
    act(() => { hook.result.queue({ source: '<p>a</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => { hook.result.queue({ source: '<p>ab</p>' }); });
    let drained = false;
    const drain = hook.result.flushNow().then(() => { drained = true; });
    await act(async () => { await Promise.resolve(); });
    expect(drained).toBe(false); // A is still in flight — the drain must not report done

    resolveA(okResponse({ edit_id: 'edit-2', version: 2, markup: '<p>a</p>' }));
    await act(async () => { await drain; });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body=JSON.parse(fetchMock.mock.calls[1][1].body as string);expect(body.edit_id).toBe('edit-2');expect(sourceOf(body)).toBe('<p>ab</p>');
    expect(hook.result.state.editId).toBe('edit-3');
  });
});


describe('V2 atomic source queue',()=> {
  const initial='<p id="a">one</p><p id="b">two</p><p id="c">three</p>';
  it('sends disjoint node edits as one graph patch',async()=> {
    const next=initial.replace('one','long one').replace('three','3');
    const {hook}=setup({initialSource:initial});
    act(()=>hook.result.queue({source:next}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(600);});
    const body=JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.source).toBeUndefined();
    expect(Object.keys(body.document_update.patch.updated)).toHaveLength(2);
    expect(sourceOf(body)).toBe(next);
  });
  it('undo before the first save produces no source request',async()=> {
    const {hook}=setup({initialSource:initial});
    act(()=>{hook.result.queue({source:initial.replace('one','changed')});hook.result.queue({source:initial});});
    await act(async()=>{await vi.advanceTimersByTimeAsync(600);});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('undo queued during a save is based on the accepted head',async()=> {
    const changed=initial.replace('one','changed');
    let accept!:(r:Response)=>void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve=>{accept=resolve;}));
    const {hook}=setup({initialSource:initial});
    act(()=>hook.result.queue({source:changed}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(600);});
    act(()=>hook.result.queue({source:initial}));
    accept(okResponse({edit_id:'edit-2',version:2,markup:changed}));
    await act(async()=>{await hook.result.flushNow();});
    const body=JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.edit_id).toBe('edit-2');
    expect(sourceOf(body)).toBe(initial);
  });
});


it('rebases a pending undo over an unrelated edit included in the save response',async()=> {
  const base='<p id="a">one</p><p id="b">two</p>';
  const submitted=base.replace('one','changed');
  let accept!:(r:Response)=>void;
  fetchMock.mockReturnValueOnce(new Promise<Response>(resolve=>{accept=resolve;}));
  const {hook,adopted}=setup({initialSource:base});
  act(()=>hook.result.queue({source:submitted}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(600);});
  act(()=>hook.result.queue({source:base}));
  const accepted=submitted.replace('two','remote two');
  fetchMock.mockResolvedValueOnce(okResponse({edit_id:'edit-3',version:3,markup:base.replace('two','remote two')}));
  accept(okResponse({edit_id:'edit-2',version:2,markup:accepted}));
  await act(async()=>{await hook.result.flushNow();});
  const next=JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(sourceOf(next)).toBe(base.replace('two','remote two'));
  // The editor shows the head once the undo is saved and nothing is owed.
  await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
  expect(adopted).toEqual([base.replace('two','remote two')]);
});

it('retries a preserved draft against a fresh head without overwriting unrelated remote text',async()=>{
 const base='<p id="a">one</p><p id="b">two</p>',draft=base.replace('one','local'),remote=base.replace('two','remote');
 fetchMock.mockResolvedValueOnce(errResponse(409,{error:'doc_changed'}));
 const {hook,adopted}=setup({initialSource:base});act(()=>hook.result.queue({source:draft}));
 await act(async()=>{await hook.result.flushNow();});
 fetchMock.mockResolvedValueOnce(okResponse({edit_id:'remote-head',version:2,markup:remote}));
 fetchMock.mockResolvedValueOnce(okResponse({edit_id:'merged-head',version:3,markup:draft.replace('two','remote')}));
 await act(async()=>{await hook.result.recover('retry');});
 const body=JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
 expect(body.edit_id).toBe('remote-head');expect(sourceOf(body)).toBe(draft.replace('two','remote'));
 expect(adopted.at(-1)).toBe(draft.replace('two','remote'));expect(hook.result.state.status).toBe('');
});

it('retains annotation operations when newer source is queued during a failed save',async()=>{
 let reject!:(e:Error)=>void;
 fetchMock.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;}));
 const {hook}=setup();const operation={id:'12345678-1234-1234-1234-123456789012',kind:'map' as const,maps:[]};
 act(()=>hook.result.queue({source:'<p>merged</p>',annotationOps:[operation]}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
 act(()=>hook.result.queue({source:'<p>merged and typed</p>'}));
 await act(async()=>{reject(new Error('offline'));await Promise.resolve();});
 fetchMock.mockResolvedValue(okResponse({edit_id:'edit-2',version:2,markup:'<p>merged and typed</p>'}));
 await act(async()=>{await hook.result.flushForNavigation(async()=>{});});
 const body=JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
 expect(sourceOf(body)).toBe('<p>merged and typed</p>');
 expect(body.document_update.annotationOps).toEqual([operation]);
});

it('defers an accepted remote rebase until composition finishes, preserving both changes',async()=>{
 const base='<p id="a">one</p><p id="b">two</p>',sent=base.replace('one','one!'),accepted=sent.replace('two','remote');
 let composing=false;let respond!:(r:Response)=>void;
 fetchMock.mockImplementationOnce(()=>new Promise(r=>{respond=r;}));
 const {hook,adopted}=setup({initialSource:base,isUserEditing:()=>composing});
 act(()=>hook.result.queue({source:sent}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
 composing=true;
 act(()=>hook.result.queue({source:sent.replace('one!','one!日本語')}));
 fetchMock.mockResolvedValueOnce(okResponse({edit_id:'edit-3',version:3,markup:accepted.replace('one!','one!日本語')}));
 await act(async()=>{respond(okResponse({edit_id:'edit-2',version:2,markup:accepted}));await Promise.resolve();});
 expect(adopted).toEqual([]);
 composing=false;
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
 expect(sourceOf(JSON.parse(fetchMock.mock.calls[1][1].body))).toBe(accepted.replace('one!','one!日本語'));
 expect(adopted).toEqual([accepted.replace('one!','one!日本語')]);
});

it('keeps a locally invalid draft without labelling it offline or retrying forever',async()=>{
 const {hook}=setup({initialSource:'<p>Initial</p>'});
 act(()=>hook.result.queue({source:'<p onClick="bad">Invalid</p>'}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(501);});
 expect(hook.result.state.status).toMatch(/not saved/);
 expect(fetchMock).not.toHaveBeenCalled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
 expect(fetchMock).not.toHaveBeenCalled();
 expect(await hook.result.flushForNavigation(async()=>{})).toBe(false);
});

it('a drain sends newer work queued behind a refused commit instead of stopping at the refusal',async()=>{
 let refuse!:(r:Response)=>void;
 fetchMock.mockReturnValueOnce(new Promise<Response>(r=>{refuse=r;}));
 const {hook}=setup();
 act(()=>hook.result.queue({source:'<p>invalid for now</p>'}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(501);});
 act(()=>hook.result.queue({source:'<p>fixed</p>'}));
 const drain=hook.result.flushNow();
 await act(async()=>{refuse(errResponse(400,{error:'invalid_jsx',details:[{message:'not a column'}]}));await drain;});
 expect(fetchMock).toHaveBeenCalledTimes(2);
 expect(sourceOf(JSON.parse(fetchMock.mock.calls[1][1].body))).toBe('<p>fixed</p>');
 expect(hook.result.state.status).toBe('');
 expect(hook.result.isIdle()).toBe(true);
});


describe('editing access can change while a draft is open', () => {
 it('explains a non-disclosing 404 and preserves the refused draft', async () => {
  fetchMock.mockResolvedValueOnce(errResponse(404,{error:'not_found'}));
  const {hook,adopted}=setup();
  act(()=>hook.result.queue({source:'<p>private local draft</p>'}));
  await act(async()=>{await hook.result.flushNow();});
  expect(hook.result.state.status).toContain('editing access');
  expect(hook.result.state.status).toContain('Copy');
  expect(hook.result.state.status).not.toContain('not_found');
  expect(adopted).toEqual([]);
  fetchMock.mockResolvedValueOnce(okResponse({edit_id:'edit-2',version:2,markup:'<p>Initial</p>'}));
  await act(async()=>{await hook.result.recover('retry');});
  const posts=fetchMock.mock.calls.filter((call:any)=>call[1]?.method==='POST');
  expect(posts).toHaveLength(2);
  expect(sourceOf(JSON.parse(posts[1][1].body))).toBe('<p>private local draft</p>');
 });
 it('keeps the draft and offers safe guidance when the editable head is unavailable', async () => {
  fetchMock.mockResolvedValueOnce(errResponse(404,{error:'not_found'}));
  const {hook,adopted}=setup();
  act(()=>hook.result.queue({source:'<p>private local draft</p>'}));
  await act(async()=>{await hook.result.flushNow();});
  fetchMock.mockResolvedValueOnce(errResponse(404,{error:'not_found'}));
  await act(async()=>{await hook.result.recover('server');});
  expect(hook.result.state.status).toContain('Copy');
  expect(hook.result.state.status).toContain('refresh');
  expect(adopted).toEqual([]);
  fetchMock.mockResolvedValueOnce(okResponse({edit_id:'edit-2',version:2,markup:'<p>Initial</p>'}));
  await act(async()=>{await hook.result.recover('retry');});
  const posts=fetchMock.mock.calls.filter((call:any)=>call[1]?.method==='POST');
  expect(posts).toHaveLength(2);
  expect(sourceOf(JSON.parse(posts[1][1].body))).toBe('<p>private local draft</p>');
 });
});
