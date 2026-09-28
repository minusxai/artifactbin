/* @jsxImportSource solid-js */
/**
 * THE EMBEDS (data family: `@mx/kit/data` re-exports them): `<Iframe>` and `<DeckGL>` as islands. Each
 * island is the box today's reader draws, server-rendered at its final size; its behaviour is a lazy chunk
 * loaded once the island is mounted, never part of the shared runtime or of a page's first paint:
 *
 * - `<Iframe>`: today's managed frame (lib/story-runtime/managed-iframe) — ./embed/frame-engine mounts the
 *   sandboxed author realm in the box and binds it to the document's store.
 * - `<DeckGL>`: today's map (components/kit/deck-gl + the runtime adapter) — ./embed/deck-engine replaces
 *   the loading stand-in with deck.gl (and MapLibre for a basemap), over the table `data` names.
 */
import { Show, createComponent, createSignal, onCleanup, onMount, type Component, type JSX } from 'solid-js';
import { refName } from '@/lib/story/dataflow';
import { managedFrameLayout } from '@/lib/story/managed-frame-layout';
import { deckGlHeight } from '@/lib/viz/deck-height';
import type { ManagedIframeContent } from '@/lib/story/managed-iframe';
import type { ManagedAssetsConfig } from '@/lib/story-runtime/managed-assets';
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { useIsland } from '../context';
import type { DeckEngineProps } from './embed/deck-engine';

type Props = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
/**
 * An inline style as React's server renderer wrote it, kept byte for byte: set as the attribute (hydration
 * leaves a served attribute alone), never through the CSSOM, which would rewrite it (`height: 1px;`).
 */
const servedStyle = (css: string) => ({ 'attr:style': css }) as JSX.HTMLAttributes<HTMLDivElement>;

/**
 * The managed asset door for this page: the deployment's asset origin (compiled in) and the page's own
 * asset import door (the data island's `assetsUrl`, made absolute against the page's own address). None without an origin.
 */
function assetsConfig(origin: unknown, doc: Document): ManagedAssetsConfig | undefined {
  if (typeof origin !== 'string' || !origin) return undefined;
  let door: string | undefined;
  try { door = (JSON.parse(doc.getElementById(ISLAND_DATA_ID)?.textContent || '{}') as { assetsUrl?: string }).assetsUrl; } catch { door = undefined; }
  if (!door) return undefined;
  return { origin, resolveUrl: new URL(door, doc.baseURI).href };
}

/** `<Iframe>`: the managed frame's box (today's `data-mx-managed-frame` element), the author realm mounted in it. */
export function Iframe(props: Props) {
  const island = useIsland();
  const { label, pixels } = managedFrameLayout(props.title, props.height);
  const [error, setError] = createSignal('');
  let host!: HTMLDivElement;
  onMount(() => {
    let disposed = false;
    let stop = () => {};
    import('./embed/frame-engine').then(({ mountManagedFrame }) => {
      if (disposed) return;
      stop = mountManagedFrame({ host, compiled: props.compiled as ManagedIframeContent, store: island.store(), label, assets: assetsConfig(props.assetsOrigin, host.ownerDocument), onError: setError });
    }).catch((e: Error) => setError(String(e.message).slice(0, 500)));
    onCleanup(() => { disposed = true; stop(); });
  });
  return (
    <div id={str(props.id)} class={str(props.class)} data-mx-ast={str(props['data-mx-ast'])} data-mx-managed-frame="" aria-label={label} {...servedStyle(`height:${pixels}px;width:100%`)}>
      <div ref={host} {...servedStyle('height:100%')} />
      <Show when={error()}><p role="alert">{error()}</p></Show>
    </div>
  );
}

/** `<DeckGL>`: the runtime adapter's box (identity) around the map's own (class), the stand-in until the engine lands. */
export function DeckGL(props: Props) {
  const island = useIsland();
  const [Engine, setEngine] = createSignal<Component<DeckEngineProps> | null>(null);
  onMount(() => {
    let live = true;
    void import('./embed/deck-engine').then((m) => { if (live) setEngine(() => m.DeckEngine); });
    onCleanup(() => { live = false; });
  });
  const height = deckGlHeight(props.height);
  const name = refName(props.data);
  const rows = () => (name ? island.tableSnapshot(name)?.rows ?? [] : []);
  return (
    <div id={str(props.id)} data-mx-ast={str(props['data-mx-ast'])}>
      <div class={str(props.class)}>
        <Show when={Engine()} fallback={<div class="w-full rounded-md bg-muted" {...servedStyle(`height:${height}px`)} aria-busy="true" aria-label={str(props.title) ?? 'Map loading'} />}>
          {(E) => createComponent(E(), {
            rows, layers: props.layers, basemap: str(props.basemap), colorMode: props.colorMode === 'dark' ? 'dark' : 'light',
            initialViewState: props.initialViewState as DeckEngineProps['initialViewState'], tooltip: props.tooltip as DeckEngineProps['tooltip'],
            legend: props.legend as boolean | undefined, title: str(props.title), height,
          })}
        </Show>
      </div>
    </div>
  );
}
