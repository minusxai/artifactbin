/** The island module's shared assembly: what boot and the offline file's boot both build from a module. */
import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'solid-js';
import type { PageEngine } from '@/lib/story-runtime/page-engine';
import { lazyEngine, normalizeIslandModule } from '../module';

const engineStub = (): PageEngine => ({
  prepare: vi.fn(), ready: vi.fn(() => true), invalidate: vi.fn(),
  run: vi.fn(), page: vi.fn(), write: vi.fn(), apply: vi.fn(() => null), close: vi.fn(),
} as unknown as PageEngine);

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const FLOW = { queries: [], mutations: [] } as never;
const NONE = [] as never;

describe('lazyEngine', () => {
  it('closes an engine that finishes loading after the page closed it', async () => {
    const made = engineStub();
    const loading = deferred<PageEngine>();
    const engine = lazyEngine(() => loading.promise);
    engine.prepare(FLOW, NONE);
    engine.close();
    loading.resolve(made);
    await loading.promise; await Promise.resolve();
    expect(made.close).toHaveBeenCalledTimes(1);
    expect(made.prepare).not.toHaveBeenCalled();
    expect(engine.ready(FLOW, NONE)).toBe(false);
  });

  it('loads once, on the first prepare, and replays what was asked before it loaded', async () => {
    const made = engineStub();
    const loading = deferred<PageEngine>();
    const load = vi.fn(() => loading.promise);
    const engine = lazyEngine(load);
    expect(load).not.toHaveBeenCalled();
    engine.prepare(FLOW, { a: [] } as never);
    engine.prepare(FLOW, { b: [] } as never);
    expect(load).toHaveBeenCalledTimes(1);
    expect(engine.ready(FLOW, NONE)).toBe(false);
    loading.resolve(made);
    await loading.promise; await Promise.resolve();
    expect(made.prepare).toHaveBeenCalledTimes(2);
    expect(engine.ready(FLOW, NONE)).toBe(true);
    engine.prepare(FLOW, NONE);
    expect(made.prepare).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is never ready until the page knows whom $_me names', async () => {
    const made = engineStub();
    let identified = false;
    const engine = lazyEngine(() => Promise.resolve(made), () => identified);
    engine.prepare(FLOW, NONE);
    await Promise.resolve(); await Promise.resolve();
    expect(engine.ready(FLOW, NONE)).toBe(false);
    identified = true;
    expect(engine.ready(FLOW, NONE)).toBe(true);
  });

  it('treats an engine that will not load as final and quiet: never ready, never retried', async () => {
    const loading = deferred<PageEngine>();
    const load = vi.fn(() => loading.promise);
    const engine = lazyEngine(load);
    engine.prepare(FLOW, NONE);
    loading.reject(new Error('no wasm'));
    await loading.promise.catch(() => {}); await Promise.resolve();
    engine.prepare(FLOW, NONE);
    expect(load).toHaveBeenCalledTimes(1);
    expect(engine.ready(FLOW, NONE)).toBe(false);
  });
});

describe('normalizeIslandModule', () => {
  const Tree: Component = () => null;
  it('wraps a bare ISLANDS list, a one-tree module and a full module the same way boot always has', () => {
    const islands = [['i-', Tree, 'k']] as const;
    expect(normalizeIslandModule(islands)).toEqual({ ISLANDS: islands });
    expect(normalizeIslandModule({ TREE: Tree, FLOW: null })).toEqual({ ISLANDS: [['d-', Tree]], TREE: Tree, FLOW: null });
    const full = { ISLANDS: islands, FLOW: null };
    expect(normalizeIslandModule(full)).toBe(full);
  });
});
