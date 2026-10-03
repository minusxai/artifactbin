import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { STORY_EDIT_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import { createEditLifecycle, createEditorPartLoader } from '../create-edit-lifecycle';

/** A window with an in-memory history: `back()` pops asynchronously and fires the page's hashchange, as a browser does. */
function fakeWindow(start = '/a/doc') {
  const entries = [start];
  let index = 0;
  const location = { pathname: '', search: '', hash: '', replace: vi.fn(), reload: vi.fn() };
  const go = (url: string) => {
    const next = new URL(url, 'http://test');
    Object.assign(location, { pathname: next.pathname, search: next.search, hash: next.hash });
  };
  go(start);
  let onHashChange: () => void = () => {};
  const history = {
    state: null, scrollRestoration: 'auto' as ScrollRestoration,
    pushState: vi.fn((_state: unknown, _title: string, url: string) => { entries.splice(index + 1); entries.push(url); index++; go(url); }),
    replaceState: vi.fn((_state: unknown, _title: string, url: string) => { entries[index] = url; go(url); }),
    back: vi.fn(() => {
      if (index === 0) return;
      index--;
      go(entries[index]!);
      setTimeout(() => onHashChange(), 0);
    }),
  };
  const win = { location, history, document, scrollY: 0, innerHeight: 800 } as unknown as Window;
  return { win, location, history, entries: () => entries.slice(0, index + 1), listen: (fn: () => void) => { onHashChange = fn; } };
}

function fakeController(restored: () => Promise<void> = () => Promise.resolve()) {
  const sent: Array<Record<string, unknown>> = [];
  return { sent, controller: { send: (command: unknown) => { sent.push(command as Record<string, unknown>); }, restored: vi.fn(restored) } };
}

const offs = (sent: Array<Record<string, unknown>>) => sent.filter((m) => m.type === STORY_EDIT_MODE_MESSAGE && m.on === false).length;

const disposers: Array<() => void> = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.useRealTimers(); });

function lifecycleFor(options: { editable?: boolean; pwaChanged?: boolean; start?: string; restored?: () => Promise<void> } = {}) {
  const fake = fakeWindow(options.start);
  const { sent, controller } = fakeController(options.restored);
  const [pwaChanged, setPwaChanged] = createSignal(options.pwaChanged ?? false);
  const lifecycle = createRoot((dispose) => {
    disposers.push(dispose);
    return createEditLifecycle({ editable: () => options.editable ?? true, pwaChanged, controller: () => controller, win: fake.win });
  });
  fake.listen(lifecycle.sync);
  return { ...fake, sent, controller, lifecycle, setPwaChanged };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

it('#edit for a non-editor stays reading and the address is left alone', () => {
  const { lifecycle, history } = lifecycleFor({ editable: false, start: '/a/doc#edit' });
  lifecycle.sync();
  expect(lifecycle.phase()).toBe('reading');
  lifecycle.enter('/0');
  expect(lifecycle.phase()).toBe('reading');
  expect(history.pushState).not.toHaveBeenCalled();
});

it('#edit (or /edit) for an editor opens editing without a new history entry', () => {
  const { lifecycle, history } = lifecycleFor({ start: '/a/doc#edit' });
  lifecycle.sync();
  expect(lifecycle.phase()).toBe('entering');
  lifecycle.ready();
  expect(lifecycle.phase()).toBe('editing');
  expect(history.pushState).not.toHaveBeenCalled();
});

it('enter pushes exactly one history entry, and done pops it and restores in place', async () => {
  vi.useFakeTimers();
  const { lifecycle, history, entries, sent, controller } = lifecycleFor();
  lifecycle.enter('/0/1');
  lifecycle.enter('/0/2');
  expect(history.pushState).toHaveBeenCalledTimes(1);
  expect(entries()).toEqual(['/a/doc', '/a/doc#edit']);
  expect(lifecycle.selectionPath()).toBe('/0/1');
  lifecycle.ready();
  const outcome = lifecycle.done();
  expect(lifecycle.phase()).toBe('leaving');
  await settle();
  expect(await outcome).toBe('restored');
  expect(history.back).toHaveBeenCalledTimes(1);
  expect(entries()).toEqual(['/a/doc']);
  expect(lifecycle.phase()).toBe('reading');
  expect(lifecycle.selectionPath()).toBeNull();
  expect(controller.restored).toHaveBeenCalledTimes(1);
  expect(offs(sent)).toBe(1);
});

it('done() flushes once and sends exactly one mx:edit-mode off, even with the hashchange its back() causes', async () => {
  vi.useFakeTimers();
  const { lifecycle, sent } = lifecycleFor();
  const flush = vi.fn(() => Promise.resolve());
  lifecycle.registerFlush(flush);
  lifecycle.enter(null);
  lifecycle.ready();
  const first = lifecycle.done();
  const second = lifecycle.done();
  await settle();
  await settle();
  expect(await first).toBe('restored');
  expect(await second).toBe('restored');
  expect(flush).toHaveBeenCalledTimes(1);
  expect(offs(sent)).toBe(1);
});

it('done() on an address opened as /edit replaces it with the reading address', async () => {
  vi.useFakeTimers();
  const { lifecycle, history, location } = lifecycleFor({ start: '/a/doc/edit?x=1' });
  lifecycle.sync();
  expect(lifecycle.phase()).toBe('entering');
  const outcome = lifecycle.done();
  await settle();
  expect(await outcome).toBe('restored');
  expect(history.back).not.toHaveBeenCalled();
  expect(location.pathname + location.search).toBe('/a/doc?x=1');
  expect(lifecycle.phase()).toBe('reading');
});

it('done() on an address that arrived in edit mode drops #edit before the flush settles, so a reload reads', async () => {
  vi.useFakeTimers();
  const { lifecycle, history, location } = lifecycleFor({ start: '/a/doc?$x=1#edit' });
  let release!: () => void;
  lifecycle.registerFlush(() => new Promise<void>((resolve) => { release = resolve; }));
  lifecycle.sync();
  lifecycle.ready();
  const outcome = lifecycle.done();
  expect(location.hash).toBe('');
  expect(location.pathname + location.search).toBe('/a/doc?$x=1');
  expect(lifecycle.phase()).toBe('leaving');
  // A reload now opens the reading address: sync() on it never re-enters the editor.
  lifecycle.sync();
  expect(lifecycle.phase()).toBe('leaving');
  release();
  await settle();
  expect(await outcome).toBe('restored');
  expect(history.back).not.toHaveBeenCalled();
  expect(location.hash).toBe('');
  expect(lifecycle.phase()).toBe('reading');
});

it('done() after enter() drops #edit before the flush and pops the pushed entry after it', async () => {
  vi.useFakeTimers();
  const { lifecycle, history, location, entries } = lifecycleFor();
  let release!: () => void;
  lifecycle.registerFlush(() => new Promise<void>((resolve) => { release = resolve; }));
  lifecycle.enter(null);
  lifecycle.ready();
  const outcome = lifecycle.done();
  expect(location.hash).toBe('');
  expect(history.back).not.toHaveBeenCalled();
  release();
  await settle();
  expect(await outcome).toBe('restored');
  expect(history.back).toHaveBeenCalledTimes(1);
  expect(entries()).toEqual(['/a/doc']);
  expect(lifecycle.phase()).toBe('reading');
});

it('Back while a flush hangs waits at most 3 s, then leaves', async () => {
  vi.useFakeTimers();
  const { lifecycle, history, sent } = lifecycleFor();
  lifecycle.registerFlush(() => new Promise<void>(() => {}));
  lifecycle.enter(null);
  lifecycle.ready();
  history.back();
  await settle();
  expect(lifecycle.phase()).toBe('leaving');
  await vi.advanceTimersByTimeAsync(2900);
  expect(lifecycle.phase()).toBe('leaving');
  expect(offs(sent)).toBe(0);
  await vi.advanceTimersByTimeAsync(200);
  expect(lifecycle.phase()).toBe('reading');
  expect(offs(sent)).toBe(1);
});

it('Done is bounded by the same 3 s flush', async () => {
  vi.useFakeTimers();
  const { lifecycle } = lifecycleFor();
  lifecycle.registerFlush(() => new Promise<void>(() => {}));
  lifecycle.enter(null);
  const outcome = lifecycle.done();
  await vi.advanceTimersByTimeAsync(3100);
  expect(await outcome).toBe('restored');
});

it('a rejected restore yields reloaded and reloads the page', async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { lifecycle, location } = lifecycleFor({ restored: () => Promise.reject(new Error('another build')) });
  lifecycle.enter(null);
  const outcome = lifecycle.done();
  await settle();
  expect(await outcome).toBe('reloaded');
  expect(location.reload).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalled();
});

