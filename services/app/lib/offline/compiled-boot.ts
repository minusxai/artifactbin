/** Offline replacement for the compiled page's @mx/boot entry.
 * The document module and kit chunks stay exactly the published compiled code;
 * only the boundary to network doors and page engines changes here.
 */
import type { Component } from 'solid-js';
import { createDataflowStore } from '@/lib/story-runtime/store';
import type { PageEngine } from '@/lib/story-runtime/page-engine';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import { createIslandRuntime, hydrateIsland } from '@/lib/islands/rt';
import { createSnapshotTransport } from './snapshot-transport';
import { OFFLINE_FILTER_REASON, OFFLINE_MUTATION_REASON, sourceDigest, type ArtifactFile } from './file-format';

declare const __AFBIN_OFFLINE_SQLITE__: boolean;
declare const __AFBIN_OFFLINE_CHART__: boolean;
declare global {
  interface Window {
    __afbinOfflineFile?: ArtifactFile;
    __afbinOfflineStore?: ReturnType<typeof createDataflowStore> | null;
    __afbinOfflineDispose?: () => void;
  }
}

export interface OfflineIslandModule {
  ISLANDS: readonly (readonly [string, Component, string?])[];
  FLOW?: CompiledDataflow | null;
}

/** Delay the engine's import until the store first asks it to prepare. */
function lazyEngine(load: () => Promise<PageEngine>): PageEngine {
  let engine: PageEngine | null = null;
  let loading: Promise<void> | null = null;
  const pending: Array<Parameters<PageEngine['prepare']>> = [];
  return {
    prepare(flow, imports) {
      if (engine) return engine.prepare(flow, imports);
      pending.push([flow, imports]);
      loading ??= load().then((made) => {
        engine = made;
        for (const [nextFlow, nextImports] of pending.splice(0)) made.prepare(nextFlow, nextImports);
      });
    },
    ready: (flow, imports) => !!engine && engine.ready(flow, imports),
    invalidate: (refs) => engine?.invalidate(refs),
    run: (...args) => engine!.run(...args),
    page: (...args) => engine!.page(...args),
    write: (...args) => engine!.write(...args),
    apply: (...args) => engine?.apply(...args) ?? null,
    close: () => engine?.close(),
  };
}

export function boot(input: OfflineIslandModule | OfflineIslandModule['ISLANDS']): void {
  const file = window.__afbinOfflineFile;
  if (!file) throw new Error('offline: document snapshot is unavailable');
  const module: OfflineIslandModule = Array.isArray(input) ? { ISLANDS: input } : input as OfflineIslandModule;
  const root = document.querySelector<HTMLElement>('[data-mx-inline-story]');
  if (!root) throw new Error('offline: compiled story is unavailable');
  const flow = module.FLOW ?? file.island.dataflow?.flow ?? null;
  const transport = flow ? {
    ...createSnapshotTransport(flow, file.snapshot),
    hold: async (name: string) => {
      const tables = file.snapshot.held?.[name];
      if (!tables) throw new Error(OFFLINE_FILTER_REASON);
      return tables;
    },
  } : null;
  const holds = file.island.dataflow?.hold ?? [];
  const staleFlow = !!file.compiledFlowDigest && file.compiledFlowDigest !== sourceDigest(JSON.stringify(file.island.dataflow?.flow ?? null));
  const page = __AFBIN_OFFLINE_SQLITE__ && flow && holds.length && transport
    ? { engine: lazyEngine(() => import('./compiled-sqlite').then(({ offlinePageEngine }) => offlinePageEngine(transport.hold))), userId: null }
    : null;
  const runtime = createIslandRuntime({
    dataflow: flow ? { flow, state: file.snapshot.state, values: file.snapshot.state.values, hold: holds } : null,
    mermaidImages: {}, viewer: null, readOnly: OFFLINE_MUTATION_REASON,
  }, (data) => createDataflowStore(data, {
    transport, page, writesUnavailable: OFFLINE_MUTATION_REASON,
    frozenValues: Object.fromEntries(file.snapshot.frozen.map((name) => [name, OFFLINE_FILTER_REASON])),
  }), {
    ...(__AFBIN_OFFLINE_CHART__ ? { loadChart: () => import('@/lib/islands/chart').then(({ loadChart }) => loadChart()) } : {}),
  });
  const disposers = module.ISLANDS.map(([id, component], index) => staleFlow && file.compiled?.islands[index]?.readsData
    ? null : hydrateIsland(id, component, runtime.context, root)).filter((stop): stop is () => void => !!stop);
  window.__afbinOfflineStore = runtime.store;
  window.__afbinOfflineDispose = () => { for (const stop of disposers) stop(); runtime.dispose(); };
  runtime.store?.start();
  document.documentElement.setAttribute('data-mx-ready', '');
  document.dispatchEvent(new Event('mx:ready'));
}
