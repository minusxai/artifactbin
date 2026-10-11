/**
 * THE FRAMED DOCUMENT'S NODE TREE IS ITS OWN REQUEST (solid/document/create-framed-story): the page draws nothing from it —
 * it is only relayed to the frame's edit controller, which classifies comments and selections against it — so the page's
 * data does not carry it. The bridge attaches when the tree arrives; a transient failure is asked again, a refusal is not.
 */
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsxNode } from '@/lib/jsx/types';
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

  it('asks again after a server failure or a dropped connection, and gives up after the third try', async () => {
    const calls = stubFetch(answer(503), new TypeError('network'), answer(200, { nodes: TREE }));
    const pending = fetchFrameNodes('doc1', '');
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(TREE);
    expect(calls).toHaveLength(3);
    const failing = stubFetch(answer(500), answer(500), answer(500));
    const never = fetchFrameNodes('doc1', '');
    await vi.runAllTimersAsync();
    expect(await never).toBeNull();
    expect(failing).toHaveLength(3);
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