it('a changed install setting leaves by a replace navigation, without restoring in place', async () => {
  vi.useFakeTimers();
  const { lifecycle, location, sent, setPwaChanged } = lifecycleFor({ start: '/a/doc/edit?x=1' });
  lifecycle.sync();
  setPwaChanged(true);
  const outcome = lifecycle.done();
  await settle();
  expect(await outcome).toBe('reloaded');
  expect(location.replace).toHaveBeenCalledWith('/a/doc?x=1');
  expect(offs(sent)).toBe(0);
});

it('entering again while the last session restores is not undone by that restore', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const { lifecycle } = lifecycleFor({ restored: () => new Promise<void>((resolve) => { finish = resolve; }) });
  lifecycle.enter(null);
  const outcome = lifecycle.done();
  await settle();
  expect(lifecycle.phase()).toBe('restoring');
  lifecycle.enter(null);
  expect(lifecycle.phase()).toBe('entering');
  finish();
  await settle();
  expect(await outcome).toBe('restored');
  expect(lifecycle.phase()).toBe('entering');
});

it('the editor part loader dedupes concurrent loads and retries after a failure', async () => {
  const fetchMock = vi.fn<(input: unknown) => Promise<Response>>()
    .mockResolvedValueOnce(new Response('no', { status: 500 }))
    .mockResolvedValue(Response.json({ editId: 'e1', version: 3, source: '<p/>', compiledCss: null, authorCss: null }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const loader = createRoot((dispose) => { disposers.push(dispose); return createEditorPartLoader('doc12345', () => true); });
    const [a, b] = await Promise.all([loader.load(), loader.load()]);
    expect(a).toBeNull(); expect(b).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loader.failed()).toBe(true);
    const part = await loader.load();
    expect(part?.editId).toBe('e1');
    expect(loader.part()?.editId).toBe('e1');
    await loader.load();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    loader.reset();
    expect(loader.part()).toBeNull();
    await loader.load();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const reader = createRoot((dispose) => { disposers.push(dispose); return createEditorPartLoader('doc12345', () => false); });
    expect(await reader.load()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally { vi.unstubAllGlobals(); }
});

