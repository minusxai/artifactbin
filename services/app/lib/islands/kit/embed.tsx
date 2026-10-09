/* @jsxImportSource solid-js */
/**
 * THE EMBED FAMILY (`@mx/kit/embed`): `<DeckGL>` as an island. The island is the box the former reader
 * draws, server-rendered at its final size; its behaviour is a lazy chunk loaded once the island is mounted,
 * never part of the shared runtime or of a page's first paint: ./embed/deck-engine replaces the loading
 * stand-in with deck.gl (and MapLibre for a basemap), over the table `data` names.
 */
import { createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { refName } from '@/lib/dataflow/dataflow';
import { deckGlHeight } from '@/lib/viz/deck-height';
import { MAP_CLASSES } from '@/lib/viz/deck-chrome';
import { useIsland } from '../context';
import { deferEngine } from '../defer-engine';
import type { DeckEngineProps } from './embed/deck-engine';

type Props = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
/**
 * An inline style as React's server renderer wrote it, kept byte for byte: set as the attribute (hydration
 * leaves a served attribute alone), never through the CSSOM, which would rewrite it (`height: 1px;`).
 */
const servedStyle = (css: string) => ({ 'attr:style': css }) as JSX.HTMLAttributes<HTMLDivElement>;

/**
 * `<DeckGL>`: the runtime adapter's box (identity) around the map's own (class), and in it the map's box —
 * served as the former loading stand-in and turned into the map's figure when the engine lands, so the element
 * the page was served with is the one the map draws into.
 */
export function DeckGL(props: Props) {
  const island = useIsland();
  const [ready, setReady] = createSignal(false);
  const height = deckGlHeight(props.height);
  const name = refName(props.data);
  const title = str(props.title);
  let box!: HTMLDivElement;
  onMount(() => {
    let live = true;
    let stop = () => {};
    const cancel = deferEngine(box, () => { void import('./embed/deck-engine').then(({ mountDeckEngine }) => {
      if (!live) return;
      // Through the CSSOM, as the former engine sets its figure's height (the attribute then reads `height: 320px;`).
      box.style.cssText = '';
      box.style.height = `${height}px`;
      stop = mountDeckEngine(box, {
        rows: () => (name ? island.tableSnapshot(name)?.rows ?? [] : []), layers: props.layers, basemap: str(props.basemap), colorMode: props.colorMode === 'dark' ? 'dark' : 'light',
        initialViewState: props.initialViewState as DeckEngineProps['initialViewState'], tooltip: props.tooltip as DeckEngineProps['tooltip'],
        legend: props.legend as boolean | undefined, title, height,
      });
      setReady(true);
    }); });
    onCleanup(() => { live = false; cancel(); stop(); });
  });
  return (
    <div id={str(props.id)} data-mx-ast={str(props['data-mx-ast'])}>
      <div class={str(props.class)}>
        <div ref={box} class={ready() ? MAP_CLASSES.figure : MAP_CLASSES.loading} role={ready() ? 'figure' : undefined} aria-busy={ready() ? undefined : 'true'}
          aria-label={ready() ? title ?? 'Map' : title ?? 'Map loading'} {...servedStyle(`height:${height}px`)} />
      </div>
    </div>
  );
}
