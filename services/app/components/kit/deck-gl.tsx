/**
 * `<DeckGL>` — the story kit's map. This shell is all the reader's first paint
 * carries: deck.gl, MapLibre and h3-js load as one lazy chunk
 * (./deck-gl-engine) only when a document actually holds a map. The contract
 * it renders is lib/viz/deck-spec.
 */
import { useEffect, useState, type ComponentType } from 'react';
import type { DeckEngineProps } from './deck-gl-engine';

export type DeckGLMapProps = Omit<DeckEngineProps, 'height'> & { height?: number | string };

const DEFAULT_HEIGHT = 420;

/** The map box's height in px for an authored `height` — shared with any stand-in that must hold the same space. */
export const deckGlHeight = (height: unknown): number =>
  typeof height === 'number' ? height : Number.parseInt(String(height ?? DEFAULT_HEIGHT), 10) || DEFAULT_HEIGHT;

/**
 * The editor's node identity (`id`, `data-mx-ast`) lands on the map's own box,
 * so a map can be selected, commented on and moved like every other component.
 */
export function DeckGLMap({ id, 'data-mx-ast': ast, className, ...props }: DeckGLMapProps & { id?: string; 'data-mx-ast'?: string; className?: string }) {
  const [Engine, setEngine] = useState<ComponentType<DeckEngineProps> | null>(null);
  useEffect(() => {
    let live = true;
    void import('./deck-gl-engine').then(m => { if (live) setEngine(() => m.DeckEngine); });
    return () => { live = false; };
  }, []);
  const height = deckGlHeight(props.height);
  return (
    <div id={id} data-mx-ast={ast} className={className}>
      {Engine
        ? <Engine {...props} height={height} />
        : <div className="w-full rounded-md bg-muted" style={{ height }} aria-busy="true" aria-label={props.title ?? 'Map loading'} />}
    </div>
  );
}
