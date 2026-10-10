/**
 * WHAT A PER-DOCUMENT MODULE HANDS ITS BOOT, made one shape, and the page engine it may lazily load —
 * shared by the online boot (./boot) and the offline file's boot (lib/offline/compiled-boot), so a fix to
 * either reaches both. Framework-free; types only from ./boot.
 */
import type { Component } from 'solid-js';
import type { PageEngine } from '@/lib/story-runtime/data';
import type { CompiledDataflow } from '@/lib/dataflow';
import type { IslandEntry, IslandModule } from './boot';

/** Every shape a compiled module hands `boot`: a bare `ISLANDS` list, a one-tree `{ TREE, FLOW }`, or the full module. */
export type IslandModuleInput = IslandModule | { TREE: Component; FLOW?: CompiledDataflow | null } | readonly IslandEntry[];

/**
 * `ISLANDS` alone is a module whose islands read no data (the compiler's first shape); a one-tree module
 * hands `{ TREE, FLOW }` instead, wrapped here as the document's one island.
 */
export function normalizeIslandModule(input: IslandModuleInput): IslandModule {
  return Array.isArray(input) ? { ISLANDS: input as readonly IslandEntry[] }
    : 'TREE' in input && input.TREE ? { ISLANDS: [['d-', input.TREE]], TREE: input.TREE, FLOW: input.FLOW }
      : (input as IslandModule);
}

/**
 * The page's own engine, LAZILY: what the store holds from the start is this stand-in, never ready until
 * the engine module has loaded and `identified()` says the page knows whom `$_me` names. What the store
 * asked it to prepare before then is prepared once it has loaded. A module that will not load is final
 * for this document (its queries run where the transport sends them). Closed before it loads, the engine
 * is closed as soon as it arrives.
 */
export function lazyEngine(load: () => Promise<PageEngine>, identified: () => boolean = () => true): PageEngine {
  let engine: PageEngine | null = null;
  let loading: Promise<void> | null = null;
  let closed = false;
  const asked: Array<Parameters<PageEngine['prepare']>> = [];
  const loaded = () => {
    if (closed) throw new Error('the page engine is closed');
    if (!engine) throw new Error('the page engine module did not load');
    return engine;
  };
  const prepare = (flow: Parameters<PageEngine['prepare']>[0], imports: readonly string[]) => {
    if (closed) return;
    if (engine) return engine.prepare(flow, imports);
    asked.push([flow, imports]);
    loading ??= load().then((made) => {
      if (closed) return made.close();
      engine = made;
      for (const [f, i] of asked.splice(0)) made.prepare(f, i);
    }, () => {});
  };
  return {
    prepare,
    ready: (flow, imports) => !!engine && identified() && engine.ready(flow, imports),
    invalidate: (refs) => engine?.invalidate(refs),
    run: (...args) => loaded().run(...args),
    page: (...args) => loaded().page(...args),
    async write(...args) {
      // Never replace a local write with a remote request or evaluate $_me before identification.
      if (!identified()) throw new Error('the page is still identifying its reader');
      prepare(args[0], args[1].reads.imports);
      await loading;
      return loaded().write(...args);
    },
    apply: (...args) => engine?.apply(...args) ?? null,
    close: () => { closed = true; engine?.close(); },
  };
}
