/**
 * The save-less edit buffer. These pin the rules that decide whether the
 * user's work survives — most importantly that a remote document is NEVER
 * adopted while there is local work the server has not seen, which is a real
 * data-loss bug this suite exists to prevent recurring.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveEdits } from '@/lib/story/use-live-edits';

const ID = 'live01';

function setup(opts: { isUserEditing?: () => boolean } = {}) {
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

  it('sends metadata changes on the same protocol', async () => {
    const { hook } = setup();
    act(() => { hook.result.current.queue({ title: 'T', theme: 'nocturne', colorMode: 'dark' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      edit_id: 'edit-1', title: 'T', theme: 'nocturne', colorMode: 'dark',
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

  it('takes the server document on doc_changed rather than diverging silently', async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(409, { error: 'doc_changed', edit_id: 'edit-head', source: '<p>theirs</p>', version: 7 }),
    );
    const { hook, adopted } = setup();
    act(() => { hook.result.current.queue({ source: '<p>mine</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(adopted).toEqual(['<p>theirs</p>']);
    expect(hook.result.current.state.editId).toBe('edit-head');
    expect(hook.result.current.state.status).toMatch(/elsewhere/);
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
